// Runs the abuse prompts (tests/abuse/prompts.jsonl, plus controls.jsonl) against the live model, the way the game does:
// Nib's Stage 1 chat ("talk" beat), and an agent message (brief, then the agent's chat reply when it isn't a task).
// Writes tests/abuse/results.jsonl and prints token use. Calls DeepInfra with the real key (about 300 short calls).
//   node outputs/first-office/tests/abuse-eval.cjs
const fs = require('node:fs'), path = require('node:path');
const tokens = {calls: 0, in: 0, out: 0};
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { // counts tokens on every model call
  const r = await realFetch(...a);
  if (String(a[0]).includes('deepinfra')) r.clone().json().then(d => { tokens.calls++; tokens.in += d.usage?.prompt_tokens || 0; tokens.out += d.usage?.completion_tokens || 0; }).catch(() => {});
  return r;
};
const {brief, say} = require('../server.cjs'); // loads DEEPINFRA_API_KEY from .env
const nib = require('../nib-chat.cjs').create({provider: 'deepinfra', apiKey: process.env.DEEPINFRA_API_KEY});
const dir = path.join(__dirname, 'abuse'), read = f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const rows = [...read('prompts.jsonl'), ...read('controls.jsonl')];
const facts = {task: 'none', stopWhen: '', rules: [], stats: {companyReputation: 12, companyBugs: 7}, history: [], recent: [], event: '', memory: []};
const err = e => ({error: e.message, status: e.status});

async function run(row) {
  const out = {...row};
  try { out.nib = await nib.chat({beat: 'talk', message: row.prompt.slice(0, 200), history: [], memory: {playerName: 'Sam', facts: []}}); delete out.nib.latencyMs; } catch (e) { out.nib = err(e); }
  try {
    out.brief = await brief({text: row.prompt});
    if (out.brief.job === 'none') out.agent = await say({event: 'chat', agent: {id: 'pip', name: 'Pip'}, facts, text: row.prompt});
  } catch (e) { out.agent = err(e); }
  return out;
}
(async () => {
  const results = [];
  for (let i = 0; i < rows.length; i += 4) { results.push(...await Promise.all(rows.slice(i, i + 4).map(run))); process.stdout.write(`\r${results.length}/${rows.length}`); await new Promise(ok => setTimeout(ok, 12000)); } // up to 8 brief/say calls a batch: stays under the server's 40/min
  fs.writeFileSync(path.join(dir, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  await new Promise(ok => setTimeout(ok, 500));
  console.log(`\n${tokens.calls} calls, ${tokens.in} input tokens, ${tokens.out} output tokens (avg ${Math.round(tokens.in / tokens.calls)} in / ${Math.round(tokens.out / tokens.calls)} out per call)`);
})();
