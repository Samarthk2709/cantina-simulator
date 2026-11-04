// The per-player AI limit: 30 typed messages an hour, 90 model calls an hour, per account (else per IP).
// Own server on a spare port, temp data folder, a fake key, so no request reaches the model except the brief/chat pair.
//   node --test outputs/first-office/tests/ai-limit.cjs
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const PORT = 55197, URL = `http://localhost:${PORT}`;

test('AI messages and calls are limited per hour', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-ailimit-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.cjs')], { env: { ...process.env, FIRST_OFFICE_PORT: PORT, FIRST_OFFICE_DATA: data, DEEPINFRA_API_KEY: 'fake', GOOGLE_CLIENT_ID: '', KV_REST_API_URL: '', UPSTASH_REDIS_REST_URL: '' }, stdio: 'pipe' });
  t.after(() => srv.kill());
  await new Promise((ok, bad) => { srv.stdout.on('data', d => /First Office on/.test(d) && ok()); srv.on('exit', c => bad(new Error('server exited ' + c))); });
  const post = async (url, body, from) => { const r = await fetch(URL + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': from }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  // Messages: a bad beat is refused after it's counted, so nothing reaches the model.
  for (let i = 0; i < 30; i++) assert.equal((await post('/api/nib/chat', { beat: 'x', message: 'hi ' + i }, '10.0.0.1')).status, 400);
  const over = await post('/api/nib/chat', { beat: 'x', message: 'one more' }, '10.0.0.1');
  assert.equal(over.status, 429); assert.match(over.body.error, /30 AI messages\. Try again in \d+ min/);
  assert.equal((await post('/api/agents/brief', { text: 'hunt bugs' }, '10.0.0.1')).status, 429, 'briefs share the limit');
  assert.equal((await post('/api/nib/chat', { beat: 'x', message: 'hi' }, '10.0.0.2')).status, 400, 'another player is unaffected');

  // Narration counts toward calls only: 90 an hour.
  for (let i = 0; i < 90; i++) assert.equal((await post('/api/agents/say', { event: 'bogus' }, '10.0.0.3')).status, 400);
  assert.equal((await post('/api/agents/say', { event: 'bogus' }, '10.0.0.3')).status, 429);

  // A brief that wasn't a task, then the agent chat with the same words: one message, not two.
  for (let i = 0; i < 29; i++) await post('/api/nib/chat', { beat: 'x', message: 'm' + i }, '10.0.0.4');
  assert.notEqual((await post('/api/agents/brief', { text: 'how are you' }, '10.0.0.4')).status, 429);
  assert.notEqual((await post('/api/agents/say', { event: 'chat', text: 'how are you' }, '10.0.0.4')).status, 429, 'the follow-up chat is free');
  assert.equal((await post('/api/agents/say', { event: 'chat', text: 'how are you' }, '10.0.0.4')).status, 429, 'but only once');
});
