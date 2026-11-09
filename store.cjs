'use strict';
// Where the server keeps its data: accounts, saves, the leaderboard, the lag log, session logs.
// - Locally: JSON files in a folder (data/, gitignored, never served).
// - Hosted (Vercel): Upstash Redis over its REST API, when KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_*
//   pair) are set. The disk there doesn't keep anything between requests.
// Values are JSON. Keys are short strings like "users", "board", "save:<hash>".
const fs = require('node:fs'), path = require('node:path');

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true }); let swept = 0;
  const file = k => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, '_') + '.json'), logFile = k => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, '_') + '.log');
  return {
    kind: 'files',
    async get(k) { try { return JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch { return null; } },
    async set(k, v) { const f = file(k); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); },
    async del(k) { try { fs.unlinkSync(file(k)); } catch {} },
    // Write only if the key doesn't exist yet (claiming a username): false if it does.
    // Add 1 and return the new count, in one step (two requests can't both read the same count). ttl: seconds, set on the first add.
    async incr(k, ttl = 3600) {
      const f = file(k).replace(/\.json$/, '.cnt'), now = Date.now(); let c = null; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (!c || c.exp < now) c = { n: 0, exp: now + ttl * 1000 }; c.n++; fs.writeFileSync(f, JSON.stringify(c));
      if (now - swept > 3600000) { swept = now; for (const x of fs.readdirSync(dir)) if (x.endsWith('.cnt')) try { if (JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')).exp < now) fs.unlinkSync(path.join(dir, x)); } catch {} } // old hours' counters go
      return c.n;
    },
    // Delete only if the value is still v, in one step (freeing a username can't delete a claim that just landed).
    async delIf(k, v) { const f = file(k); try { if (fs.readFileSync(f, 'utf8') !== JSON.stringify(v)) return false; fs.unlinkSync(f); return true; } catch { return false; } },
    async add(k, v) { // written aside, then linked into place: the key appears whole or not at all
      const f = file(k), t = f + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.add'; fs.writeFileSync(t, JSON.stringify(v));
      try {
        for (let i = 0; i < 2; i++) try { fs.linkSync(t, f); return true; } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          let raw = ''; try { raw = fs.readFileSync(f, 'utf8').trim(); } catch {}
          let ok = false; try { ok = JSON.parse(raw) != null; } catch {}
          if (ok) return false; // taken
          try { fs.unlinkSync(f); } catch {} // empty, null or cut short: as good as absent
        }
        return false;
      } finally { try { fs.unlinkSync(t); } catch {} }
    },
    // Write only if the stored value's .version is still `version` (compare-and-set). Sync file calls: nothing runs in between.
    // A missing or unversioned value counts as version 0.
    async setIf(k, v, version, mustExist) { let cur = null; try { cur = JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch {} if (!cur && mustExist) return false; if ((cur?.version ?? 0) !== version) return false; const f = file(k); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); return true; },
    // An append-only log, capped (bytes, here): one JSON line per entry. Locally nothing expires.
    async log(k, lines, { bytes = 2e6 } = {}) {
      const f = logFile(k);
      try { if (fs.statSync(f).size > bytes) fs.renameSync(f, f + '.old'); } catch {}
      fs.appendFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    },
    // A log's entries, oldest first (the rotated-out part too).
    async read(k) {
      const text = [logFile(k) + '.old', logFile(k)].map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('');
      return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
  };
}

// Missing, unversioned or unreadable (a value saved before a fix) counts as version 0.
// Unreadable: the version is read off the front ({"version":N,... is how every versioned value is written), else no match.
// ARGV[3] '1': the key must exist (an account edit must not bring back a deleted account).
const SET_IF = "local c = redis.call('GET', KEYS[1]) if not c and ARGV[3] == '1' then return 0 end local v = 0 if c then local ok, d = pcall(cjson.decode, c) if ok then if type(d) == 'table' and type(d.version) == 'number' then v = d.version end else v = tonumber(string.match(c, '^{\"version\":(%d+)')) or -1 end end if v ~= tonumber(ARGV[2]) then return 0 end redis.call('SET', KEYS[1], ARGV[1]) return 1";
function redisStore(url, token, fetchImpl = (...a) => fetch(...a)) {
  async function cmd(...args) {
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw Object.assign(new Error('storage unavailable'), { status: 503 });
    const j = await r.json(); if (j.error) throw Object.assign(new Error('storage error'), { status: 503 });
    return j.result;
  }
  return {
    kind: 'redis',
    async get(k) { const v = await cmd('GET', 'fo:' + k); return v == null ? null : JSON.parse(v); },
    async set(k, v, { ttl = 0 } = {}) { await cmd('SET', 'fo:' + k, JSON.stringify(v), ...(ttl ? ['EX', ttl] : [])); }, // ttl: seconds until Redis drops the key
    async del(k) { await cmd('DEL', 'fo:' + k); },
    async incr(k, ttl) { return cmd('EVAL', "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, 'fo:' + k, String(ttl || 3600)); },
    async delIf(k, v) { return (await cmd('EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, 'fo:' + k, JSON.stringify(v))) === 1; },
    async add(k, v) { return (await cmd('SET', 'fo:' + k, JSON.stringify(v), 'NX')) === 'OK'; },
    // Compare-and-set on .version, atomic in Redis (one Lua script): two requests can't both write over the same version.
    async setIf(k, v, version, mustExist) { return (await cmd('EVAL', SET_IF, 1, 'fo:' + k, JSON.stringify(v), String(version), mustExist ? '1' : '0')) === 1; },
    // Capped by entries (keep) and, if days is set, deleted that many days after the last write.
    async log(k, lines, { keep = 5000, days = 0 } = {}) {
      if (!lines.length) return;
      await cmd('LPUSH', 'fo:log:' + k, ...lines.map(l => JSON.stringify(l))); await cmd('LTRIM', 'fo:log:' + k, 0, keep - 1);
      if (days) await cmd('EXPIRE', 'fo:log:' + k, days * 86400);
    },
    async read(k) { return ((await cmd('LRANGE', 'fo:log:' + k, 0, -1)) || []).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); },
  };
}

function create({ dir } = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? redisStore(url, token) : fileStore(dir);
}
module.exports = { create, fileStore, redisStore };
