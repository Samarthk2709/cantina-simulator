'use strict';
// Where the server keeps its data: accounts, saves, the leaderboard, the lag log, session logs.
// - Locally: JSON files in a folder (data/, gitignored, never served).
// - Hosted (Vercel): Upstash Redis over its REST API, when KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_*
//   pair) are set. The disk there doesn't keep anything between requests.
// Values are JSON. Keys are short strings like "users", "board", "save:<hash>".
const fs = require('node:fs'), path = require('node:path');

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = k => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, '_') + '.json'), logFile = k => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, '_') + '.log');
  return {
    kind: 'files',
    async get(k) { try { return JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch { return null; } },
    async set(k, v) { const f = file(k); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); },
    async del(k) { try { fs.unlinkSync(file(k)); } catch {} },
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
