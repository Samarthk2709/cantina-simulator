// Account checks (auth.cjs): passwords, usernames, rate limit, sessions, saves, and Google sign-in with a local RSA key
// standing in for Google's: every way a token can be wrong is refused, sessions can't be forged, saves stay per account.
//   node --test outputs/first-office/tests/auth.cjs
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Auth = require('../auth.cjs'), Store = require('../store.cjs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const CLIENT = 'test-client.apps.googleusercontent.com';
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token(claims = {}, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', email: 'sam@example.com', email_verified: true, given_name: 'Sam', iat: now, exp: now + 3600, ...claims };
  const head = b64({ alg, kid, typ: 'JWT' }) + '.' + b64(body);
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
}
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const newStore = () => Store.fileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'fo-auth-')));
const make = (o = {}) => Auth.create({ clientId: CLIENT, store: newStore(), sessionSecret: '', fetchImpl, ...o });
const req = cookie => ({ headers: { cookie } });
const cookie = async (a, acc) => (await a.cookieFor(acc, false)).split(';')[0];
let ipN = 0; const ip = () => '10.0.0.' + (++ipN); // a fresh IP per call, so the rate limit only bites where a test means it to

test('passwords hash with a per-user salt and verify', async () => {
  const a = make(), h1 = await a.hashPassword('correct horse'), h2 = await a.hashPassword('correct horse');
  assert.notEqual(h1.salt, h2.salt); assert.notEqual(h1.hash, h2.hash);
  assert.equal(await a.checkHash('correct horse', h1), true);
  assert.equal(await a.checkHash('correct hors', h1), false);
  assert.equal(await a.checkHash('', h1), false);
});

test('sign up, then sign in with the right password only', async () => {
  const a = make(), acc = await a.signup('Sam_01', 'hunter2hunter2', ip());
  assert.equal(acc.username, 'Sam_01'); assert.match(acc.id, /^[a-f0-9]{24}$/);
  assert.ok(!JSON.stringify(acc.pass).includes('hunter2'), 'no plain password stored');
  assert.equal((await a.login('sam_01', 'hunter2hunter2', ip())).id, acc.id, 'username is case-insensitive at sign-in');
  for (const [u, p] of [['Sam_01', 'wrong-password'], ['nobody', 'hunter2hunter2'], ['Sam_01', ''], ['', ''], [null, null], ['x'.repeat(50), 'hunter2hunter2']])
    await assert.rejects(a.login(u, p, ip()), e => e.status === 401 && /Wrong username or password/.test(e.message), `${u}/${p}`);
});

test('username rules: shape, reserved, unique ignoring case', async () => {
  const a = make();
  for (const bad of ['ab', 'a'.repeat(17), 'has space', 'dash-y', 'émile', '', 42, null]) await assert.rejects(a.signup(bad, 'password123', ip()), e => e.status === 400, String(bad));
  for (const r of ['admin', 'ADMIN', 'Nib', 'pip', 'moss', 'root']) await assert.rejects(a.signup(r, 'password123', ip()), e => e.status === 409 && /reserved/.test(e.message), r);
  await a.signup('Kim', 'password123', ip());
  await assert.rejects(a.signup('kim', 'password456', ip()), e => e.status === 409 && /taken/.test(e.message));
  await assert.rejects(a.signup('KIM', 'password456', ip()), e => e.status === 409);
  await a.signup('kim_2', 'password123', ip());
});

test('passwords need 8+ characters', async () => {
  const a = make();
  await assert.rejects(a.signup('shorty', '1234567', ip()), e => e.status === 400 && /8 characters/.test(e.message));
  await assert.rejects(a.signup('shorty', 12345678, ip()), e => e.status === 400);
  await a.signup('shorty', '12345678', ip());
});

test('too many tries from one IP are refused for a minute', async () => {
  let t = Date.now(); const a = make({ now: () => t });
  await a.signup('ratty', 'password123', '1.2.3.4');
  for (let i = 0; i < 9; i++) await assert.rejects(a.login('ratty', 'nope-nope', '1.2.3.4'), e => e.status === 401);
  await assert.rejects(a.login('ratty', 'password123', '1.2.3.4'), e => e.status === 429, 'even the right password, once limited');
  await a.login('ratty', 'password123', '5.6.7.8'); // another IP is fine
  t += 61_000; await a.login('ratty', 'password123', '1.2.3.4'); // and the minute passes
});

test('sessions: the cookie names the account; it cannot be forged, edited or used after expiry', async () => {
  const store = newStore(), a = make({ store }), acc = await a.signup('Sessy', 'password123', ip()), c = await cookie(a, acc);
  const u = await a.userFrom(req(c));
  assert.deepEqual([u.sub, u.id, u.name], [acc.id, acc.id, 'Sessy']);
  assert.match(await a.cookieFor(acc, true), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  const [id, exp, sig] = c.split('=')[1].split('.'), other = await a.signup('Other', 'password123', ip());
  assert.equal(await a.userFrom(req(`fo_session=${other.id}.${exp}.${sig}`)), null, 'another account');
  assert.equal(await a.userFrom(req(`fo_session=${id}.${+exp + 1e6}.${sig}`)), null, 'longer expiry');
  assert.equal(await a.userFrom(req(`fo_session=${id}.${exp}.AAAA`)), null, 'bad signature');
  assert.equal(await a.userFrom(req('')), null, 'no cookie');
  assert.equal(await make({ store: newStore() }).userFrom(req(c)), null, 'a different server secret');
  const later = Auth.create({ store, sessionSecret: '', now: () => Date.now() + 40 * 86400e3 });
  assert.equal(await later.userFrom(req(c)), null, 'expired');
});

test('the session secret: SESSION_SECRET when set, else one kept in the store and shared', async () => {
  const store = newStore(), s1 = Auth.create({ store, sessionSecret: '' }), s2 = Auth.create({ store, sessionSecret: '' });
  const acc = await s1.signup('Shared', 'password123', ip());
  assert.equal((await s2.userFrom(req(await cookie(s1, acc)))).name, 'Shared', 'a second server (same store) accepts the cookie');
  assert.equal(typeof await store.get('secret'), 'string');
  const e1 = Auth.create({ store, sessionSecret: 'x'.repeat(40) });
  assert.equal(await s1.userFrom(req(await cookie(e1, acc))), null, 'SESSION_SECRET is used instead of the stored one');
  assert.equal((await Auth.create({ store, sessionSecret: 'x'.repeat(40) }).userFrom(req(await cookie(e1, acc)))).name, 'Shared');
});

test('a good Google token makes an account that must pick a username', async () => {
  const a = make(), acc = await a.google(token());
  assert.equal(acc.username, ''); assert.equal(acc.google, '1234567890');
  const u = await a.userFrom(req(await cookie(a, acc)));
  assert.equal(u.name, ''); assert.equal(a.public(u).needsName, true); assert.equal(u.email, 'sam@example.com');
  await assert.rejects(a.setUsername(u.account, 'admin'), e => e.status === 409);
  await a.signup('Taken', 'password123', ip());
  await assert.rejects(a.setUsername(u.account, 'taken'), e => e.status === 409 && /taken/.test(e.message));
  await a.setUsername(u.account, 'GoogleSam');
  assert.equal((await a.google(token())).id, acc.id, 'the same Google account signs back in to the same account');
  assert.equal((await a.userFrom(req(await cookie(a, acc)))).name, 'GoogleSam');
  await assert.rejects(a.setUsername((await a.userFrom(req(await cookie(a, acc)))).account, 'Again'), e => e.status === 409, 'only once');
  await assert.rejects(a.setUsername(null, 'Nobody'), e => e.status === 401);
  await assert.rejects(a.login('GoogleSam', '', ip()), e => e.status === 401, 'no password on a Google account');
});

test('every kind of bad Google token is refused', async () => {
  const a = make();
  const bad = {
    'wrong audience': token({ aud: 'someone-else' }), 'wrong issuer': token({ iss: 'https://evil.example' }),
    expired: token({ exp: Math.floor(Date.now() / 1000) - 3600 }), 'unverified email': token({ email_verified: false }),
    'signed by another key': token({}, { key: other.privateKey }), 'unknown key id': token({}, { kid: 'nope' }),
    'alg none': b64({ alg: 'none', kid: 'k1' }) + '.' + b64({ aud: CLIENT, iss: 'accounts.google.com', sub: 'x', exp: 9e9 }) + '.',
    'tampered body': (() => { const t = token().split('.'); t[1] = b64({ aud: CLIENT, iss: 'accounts.google.com', sub: 'attacker', exp: 9e9, email_verified: true }); return t.join('.'); })(),
    garbage: 'not.a.token', empty: '', 'not a string': 42,
  };
  for (const [why, t] of Object.entries(bad)) await assert.rejects(a.google(t), e => e.status === 401, why);
});

test('no Google client id: Google is off, passwords still work', async () => {
  const a = make({ clientId: '' });
  assert.equal(a.googleConfigured, false); assert.equal(a.configured, true);
  await assert.rejects(a.google(token()), e => e.status === 503);
  await a.signup('NoGoogle', 'password123', ip());
});

test('saves are per account and size-checked', async () => {
  const a = make(), u1 = a.toUser(await a.signup('Saver', 'password123', ip())), u2 = a.toUser(await a.google(token({ sub: '999', email: 'kim@example.com' })));
  const first = await a.putSave(u1, { at: 5, keys: { 'first-office-crew-v1': '{"day":3}', 'not-ours': 'x' } });
  assert.deepEqual(await a.getSave(u1), { version: 1, at: first.at, keys: { 'first-office-crew-v1': '{"day":3}' } }); // the server's clock, not the device's
  // A device that last saw an older save gets the newer one back instead of overwriting it.
  const stale = await a.putSave(u1, { base: first.at - 1, keys: { 'first-office-crew-v1': '{"day":1}' } });
  assert.equal(stale.conflict, true); assert.equal(stale.save.keys['first-office-crew-v1'], '{"day":3}');
  const next = await a.putSave(u1, { base: first.at, keys: { 'first-office-crew-v1': '{"day":4}' } });
  assert.ok(next.ok && next.at > first.at);
  assert.equal(await a.getSave(u2), null);
  await assert.rejects(a.putSave(u1, { keys: { 'first-office-crew-v1': 'x'.repeat(1_100_000) } }), e => e.status === 413);
  await assert.rejects(a.putSave(u1, null), e => e.status === 400);
});
