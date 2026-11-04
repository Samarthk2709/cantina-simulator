'use strict';
// Accounts for First Office: username + password, and (optional) Google sign-in.
// - Password: scrypt with a per-user salt, compared with timingSafeEqual. Min 8 characters.
// - Google: the page gets an ID token from Google Identity Services; this checks it (RS256 signature against Google's
//   published keys, audience = our client id, issuer, expiry, verified email). A first Google sign-in makes an account
//   with no username yet; the player picks one before playing.
// - Usernames: 3–16 of [a-zA-Z0-9_], unique ignoring case, some reserved.
// - Session: an HttpOnly cookie "<account id>.<session version>.<expiry>.<hmac>" signed with SESSION_SECRET (or a secret kept
//   in the store). Bumping the account's version (a password change, "sign out everywhere") ends every other session.
// Everything lives in `store` (store.cjs: files locally, Redis when hosted), so nothing depends on local disk or memory:
//   account:<id> → { id, username, pass: {salt, hash} | null, google: sub | null, email, picture, at }
//   uname:<lowercase username> → id      google:<sub> → id      save:<hash of id> → the cloud save      secret → cookie key
// The login/signup rate limit is per IP and in memory: best effort (on serverless each instance counts on its own).
const crypto = require('node:crypto');

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SESSION_DAYS = 30, SAVE_MAX = 1_000_000;
const NAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'sysop', 'mod', 'moderator', 'staff', 'support', 'help', 'official', 'owner',
  'nib', 'pip', 'moss', 'cantina', 'firstoffice', 'first_office', 'guest', 'anonymous', 'someone', 'player', 'you', 'me', 'null', 'undefined', 'api', 'server']);
const TRIES = 10, TRIES_MS = 60_000; // login/signup attempts per IP per minute

function create({ clientId = '', store, sessionSecret = process.env.SESSION_SECRET || '', jwksUrl = GOOGLE_JWKS, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  if (!store) throw new Error('auth needs a store');

  // The cookie-signing secret: SESSION_SECRET, else one made once and kept in the store (re-read after writing, so two
  // servers starting together settle on the same one).
  let secretP = null;
  const secret = () => secretP || (secretP = (async () => {
    if (sessionSecret.length >= 32) return sessionSecret;
    let s = await store.get('secret');
    if (typeof s !== 'string' || s.length < 32) { await store.set('secret', crypto.randomBytes(32).toString('hex')); s = await store.get('secret'); }
    return s;
  })().catch(e => { secretP = null; throw e; }));

  // ---------- rate limit (best effort, in memory) ----------
  const tries = new Map();
  function limit(ip) {
    const t = now(), recent = (tries.get(ip) || []).filter(x => t - x < TRIES_MS);
    if (recent.length >= TRIES) throw fail('Too many tries. Wait a minute and try again.', 429);
    recent.push(t); tries.set(ip, recent);
    if (tries.size > 5000) for (const [k, v] of tries) if (!v.some(x => t - x < TRIES_MS)) tries.delete(k);
  }

  // ---------- usernames and passwords ----------
  function checkName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw fail('Usernames are 3–16 letters, numbers or _.', 400);
    if (RESERVED.has(name.toLowerCase())) throw fail('That username is reserved. Pick another.', 409);
    return name;
  }
  function checkPassword(p) {
    if (typeof p !== 'string' || p.length < 8) throw fail('Passwords need at least 8 characters.', 400);
    if (p.length > 200) throw fail('That password is too long.', 400);
    return p;
  }
  const scrypt = (p, salt) => new Promise((ok, bad) => crypto.scrypt(p, salt, 64, (e, k) => e ? bad(e) : ok(k)));
  async function hashPassword(p) { const salt = crypto.randomBytes(16); return { salt: salt.toString('hex'), hash: (await scrypt(p, salt)).toString('hex') }; }
  async function checkHash(p, rec) {
    const want = Buffer.from(rec.hash, 'hex'), got = await scrypt(String(p), Buffer.from(rec.salt, 'hex'));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  const DUMMY = { salt: '00'.repeat(16), hash: '00'.repeat(64) }; // unknown username: still hash, so timing doesn't say which part was wrong

  const getAccount = async id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) ? store.get('account:' + id) : null;
  async function claimName(acc, name) {
    checkName(name);
    const key = 'uname:' + name.toLowerCase(), owner = await store.get(key);
    if (owner && owner !== acc.id) throw fail('That username is taken. Pick another.', 409);
    acc = { ...acc, username: name };
    await store.set('account:' + acc.id, acc); await store.set(key, acc.id);
    return acc;
  }
  const newAccount = extra => ({ id: crypto.randomBytes(12).toString('hex'), username: '', pass: null, google: null, email: '', picture: '', at: now(), ...extra });

  async function signup(username, password, ip) {
    limit(ip); checkName(username); checkPassword(password);
    if (await store.get('uname:' + username.toLowerCase())) throw fail('That username is taken. Pick another.', 409);
    return claimName(newAccount({ pass: await hashPassword(password) }), username);
  }
  async function login(username, password, ip) {
    limit(ip);
    const id = typeof username === 'string' && NAME_RE.test(username) ? await store.get('uname:' + username.toLowerCase()) : null;
    const acc = id && await getAccount(id);
    const ok = await checkHash(typeof password === 'string' ? password.slice(0, 200) : '', acc && acc.pass || DUMMY);
    if (!acc || !acc.pass || !ok) throw fail('Wrong username or password.', 401);
    return acc;
  }
  // A signed-in account with no username yet (a new Google account) picks one, once.
  async function setUsername(acc, username) {
    if (!acc) throw fail('Sign in first.', 401);
    if (acc.username) throw fail('You already have a username.', 409);
    return claimName(acc, username);
  }

  // ---------- Google ----------
  // Google's keys, cached for an hour (they rotate rarely, and a new kid triggers a refetch).
  let keys = null, keysAt = 0;
  async function key(kid) {
    if (!keys || now() - keysAt > 3600e3 || !keys[kid]) {
      const r = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw fail('Google keys unavailable', 503);
      const j = await r.json(); keys = {}; for (const k of j.keys || []) if (k.kid && k.kty === 'RSA') keys[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' }); keysAt = now();
    }
    return keys[kid];
  }
  const b64 = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  async function verify(token) {
    if (!clientId) throw fail('Google sign-in is not configured', 503);
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw fail('Bad token', 401);
    let head, body; try { head = JSON.parse(b64(parts[0])); body = JSON.parse(b64(parts[1])); } catch { throw fail('Bad token', 401); }
    if (head.alg !== 'RS256' || !head.kid) throw fail('Bad token', 401);
    const k = await key(head.kid); if (!k) throw fail('Unknown key', 401);
    if (!crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), k, b64(parts[2]))) throw fail('Bad signature', 401);
    const t = Math.floor(now() / 1000);
    if (body.aud !== clientId) throw fail('Wrong audience', 401);
    if (!ISSUERS.includes(body.iss)) throw fail('Wrong issuer', 401);
    if (!(body.exp > t - 30) || (body.iat && body.iat > t + 300)) throw fail('Expired', 401);
    if (!body.sub || body.email_verified === false) throw fail('Unverified account', 401);
    return body;
  }
  async function google(credential) {
    const p = await verify(credential), sub = String(p.sub);
    const info = { email: String(p.email || '').slice(0, 120), picture: /^https:\/\//.test(p.picture || '') ? p.picture.slice(0, 400) : '' };
    const id = await store.get('google:' + sub);
    let acc = id && await getAccount(id);
    if (acc) acc = { ...acc, ...info };
    else { acc = newAccount({ google: sub, ...info }); await store.set('google:' + sub, acc.id); }
    await store.set('account:' + acc.id, acc);
    return acc;
  }

  // ---------- sessions ----------
  const sign = async v => crypto.createHmac('sha256', await secret()).update(v).digest('base64url');
  async function cookieFor(acc, secure) {
    const exp = Math.floor(now() / 1000) + SESSION_DAYS * 86400, v = `${acc.id}.${acc.sv || 0}.${exp}`;
    return `fo_session=${v}.${await sign(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }
  // The signed-in account for a request, or null. `sub` is the stable account id (the leaderboard keys rows by it).
  async function userFrom(req) {
    const m = /(?:^|;\s*)fo_session=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
    const parts = m[1].split('.'), [id, sv, exp, sig] = parts.length === 4 ? parts : [parts[0], '0', parts[1], parts[2]]; // 3 parts: a cookie from before versions
    if (!id || !exp || !sig || !/^\d{1,9}$/.test(sv)) return null;
    const want = await sign(parts.length === 4 ? `${id}.${sv}.${exp}` : `${id}.${exp}`);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    if (!(+exp >= now() / 1000)) return null;
    const acc = await getAccount(id);
    return acc && (acc.sv || 0) === +sv ? toUser(acc) : null;
  }
  const toUser = acc => ({ sub: acc.id, id: acc.id, name: acc.username || '', email: acc.email || '', picture: acc.picture || '', google: !!acc.google, account: acc });
  const public_ = u => u && { id: u.id, name: u.name, email: u.email, picture: u.picture, needsName: !u.name };

  // ---------- cloud save: one JSON blob per account (the game, crew and Stage 1 keys, plus when it was written) ----------
  const saveKey = u => 'save:' + crypto.createHash('sha256').update(u.id).digest('hex').slice(0, 32);
  const getSave = async u => (await store.get(saveKey(u))) || null;
  async function putSave(u, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.keys !== 'object' || !body.keys) throw fail('Bad save', 400);
    const keys = {}; for (const [k, v] of Object.entries(body.keys)) if (/^first-office-[a-z0-9-]{1,40}$/.test(k) && typeof v === 'string') keys[k] = v;
    const out = { at: Number.isFinite(body.at) ? body.at : now(), keys };
    if (JSON.stringify(out).length > SAVE_MAX) throw fail('Save too large', 413);
    await store.set(saveKey(u), out);
    return { ok: true, at: out.at };
  }

  // ---------- account management (the signed-in account only) ----------
  const put = async acc => { await store.set('account:' + acc.id, acc); return acc; };
  const info = acc => ({ id: acc.id, username: acc.username, created: acc.at, password: !!acc.pass, google: acc.google ? { email: acc.email || '' } : null, googleAvailable: !!clientId });
  // Anything sensitive asks for the password again (if the account has one).
  async function reauth(acc, password, ip) {
    if (!acc.pass) return;
    limit(ip);
    if (!(await checkHash(typeof password === 'string' ? password.slice(0, 200) : '', acc.pass))) throw fail('Wrong password.', 401);
  }
  async function rename(acc, name) {
    checkName(name);
    if (acc.username && acc.username.toLowerCase() === name.toLowerCase() && acc.username !== name) return claimName(acc, name); // only the capitals change
    if (acc.username === name) return acc;
    const old = acc.username, next = await claimName(acc, name);
    if (old && (await store.get('uname:' + old.toLowerCase())) === acc.id) await store.del('uname:' + old.toLowerCase());
    return next;
  }
  // Change (needs the current one) or add a password. Every other session ends.
  async function setPassword(acc, current, next, ip) {
    await reauth(acc, current, ip); checkPassword(next);
    if (!acc.username) throw fail('Pick a username first.', 409);
    return put({ ...acc, pass: await hashPassword(next), sv: (acc.sv || 0) + 1 });
  }
  async function linkGoogle(acc, credential) {
    const p = await verify(credential), sub = String(p.sub), owner = await store.get('google:' + sub);
    if (owner && owner !== acc.id) throw fail('That Google account is already linked to another First Office account.', 409);
    if (acc.google && acc.google !== sub) await store.del('google:' + acc.google);
    await store.set('google:' + sub, acc.id);
    return put({ ...acc, google: sub, email: String(p.email || '').slice(0, 120), picture: /^https:\/\//.test(p.picture || '') ? p.picture.slice(0, 400) : '' });
  }
  async function unlinkGoogle(acc, password, ip) {
    if (!acc.google) return acc;
    if (!acc.pass) throw fail('Add a password first, or you couldn\'t sign in any more.', 409);
    await reauth(acc, password, ip);
    if ((await store.get('google:' + acc.google)) === acc.id) await store.del('google:' + acc.google);
    return put({ ...acc, google: null, email: '', picture: '' });
  }
  const signOutAll = acc => put({ ...acc, sv: (acc.sv || 0) + 1 });
  // Delete: type the username to confirm (and the password, if there is one). The caller removes the game and the board row.
  async function remove(acc, confirm, password, ip) {
    if (typeof confirm !== 'string' || !acc.username || confirm.toLowerCase() !== acc.username.toLowerCase()) throw fail('Type your username to confirm.', 400);
    await reauth(acc, password, ip);
    if ((await store.get('uname:' + acc.username.toLowerCase())) === acc.id) await store.del('uname:' + acc.username.toLowerCase());
    if (acc.google && (await store.get('google:' + acc.google)) === acc.id) await store.del('google:' + acc.google);
    await store.del(saveKey({ id: acc.id })); await store.del('account:' + acc.id);
    return { ok: true };
  }
  const exportData = async acc => ({ account: info(acc), save: await getSave({ id: acc.id }) });

  return { info, rename, setPassword, linkGoogle, unlinkGoogle, signOutAll, remove, exportData,
    signup, login, google, setUsername, verify, cookieFor, userFrom, toUser, public: public_, getSave, putSave, checkName, hashPassword, checkHash,
    configured: true, googleConfigured: !!clientId, clientId };
}
function fail(msg, status) { return Object.assign(new Error(msg), { status }); }
module.exports = { create, RESERVED };
