/* Stage 3 agent harness.
   Code owns every decision: a routine per job reads the live game, picks one tool, and the tool runs
   through the same engine call as the player's buttons. The model (via server.cjs) only reads briefs
   into fields and writes the agents' sentences. Everything works without it. */
(window.Stage3Boot = window.Stage3Boot || []).push(function () {
  'use strict';
  const D = window.Stage2Data, E = window.Stage2Engine, G = window.Stage2, C = window.Stage3Scope;
  const rnd = () => Math.random(), pick = a => a[Math.floor(rnd() * a.length)];
  const T = id => E.targetById[id], roomName = (t, r) => T(t).rooms.find(x => x[0] === r)?.[1] || r;
  const S = () => G.live();
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  // ---------- roster ----------
  const ROSTER = {
    nib:  {name: 'Nib',  role: 'Co-lead'},
    pip:  {name: 'Pip',  role: 'Agent'},
    moss: {name: 'Moss', role: 'Agent'},
    rook: {name: 'Rook', role: 'Agent', price: 600},
    wren: {name: 'Wren', role: 'Agent', price: 900},
  };
  const SLOTS = [2, 3, 4, 6]; // agents that can run at once, by GPU rig tier
  const STATION = {hunt: 'hunt', ops: 'contract', forge: 'forge', rig: 'rig', hq: 'hq'};
  const DUR = {map: 2.6, hunt: 3.2, write: 3.6, submit: 1.6, validate: 2.6, buy: 2, chain: 3, take: 1.4};
  // Agents have a day's focus like you, at the same prices. Out of focus, they rest until you sleep.
  const FOCUS_COST = {map_room: D.COST.map, hunt_finding: D.COST.find, prove: D.COST.prove};
  const MAX_REWRITES = 2;

  // ---------- rules (AGENTS.md) ----------
  // Each rule is a tool or a piece of context the agent uses. Off means the agent skips that step.
  const RULES = [
    {k: 'scope', text: "Read the program's scope list and only work in rooms that are in scope.", tool: 'view_scope',
      without: `May map or hunt out-of-scope rooms: −${C.STRIKE_REP} rep and a strike. ${C.BAN_AT} strikes and the program bans the company.`, cost: 'None. Agents stop at the boundary.'},
    {k: 'lessons', text: "Read Nib's pattern book before hunting and writing reports.", tool: 'read_pattern_book',
      without: 'Agents guess the flawed line at 25% and write vaguer reports, so they pay less.', cost: 'None.'},
    {k: 'honest', text: 'Never claim more impact than the evidence shows.', tool: null,
      without: 'Agents sometimes overclaim impact: the report is rejected, −2 rep.', cost: 'None.'},
    {k: 'proof', text: 'Prove any tray candidate under 60% confidence before submitting it.', tool: 'prove',
      without: 'Agents submit tray candidates as-is: false alarms cost −3 rep each.', cost: 'Slower validation.'},
    {k: 'claim', text: 'Claim your room on the claims board. Skip rooms another agent has claimed.', tool: 'claim_room',
      without: 'Agents on one program go after the same finding; the slower one wastes the trip.', cost: 'Fewer rooms each.'},
    {k: 'spend', text: 'You may spend up to $1,000 on one purchase without asking.', tool: null,
      without: 'Agents stop and ask before every purchase.', cost: 'They spend without checking with you.'},
  ];
  const TOOLS = [
    ['Look', ['read_brief', 'read_rules', 'view_board', 'view_map', 'view_scope', 'view_claims', 'read_pattern_book', 'view_tray', 'view_shop']],
    ['Work', ['take_target', 'map_room', 'hunt_finding', 'write_report', 'submit_report', 'prove', 'submit_as_is', 'chain', 'claim_room']],
    ['Money', ['buy (budget or ask)']],
    ['Yours only', ['sleep', 'coffee', 'teach Nib', 'hire']],
  ];
  const crew = () => C.data();
  const rule = (a, k) => !!(crew().rules.all?.[k] || crew().rules[a.id]?.[k]);
  const ruleList = a => RULES.filter(r => rule(a, r.k));

  // ---------- agents ----------
  const agents = {};
  let speed = 1, paused = false, model = {ok: false, label: 'checking…'};
  const listeners = [];
  const changed = () => { window.Lag?.count('agents.changed'); listeners.forEach(fn => fn()); if (needs()) window.Loop.wake(); }; // a new task, answer or day: frames again

  function makeAgent(id) {
    const saved = crew().agents?.[id] || {};
    const a = {id, ...ROSTER[id], log: saved.log || [], task: saved.task || null, stats: saved.stats || blankStats(), queue: saved.queue || [], today: saved.today || blankDay(), ot: saved.ot || null, resume: [].concat(saved.resume || []), noOtDay: saved.noOtDay ?? null, status: 'idle', ver: 0, q: null,
      pos: null, path: [], station: null, timer: 0, next: null, bubble: '', lastPenalty: 0, nibWalking: false,
      energyDay: saved.energyDay ?? S().day};
    if (id === 'nib') Object.defineProperty(a, 'name', {get: () => S().nib || 'Nib'}); // the partner's chosen name, kept current
    Object.defineProperty(a, 'energy', {get: () => E.energyOf(S(), id)}); // focus lives in the save (engine.js), refilled each night
    if (a.task && !a.task.finished) a.status = a.task.standbyDay != null || a.task.restDay === S().day ? 'resting' : 'thinking';
    else if (a.task) a.status = 'done';
    a.log.forEach(m => { m.id = ++seq; });
    if (!a.log.length) intro(a);
    agents[id] = a; return a;
  }
  function intro(a) {
    if (a.id === 'nib') {
      say(a, 'Tell any of us what to do in plain words, like “get more bugs in Invoicely” or “hunt wherever there’s work”.');
      say(a, 'We only know your message and AGENTS.md. Mistakes cost reputation. The goal: Elite (60 rep), with at least 5 bugs from the team.');
    } else say(a, `Hi, I'm ${a.name}. What should I work on?`);
  }
  const blankDay = () => ({bugs: 0, earned: 0, pens: 0, wasted: 0, fix: null});
  const blankStats = () => ({accepted: 0, earned: 0, pens: 0, repLost: 0, asked: 0, guessed: 0, spent: 0, wasted: 0});
  let seq = 0;
  function push(a, kind, text, extra) { if (kind !== 'typing') window.SessionLog?.event('agent', {agent: a.id, kind, text: String(text).slice(0, 400)}); a.log.push({id: ++seq, kind, text, ...extra}); if (a.log.length > 160) a.log.shift(); a.ver++; return a.log[a.log.length - 1]; }
  const say = (a, t) => push(a, 'say', t), tool = (a, t) => push(a, 'tool', t), good = (a, t) => push(a, 'good', t), bad = (a, t) => push(a, 'bad', t), ruled = (a, t) => push(a, 'rule', t);
  function persist() {
    if (G.frozen()) return; // another tab took over, or the page is leaving: never write an old crew back
    const out = {};
    for (const a of Object.values(agents)) out[a.id] = {energyDay: a.energyDay, log: a.log.filter(m => m.kind !== 'typing').slice(-120).map(({kind, text, stats, task, reason, title, fix, rows}) => ({kind, text, stats, task, reason, title, fix, rows})), task: a.task, stats: a.stats, queue: a.briefing && a.reading ? [a.reading, ...a.queue] : a.queue, today: a.today, ot: a.ot, resume: a.resume, noOtDay: a.noOtDay};
    crew().agents = out; C.save();
  }

  const live = a => ['thinking', 'walking', 'working', 'waiting'].includes(a.status);
  // GPU slots go to agents actually working. One waiting on your answer doesn't block its teammates.
  const busy = () => Object.values(agents).filter(a => live(a) && a.status !== 'waiting').length;
  const slots = () => SLOTS[S().gpu] || 2;

  // ---------- what's left to do ----------
  const findingsOf = tid => T(tid).rooms.flatMap(r => E.roomFindings(tid, r[0]));
  const allowedRoom = (a, program, room) => !(a?.task?.avoid || []).includes(program + ':' + room) && (!a || !rule(a, 'scope') || C.inScope(program, room));
  // Findings an agent could still get to: not found, not on the tray, its tool owned, in a room it may work in.
  const workLeft = (a, tid) => findingsOf(tid).filter(fid => E.slotState(S(), fid) === 'open' && allowedRoom(a, tid, E.FINDINGS[fid].room) && C.inScope(tid, E.FINDINGS[fid].room)).length;
  const lockedLeft = tid => findingsOf(tid).filter(fid => E.slotState(S(), fid) === 'locked' && C.inScope(tid, E.FINDINGS[fid].room));
  const openTo = tid => !C.banned(tid) && E.canTake(S(), tid).ok;
  function bestProgram(a, skip = a.task?.skip || []) {
    // When it's the agent's pick, prefer a program no teammate is already on.
    const crowd = tid => Object.values(agents).filter(o => o !== a && live(o) && o.task?.program === tid).length;
    const ranked = D.ALL_TARGETS.filter(t => openTo(t.id) && !skip.includes(t.id)).map(t => ({id: t.id, n: workLeft(a, t.id), base: t.base, c: crowd(t.id)})).filter(x => x.n).sort((x, y) => x.c - y.c || y.n * y.base - x.n * x.base);
    return ranked[0] || null;
  }

  // ---------- plain words -> task ----------
  const PROGRAM_WORDS = [[/chatter|\bchat\b/, 'chat'], [/invoic/, 'inv'], [/vault/, 'vault'], [/northwind|\bbank\b/, 'bank'], [/parcel|shipping/, 'ship']];
  const AUTO = /\b(any(where| program| of them)?|whichever|wherever|you (choose|pick|decide)|pick (one|for me|a program)|your choice|best (one|program)|most (bugs|work|left)|(isn'?t|hasn'?t|not)( been)? (done|finished|completed|picked clean))\b/;
  // A standing order: the task never finishes on its own. When it runs out (or hits its stop), the agent waits for the next day and goes again.
  const FOREVER = /\b(every ?day|each day|daily|every morning|forever|always|non-?stop|from now on|standing order|long[- ]running|until i say( so| stop)?|until (told|i stop you)|keep (at it|on it|hunting|working))\b/;
  const CURRENT = /\b(current|this one|same (one|program)|active (one|program)|keep going|continue|again)\b/;
  // A question goes to chat, even when it mentions bugs ("why were there no accepted bugs?").
  const QUESTION = /^(why|what|how|who|when (?:is|are|was|will|did|do|does|can|should|would)|where|which|did|does|do you|are you|is|was|were|can you (tell|explain)|explain|tell me (why|what|how))\b/;
  // "stop", "please stop", "cancel that"; not "stop after 2 bugs" (a stop condition). crew.js's hint reads it the same way.
  const isStop = text => /^(?:please |pls |ok(?:ay)?,? )?(?:stop|cancel|abort|halt)\b/i.test(text) && !/\b(after|when|until|once|at)\b/i.test(text.replace(/\bat once\b/i, ''));
  // "cancel the queue": just the queued orders (the task running now goes on).
  const isClearQueue = text => /^(?:please |pls |ok(?:ay)?,? )?(?:cancel|clear|empty|drop|forget)\s+(?:the\s+|my\s+|your\s+|all\s+(?:the\s+)?)?(?:queue|queued(?: \w+)?|next ones?)\s*(?:,?\s*(?:please|pls|now|thanks))?\s*[.!]?$/i.test(text.trim());
  // "stop hunting vaultkit and hunt invoicely": the stop, then a new order. Only when what follows starts with a job of its own.
  const stopThen = text => { const r = isStop(text) && text.match(/^(?:please |pls |ok(?:ay)?,? )?(?:stop|cancel|abort|halt)\b[^,.;]*?(?:[,.;]|\band\b|\bthen\b)\s*(?:instead\s*,?\s*)?(.+)$/i)?.[1]; return r && !isQuestion(r) && /^(?:(?:and\s+then|and|then)\s+)?(?:instead\s+)?(?:hunt|map|explore|validate|buy|get|upgrade|switch|take|work on|go to|chain|connect)\b/i.test(r) && !/\b(?:don'?t|do not|never|no)\b/i.test(r) && parseLocal(r).job !== 'none' ? r : null; };
  const REQUEST = /^(?:please |pls )?(?:can|could|would|will) you (?:please )?(?:hunt|find(?! out)|look for|map|buy|get|upgrade|validate|prove|report|write|take|switch|work(?! out)|go|keep|start|explore|connect|chain|file|finish|clear|send)\b/; // "can you find out why…?" stays a question // "can you hunt vaultkit?" is an order, said politely
  const isQuestion = text => { const t = text.trim().toLowerCase().replace(/[’‘]/g, "'"); return !REQUEST.test(t) && !/^when you(?:'re| are)? (?:done|finished|finish)\b(?!.*\b(?:what|why|how|which|who|did)\b)/.test(t) && (/\?\s*$/.test(t) || QUESTION.test(t)); }; // "when you're done, hunt vaultkit" is an order (queued)
  function parseLocal(text) {
    const WORDS = {a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10};
    const t = text.toLowerCase().replace(/[’‘]/g, "'") // phones type curly apostrophes
      .replace(/(\d+(?:\.\d+)?)\s?k\b/g, (_, n) => String(Math.round(n * 1000))) // "$3k" is $3,000
      .replace(/\b(an?|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s+(?:more\s+|accepted\s+)?(?:bugs?|findings?|reports?)\b)/g, w => WORDS[w]); // "two bugs", "a bug"
    const task = {job: 'none', program: null, item: null, until: null, budget: null};
    // "don't hunt vaultkit", "stay away from the bank", "anything but parcelly": a program named within a few words of a
    // negation is not one to work on (nor to pick: skip). "not only vaultkit" still means vaultkit.
    const PROG = String.raw`(?:the\s+)?(?:northwind(?:\s+bank)?|bank|chatter\w*|chat\b|invoic\w*|vault\w*|parcel\w*|shipping)`;
    const NEG = new RegExp(String.raw`\b(?:don'?t|do not|never|not|except(?: for)?|instead of|(?<!(?:n't|not|never)\s+)(?:skip|avoid|leave|ignore|drop|excluding|besides|without)|apart from|stay (?:away from|off)|keep away from|steer clear of|other than|(?:any|every|all)\w*(?:\s+(?:program|one)s?)?\s+but)\s+(?:(?:hunt|hunting|map|mapping|touch|touching|work|working|go|going|pick|take|use|bother|look|on|in|at|with|near|into|to|for|the|any|of|bugs?|rooms?|them|keep|keeping|continue|continuing|want|you|anything)\s+){0,4}?` + PROG + String.raw`(?:\s*(?:,|and|or|nor)\s+` + PROG + ')*', 'g'), named = t.replace(NEG, '');
    const skip = (t.match(NEG) || []).flatMap(x => PROGRAM_WORDS.filter(([re]) => re.test(x)).map(([, id]) => id)); if (skip.length) task.skip = skip; // and not one to pick either (bestProgram)
    for (const [re, id] of PROGRAM_WORDS) if (re.test(named)) { task.program = id; break; }
    if (!task.program && AUTO.test(t)) task.program = 'auto';
    else if (!task.program && CURRENT.test(t)) task.program = 'current';
    // A purchase needs a buy word ("hunt vaultkit, don't upgrade the rig" and "hunt with the debugger" aren't purchases), or
    // an item named with no other job ("the tracer, budget $600"). Selling isn't something agents do: that's just talk.
    // The item is the one named after the buy word ("buy the tracer, we already have the debugger"), else the first named.
    const ITEMS = [['rig', /gpus?|\brigs?\b|compute/], ['fuzz', /fuzzer/], ['dbg', /debugger/], ['trace', /tracer/], ['coffee', /coffee machine|\b(?:buy|install)\b.*\bcoffee\b/], ['monitor', /\bmonitors?\b(?!\s+(?:the\s+)?(?:northwind|bank|chatter|chat\b|invoic|vault|parcel|shipping))/]];
    const firstItem = str => { let best = null, at = Infinity; for (const [id, re] of ITEMS) { const m = str.match(re); if (m && m.index < at) { at = m.index; best = id; } } return best; };
    // A purchase needs a buy word shortly before the item, not negated ("we don't need to buy the tracer"), and ahead of
    // any other job ("hunt vaultkit, then buy the tracer" and "get more bugs so we can upgrade the rig" are hunts first);
    // or an item named with no other job ("the tracer, budget $600"). Selling isn't something agents do: that's just talk.
    const BUYW = String.raw`(?:buy|buying|purchas\w*|upgrad\w*|install\w*|get|getting|order\w*|add|adding)`;
    const buyAt = t.search(new RegExp(String.raw`(?<!\b(?:if|once|when|after|before) (?:we |you |i )?)\b${BUYW}\s+(?:[\w'$]+\s+){0,4}?(?:gpus? rigs?|gpus?|rigs?|compute|fuzzer|debugger|tracer|coffee machine|monitors?)\b(?!\s+(?:rigs?\s+)?(?:working|running|going|busy|out|time|on\b|to work))`)); // "get the rig working on vaultkit" isn't a purchase
    const negBuy = new RegExp(String.raw`\b(?:don'?t|do not|never|no need to|not|no|without|stop|quit|avoid|skip|can'?t|cannot|shouldn'?t|won'?t|wouldn'?t|forget about|hold off(?: on)?)\s+(?:[\w']+\s+){0,3}?${BUYW}\b`).test(t);
    const workAt = t.search(/hunt|\bfind|look for|bugs?\b|\bmap(?:ping)?\b|explore|valid|tray|prove|report|draft|\bchain/), work = workAt >= 0, sell = /\b(sell|return|refund|downgrade)\b/.test(t);
    const buyWord = buyAt >= 0 && !negBuy && (!work || buyAt < workAt);
    const item = buyWord ? firstItem(t.slice(buyAt)) : firstItem(t);
    if (item && sell) task.job = 'none';
    else if (item && (buyWord || buyAt < 0 && !work && /^\s*(?:a |an |the |another |more |new |next |second |a second )*(?:gpus? rigs?|gpus?|rigs?|compute|fuzzer|debugger|tracer|coffee machine|monitors?)\s*(?:$|[,.!]|please\b|budget\b|up to\b|under\b|for \$|\$|until\b)/.test(t))) Object.assign(task, {job: 'buy', item}); // "the tracer, budget $600", not "watch the monitor"
    else if (/\bchain|\bconnect/.test(t)) task.job = 'chain'; // "find critical bugs" is a hunt
    else if (/valid|tray|candidate|prove/.test(t) || /\bfinds\b/.test(t) && !/\b(?:it|that|what|whatever|which|who|he|she|one|agent) finds\b/.test(t)) task.job = 'validate'; // "Nib's finds" is the tray; "whatever it finds" isn't
    else if (/\bmap(?:ping)?\b|explore|light up/.test(t) && !/\bhunt\b/.test(t) && !/^(?:please )?(?:report|finish|write|submit|send)\b/.test(t)) task.job = 'map'; // before report: "map parcelly and report back" is a map
    else if (/(report|draft)/.test(t) && !/\bhunt|find\b/.test(t)) task.job = 'report';
    else if (/\b(rep|reputation|elite)\b/.test(t)) task.job = 'hunt';
    else if (/hunt|find|look for|bugs?\b|keep going|continue/.test(t)) task.job = 'hunt';
    else if (/\btake\b|switch to|make .* active|work on/.test(t) && task.program) task.job = 'take';
    let m; const CASH = /(?:until|till|til|stop at|(?:stop )?(?:once|when) (?:we|you|i|it|cash)?\s*(?:have|has|hit|reach|reaches|make|is|are|get to))\b(?:(?!spend|budget|over\b|more than|up to|max)[^$\d])*?(?:\$\s?([\d,]+)|([\d,]+)\s*(?:dollars|bucks))/; // "till we have $3000", "until we hit 3000 dollars"
    if ((m = t.match(/(?<!\$\s?)(\d+)\s*more\s*(?:accepted\s+)?(bugs?|findings?|reports?)?\b/)) && (m[2] || !/\$|dollars?|cash|money|\brep\b|reputation/.test(t))) task.until = {kind: 'more', val: +m[1]}; // "$1000 more" isn't bugs
    else if ((m = t.match(/(\d+)\s*(?:accepted\s*)?(?:bugs?|findings?)\b/))) task.until = {kind: 'bugs', val: +m[1]};
    else if ((m = t.match(/rep(?:utation)?\s*(?:(?:of|up to|to|hits?|reaches|is|at|=)\s*)?(\d+)/) || t.match(/(\d+)\s*rep(?:utation)?\b/))) task.until = {kind: 'rep', val: +m[1]};
    else if (/elite/.test(t)) task.until = {kind: 'rep', val: 60};
    else if (/trusted/.test(t)) task.until = {kind: 'rep', val: 30};
    else if ((m = t.match(/tier\s*(\d)/))) task.until = {kind: 'tier', val: +m[1]};
    else if ((m = t.match(CASH))) task.until = {kind: 'cash', val: +(m[1] || m[2]).replace(/,/g, '')};
    const FLOOR = /\b(?:(?:cash|money|balance|funds|we|us|go|drop|fall)\b[^.,;$\d]*?\b(?:below|under|less than)|keep (?:at least|over|above))\s*\$?\s?([\d,]+)/;
    if ((m = t.match(FLOOR))) task.floor = +m[1].replace(/,/g, ''); // "don't let cash drop below 1000": purchases keep that much (decideBuy)
    const tb = t.replace(new RegExp(FLOOR.source, 'g'), '') /* a cash floor ("don't let cash drop below 1000") isn't a budget */.replace(CASH, '').replace(/rep(?:utation)?\s*(?:(?:of|up to|to|hits?|reaches|is|at|=)\s*)?(\d+)/g, ''); // "reputation up to 50" is a stop, not a budget
    if ((m = tb.match(/(?:up to|budget(?: of| is|:)?|spend(?: up to)?|max|(?:for |keep it |spend |stay )?(?:under|below|less than)|at most|within|limit(?: of)?|cap(?: of)?|(?:spend|spending|no|not) (?:more than|over|above))\s*\$?\s?(\d[\d,]*)(?![\d,]|\s*(?:(?:more|accepted)\s+)?(?:bugs?|findings?|reports?)\b)/) || tb.match(/\$?\s?(\d[\d,]*)\s*(?:dollars?\s*)?(?:budget|max|tops|or less|limit|cap)\b|(\d[\d,]*)\s*dollars/))) task.budget = +(m[1] || m[2]).replace(/,/g, '');
    if (/(?:don'?t spend|without spending|no spending)(?! (?:more than|over|above))/.test(t)) task.budget = 0; // "don't spend more than $700" is a budget, "don't spend anything" isn't
    if (FOREVER.test(t)) task.forever = true;
    // "buy the tracer once we have $3000": a purchase that waits on something isn't one to make now (offline it's just talk).
    if (task.job === 'buy' && (/\b(?:if|once|when|after|as soon as)\b[^.;]*?(?:\$\s?\d|\d|\b(?:cash|money|rep|reputation|afford|rich|cheap|earn|earned|make|made|saved)\b)/.test(t) || task.until?.kind === 'cash')) Object.assign(task, {job: 'none', item: null}); // waits on money: not now ("when you get a chance" is fine)
    return task;
  }
  function fromModel(m) {
    return {gist: typeof m.gist === 'string' && m.gist.trim() ? m.gist.trim().slice(0, 40) : null, job: m.job, program: m.program === 'none' ? null : m.program, item: m.item === 'none' ? null : m.item,
      until: m.until === 'none' ? null : {kind: m.until, val: m.value}, budget: m.budget < 0 ? null : m.budget};
  }
  // Model fields win; the local parser fills in what the model left out.
  function mergeBrief(local, m) {
    return {gist: m.gist, job: m.job, /* the model's reading wins, "not a task" included */ program: m.program || local.program, item: m.item || local.item, until: m.until || local.until, budget: m.budget ?? local.budget, forever: local.forever, skip: local.skip, floor: local.floor};
  }
  // Brief values that can't mean what they say: a stop at 0, or a target that's already met.
  function sanitize(a, task) {
    const notes = [], s = S(), u = task.until;
    if (u && !(u.val > 0)) { task.until = null; notes.push('A stop at 0 would end straight away, so I dropped it.'); }
    else if (u) {
      const now = {bugs: s.bugs, rep: s.rep, tier: s.gpu, cash: s.cash}[u.kind];
      if (task.forever && now !== undefined && now >= u.val) notes.push('That stop is already met, so this standing order ends straight away.'); // dropping it would make it run every day forever
      else if (u.kind === 'bugs' && now >= u.val) { task.until = {kind: 'more', val: u.val}; notes.push(`We already have ${s.bugs} bugs, so I'll stop after ${u.val} more.`); } // "get 2 bugs": 2 from now
      else if (now !== undefined && now >= u.val && !(u.kind === 'tier' && task.job === 'buy')) { // "upgrade until tier 2" at tier 2: nothing to buy (decideBuy ends at once), not "buy the next one"
        task.until = null;
        notes.push(`${{bugs: 'We already have ' + s.bugs + ' bugs', rep: 'Reputation is already ' + s.rep, tier: 'The rig is already tier ' + s.gpu, cash: 'We already have ' + money(s.cash)}[u.kind]}, so that stop would end straight away. I'll stop when the job runs out instead.`);
      }
    }
    if (task.until?.kind === 'tier' && task.until.val > D.RIGS.length - 1) task.until.val = D.RIGS.length - 1;
    return notes;
  }
  // Picks a program when the brief names none, "auto" or "current". Returns a note saying what was picked and why.
  function resolveProgram(a, task) {
    if (!['hunt', 'map', 'take'].includes(task.job)) { if (task.program === 'auto' || task.program === 'current') task.program = null; return null; }
    const last = a.task?.program;
    if (task.program === 'current') {
      const cur = last || S().target;
      task.program = cur; return cur ? `Sticking with ${T(cur).name}.` : null;
    }
    if (task.program && task.program !== 'auto') return null;
    if (!task.program && last && workLeft(a, last) && openTo(last) && !task.skip?.includes(last)) { task.program = last; return `You didn't name a program, so I'll stay on ${T(last).name}.`; }
    const best = bestProgram(a, task.skip || []);
    if (!best) { task.program = null; return null; }
    task.program = best.id;
    return `${task.program === last ? 'Staying on' : 'I picked'} ${T(best.id).name} because it has the most paying work left that nobody else is on: ${best.n} unfound finding${best.n > 1 ? 's' : ''} in scope.`;
  }
  const ITEM = {
    rig: () => { const s = S(), g = s.gpu, n = D.RIGS[g + 1]; return n && {name: n.name, cost: n.cost - D.RIGS[g].cost, station: STATION.rig, run: s => s.gpu !== g ? {ok: false, why: 'The rig was already upgraded.'} : E.setRig(s, g + 1)}; },
    fuzz: () => tool_('fuzz'), dbg: () => tool_('dbg'), trace: () => tool_('trace'), coffee: () => desk_('coffee'), monitor: () => desk_('monitor')};
  function tool_(id) { const x = D.TOOLS.find(t => t.id === id); return E.has(S(), id) ? null : {name: x.name, cost: x.cost, need: x.need && !E.has(S(), x.need) ? D.TOOLS.find(t => t.id === x.need).name : null, station: STATION.forge, run: s => E.buyTool(s, id)}; }
  function desk_(id) { const x = D.DESK.find(t => t.id === id); return S().desk.includes(id) ? null : {name: x.name, cost: x.cost, station: STATION.forge, run: s => s.desk.includes(id) ? {ok: false, why: 'We already own that.'} : E.toggleDesk(s, id)}; } // toggleDesk sells an owned item
  const itemName = id => id === 'rig' ? 'the next GPU rig' : (D.TOOLS.find(t => t.id === id) || D.DESK.find(t => t.id === id))?.name || id;

  // A few words on what a task is for, shown as the agent's title. The model may write a livelier one.
  function gistOf(task) {
    if (!task) return '';
    if (task.gist) return task.gist;
    const p = task.program && T(task.program) ? T(task.program).name : '';
    return {hunt: task.until?.kind === 'rep' ? 'Chasing reputation' : 'Getting more bugs' + (p ? ' in ' + p : ''), map: 'Exploring ' + (p || 'a program'), validate: "Checking Nib's finds", report: 'Finishing reports',
      buy: task.item === 'rig' ? 'Leveling up the rig' : 'Shopping for ' + itemName(task.item), chain: 'Building a critical', take: 'Switching to ' + p}[task.job] || '';
  }
  // The one line you see next to an agent: what it's doing right now, in plain words.
  function phrase(a) {
    const n = a.next, t = a.task;
    if (a.q) return 'Needs you · ' + a.q.text;
    if (a.status === 'queued') return 'Waiting for a free GPU';
    if (a.status === 'resting') return t?.standbyDay != null ? 'Standing order · back tomorrow' : 'Out of focus · back tomorrow';
    if ((a.status === 'walking' || a.status === 'working') && n) return n.phrase || gistOf(t);
    if (a.status === 'thinking') return gistOf(t) || 'Thinking';
    if (a.status === 'done' && t) { const last = lastDone(a); return last?.stats ? `Done · ${last.stats.accepted || !last.stats.earned ? `${last.stats.accepted} bug${last.stats.accepted === 1 ? '' : 's'}` : money(last.stats.earned)}${last.stats.pens ? ` · ${last.stats.pens} penalt${last.stats.pens === 1 ? 'y' : 'ies'}` : ''}` : 'Done'; }
    return 'Free';
  }

  function label(task) {
    if (!task) return '';
    if (task.forever) return label({...task, forever: false}) + ' · every day';
    const p = task.program && T(task.program) ? T(task.program).name : 'a program';
    return {hunt: `Hunt ${p}`, map: `Map ${p}`, validate: task.program && T(task.program) ? `Validate the ${p} finds` : 'Validate the tray', report: task.program && T(task.program) ? `Finish the ${p} reports` : 'Finish draft reports', chain: task.program && T(task.program) ? `Connect the ${p} chain` : 'Connect a critical chain', take: `Make ${p} the active program`,
      buy: `Buy ${itemName(task.item)}${task.until?.kind === 'tier' ? ` until tier ${task.until.val}` : ''}`}[task.job] || 'Talk';
  }
  function stopLabel(task) {
    const u = !task.raw && task.until?.kind === 'bugs' && S().bugs >= task.until.val ? {kind: 'more', val: task.until.val} : task.until; // the typing hint (no raw yet), as sanitize will read it; a started task keeps its own
    if (u) return {bugs: `the company has ${u.val} accepted bugs`, more: `I've landed ${u.val} more accepted bug${u.val > 1 ? 's' : ''}`, rep: `reputation reaches ${u.val}`, tier: `the rig is tier ${u.val}`, cash: `cash reaches ${money(u.val)}`}[u.kind];
    return {hunt: 'nothing in scope is left to find', map: 'every allowed room is mapped', validate: 'the tray is empty', report: 'no drafts are left', buy: 'the purchase is done', chain: 'no chain is ready', take: 'done'}[task.job] || '';
  }
  // Warnings shown while typing: what this brief leaves to the agent's judgment.
  function lint(a, task) {
    const w = [], s = S(), prog = task.program && T(task.program) ? task.program : null;
    const others = Object.values(agents).filter(o => o !== a && live(o) && prog && o.task?.program === prog && ['hunt', 'map'].includes(o.task?.job));
    if (['hunt', 'map', 'take'].includes(task.job) && !prog) w.push(task.program === 'current' ? 'Uses the current program.' : `No program named. ${a.name} will pick the one with the most paying work left.`);
    if (prog && C.banned(prog)) w.push(`${T(prog).name} has banned the company.`);
    if (prog && !E.canTake(s, prog).ok) w.push(`${T(prog).name}: ${E.canTake(s, prog).why}`);
    if (prog && ['hunt', 'map'].includes(task.job) && !workLeft(null, prog)) w.push(`${T(prog).name} has nothing left in scope to find.`);
    if (task.until && !(task.until.val > 0)) w.push('A stop at 0 ends straight away. It will be ignored.');
    if (task.job === 'hunt' && !task.until) w.push('No stop condition: runs until nothing in scope is left.');
    if (['hunt', 'map'].includes(task.job) && !rule(a, 'scope')) w.push(`No scope rule for ${a.name}: it won't check which rooms are off limits.`);
    if (task.job === 'hunt' && !rule(a, 'lessons')) w.push(`${a.name} won't read Nib's pattern book: slower hunting, vaguer reports.`);
    if (['hunt', 'report', 'validate'].includes(task.job) && !rule(a, 'honest')) w.push('No honesty rule: reports may overclaim (−2 rep).');
    if (task.job === 'validate' && !rule(a, 'proof')) w.push('No proof rule: shaky candidates get submitted as-is (−3 rep each false alarm).');
    if (task.job === 'validate' && !s.tray.length) w.push('The tray is empty. Nib fills it overnight.');
    if (others.length && !rule(a, 'claim')) w.push(`${others[0].name} is already on ${T(prog).name}. Without the claim rule they'll collide.`);
    if (task.job === 'buy') {
      const it = task.item && ITEM[task.item]?.();
      if (!task.item) w.push('Which item? Try “the GPU rig”, “the Tracer”…');
      else if (!it) w.push('Already owned or fully upgraded.');
      else { if (it.cost > s.cash) w.push(`Costs ${money(it.cost)}; we have ${money(s.cash)}.`); if (task.budget == null && !(rule(a, 'spend') && it.cost <= 1000)) w.push(`No budget given: ${a.name} will ask before paying ${money(it.cost)}.`); }
    }
    return w;
  }
  // Checked before a task starts. A problem means the agent explains it and suggests a fix instead of starting.
  function preflight(a, task) {
    const s = S(), prog = task.program, best = () => bestProgram(a, task.skip || []);
    const suggest = () => { const b = best(); return b && b.id !== prog ? ` ${T(b.id).name} has ${b.n} finding${b.n > 1 ? 's' : ''} left. Try “hunt ${T(b.id).name}”.` : ''; };
    if (['hunt', 'map', 'take'].includes(task.job)) {
      if (!prog && D.ALL_TARGETS.every(t => C.banned(t.id))) return 'Every program has banned the company (3 out-of-scope strikes each), so there\'s nothing left we can hunt. Turn on the scope rule in AGENTS.md before the next run.';
      if (!prog) return 'Every program we can work on is picked clean, or what\'s left needs tools we don\'t own. Buy a tool, or take a new program at the desk.';
      if (C.banned(prog)) return `${T(prog).name} banned the company after ${C.BAN_AT} strikes.` + suggest();
      const can = E.canTake(s, prog); if (!can.ok) return `${T(prog).name}: ${can.why}` + suggest();
      if (task.job === 'hunt' && !workLeft(a, prog)) {
        const locked = lockedLeft(prog);
        return `${T(prog).name} has nothing left in scope that I can find${locked.length ? `; ${locked.length} need${locked.length > 1 ? '' : 's'} the ${D.TOOLS.find(x => x.id === D.CLASSES[E.FINDINGS[locked[0]].cls].tool).name}` : ''}.` + suggest();
      }
      if (task.job === 'map' && !T(prog).rooms.some(r => !E.isLit(s, prog, r[0]) && allowedRoom(a, prog, r[0]))) return `Every room in ${T(prog).name} I'm allowed to map is already lit.` + suggest();
    }
    if (task.job === 'validate' && !s.tray.some(c => workable(c.fid) && onlyIn(task, c.fid)) && !Object.keys(s.found).some(fid => s.found[fid].status === 'draft' && s.found[fid].source === 'nib' && workable(fid) && onlyIn(task, fid))) return task.program && T(task.program) && s.tray.length ? `No ${T(task.program).name} finds on the tray.` : 'The tray is empty. Nib fills it overnight, so sleep first, then send me back.';
    if (task.job === 'report' && !Object.keys(s.found).some(fid => s.found[fid].status === 'draft' && s.found[fid].source !== 'manual' && workable(fid) && onlyIn(task, fid))) return task.program && T(task.program) ? `There are no ${T(task.program).name} draft reports waiting for me.` : 'There are no draft reports waiting for me. Your own hand-found reports stay yours.';
    if (task.job === 'chain') {
      if (!E.has(s, 'trace')) return 'Chains need the Tracer, and we don\'t own it. Try “buy the Tracer, budget $600”.';
      if (task.program && T(task.program) && s.chains[task.program]) return `The ${T(task.program).name} chain is already connected.`;
      if (task.program && T(task.program) && C.banned(task.program)) return `${T(task.program).name} banned the company after ${C.BAN_AT} strikes.`;
      if (task.program && T(task.program) && !E.canTake(s, task.program).ok) return `${T(task.program).name}: ${E.canTake(s, task.program).why}`;
      if (!task.program && D.ALL_TARGETS.every(t => C.banned(t.id))) return 'Every program has banned the company, so no chain can be connected.';
      if (!D.ALL_TARGETS.some(t => !C.banned(t.id) && (!task.program || t.id === task.program) && E.chainState(s, t.id).ready)) { const p = D.ALL_TARGETS.find(t => (!task.program || t.id === task.program) && !s.chains[t.id] && openTo(t.id)); /* the named one, if any */ return p ? `No chain is ready. ${p.name} needs both linked findings accepted first.` : 'Every chain is already connected.'; }
    }
    if (task.job === 'buy') {
      if (!task.item) return 'You didn\'t say what to buy. Try “upgrade the GPUs” or “buy the Tracer”.';
      const it = ITEM[task.item]?.();
      if (!it) return `We already own ${itemName(task.item)}, or it's fully upgraded.`;
      if (it.need) return `${it.name} needs the ${it.need} first.`;
      if (it.cost > s.cash) return `${it.name} costs ${money(it.cost)} and we have ${money(s.cash)}.`;
      if (task.floor != null && s.cash - it.cost < task.floor) return `${it.name} costs ${money(it.cost)}; that would leave ${money(s.cash - it.cost)}, under the ${money(task.floor)} you said to keep.`;
      if (task.budget === 0) return `${it.name} costs ${money(it.cost)}, and you said not to spend anything.`;
      if (task.budget != null && it.cost > task.budget) return `${it.name} costs ${money(it.cost)}, more than the ${money(task.budget)} budget. Send it again with “budget ${money(it.cost)}”.`;
    }
    return null;
  }

  // ---------- talking ----------
  // A message while the agent has a task: questions and "stop" go through now; a new task waits in its queue,
  // unless you send it with now (⌘↵ in the Team view, or "now: …"), which drops the current one.
  const hasTask = a => !!a.briefing || !!a.task && !a.task.finished; // briefing: its brief is still being read
  async function send(id, text, opts = {}) {
    const a = agents[id]; text = String(text || '').trim().slice(0, 300); if (!a || !text) return;
    push(a, 'user', text); changed();
    if (isClearQueue(text)) { // the queue, not the task running now
      const n = a.queue.length; a.queue = []; say(a, n ? `Cleared ${n} queued order${n > 1 ? 's' : ''}. ${hasTask(a) ? `Still on “${label(a.task)}”.` : ''}` : 'My queue is already empty.'); persist(); changed(); return;
    }
    const then = stopThen(text);
    if (then) { // "stop hunting vaultkit and hunt somewhere else": the stopped program (and any the stop names) isn't where it goes next
      const head = text.slice(0, text.length - then.length), was = hasTask(a) && a.task?.program;
      const skip = [was, ...PROGRAM_WORDS.filter(([re]) => re.test(head.toLowerCase())).map(([, id]) => id)].filter(x => x && T(x));
      if (/\b(?:queue|queued|everything|all of it|the rest)\b/i.test(head)) a.queue = []; // "cancel everything and hunt invoicely"
      stop(id, true); a.nextSkip = skip; return send(id, then, {now: true});
    } // "stop hunting vaultkit and hunt invoicely instead"
    if (isStop(text)) { if (/\b(?:queue|queued|everything|all of it|the rest)\b/i.test(text)) a.queue = []; return stop(id, true); } // "cancel everything, the queue too": nothing queued starts after
    if (isQuestion(text)) return chat(a, text);
    // Not a job the local parser knows: offline, that's talk. Online and busy, the model reads it now (talk goes to chat, an
    // order is queued as usual), so "thanks" isn't queued behind the task nor pauses a standing order. Idle, brief() reads it.
    const now = opts.now || /^now\b[:,]?\s*/i.test(text); text = text.replace(/^now\b[:,]?\s*/i, '') || text;
    if (hasTask(a) && !now && a.task?.forever && !a.task.finished && a.task.raw.replace(/^now\b[:,]?\s*/i, '') === text) { say(a, 'That standing order is already on.'); return; }
    if (hasTask(a) && !now && a.queue.includes(text) && parseLocal(text).job !== 'none') { say(a, 'That one is already in my queue.'); return; } // not for talk ("thanks" twice)
    // Not a job the local parser knows: offline, that's talk. Online and busy, the model reads it now (one reading, kept for
    // when it starts: modelRead), so "thanks" isn't queued behind the task nor pauses a standing order. Idle, brief() reads it.
    if (parseLocal(text).job === 'none' && (!model.ok || hasTask(a) && !now)) { // "now": brief() reads it (talk goes to chat there)
      if (!model.ok) return chat(a, text);
      const standby = a.task?.standbyDay != null || (a.task?.forever && a.status === 'resting'), held = !standby, n0 = a.briefN;
      if (held && a.queue.includes(text)) { const r = await modelRead(a, text); return !r || !r.job || r.job === 'none' ? chat(a, text) : say(a, 'That one is already in my queue.'); } // sent twice: talk is answered, an order isn't queued twice
      if (held) { a.queue.push(text); persist(); changed(); } // an ordinary queued order (its place kept) while it's read
      const r = await modelRead(a, text), i = held ? a.queue.indexOf(text) : -1;
      if (held && i < 0) return; // started already (it got this reading), or cleared: nothing more here
      if (!held && a.briefN !== n0) return; // stopped, or a newer message came in, while it was read
      if (!r || !r.job || r.job === 'none') { if (i >= 0) { a.queue.splice(i, 1); persist(); changed(); } reads.delete(readKey(a, text)); return chat(a, text); }
      if (held) { say(a, `Queued${a.queue.length > 1 ? ' #' + (i + 1) : ''}. I'll start it after ${a.task && !a.task.finished ? `“${label(a.task)}”` : 'this one'}.`); return; }
    }
    // A standing order done or out of focus for today: this runs now, and the order resumes tomorrow.
    if (hasTask(a) && (a.task?.standbyDay != null || (a.task?.forever && a.status === 'resting')) && !a.task.finished) { a.queue.unshift(text); return finish(a, a.task.program && !a.task.autoPick && C.banned(a.task.program) ? `Dropping the standing order: ${T(a.task.program).name} banned us.` : 'Pausing the standing order for this. It resumes tomorrow.'); }
    if (hasTask(a) && !now) {
      a.queue.push(text); say(a, `Queued${a.queue.length > 1 ? ' #' + a.queue.length : ''}. I'll start it after ${a.task && !a.task.finished ? `“${label(a.task)}”` : 'this one'}.`); persist(); changed(); return;
    }
    if (now && a.briefing && a.fromQueue) { a.queue.unshift(a.fromQueue); a.fromQueue = null; } // a queued brief still being read goes back in line, not lost
    return brief(a, text);
  }
  // Read a brief and start it. Returns false if it was refused or wasn't a task.
  // One model reading per message: send() may ask early (a busy agent), and the brief that starts it later uses the same one.
  const reads = new Map();
  const readKey = (a, text) => a.id + '\n' + (a.task ? label(a.task) : '') + '\n' + text; // read against the task it follows ("do that again")
  function modelRead(a, text) {
    const k = readKey(a, text); if (reads.has(k)) return reads.get(k);
    const p = api('/api/agents/brief', {text, last: a.task ? label(a.task) : ''}).then(fromModel, () => null);
    reads.set(k, p); setTimeout(() => reads.get(k) === p && reads.delete(k), 600000); return p; // a queued one waits a while: kept 10 min
  }
  async function brief(a, text) {
    const n = a.briefN = (a.briefN || 0) + 1; a.briefing = true; a.reading = text; persist(); // saved in the queue while it's read, so a reload or a new tab doesn't lose it
    try { return await readBrief(a, text, n); } finally { if (a.briefN === n) a.briefing = false; if (a.queue.length && !hasTask(a)) nextQueued(a); } // queued while this brief was read, then refused
  }
  async function readBrief(a, text, n) {
    let task = parseLocal(text), fromAI = false; const nextSkip = a.nextSkip; a.nextSkip = null; // this brief's only, whatever happens to it
    if (model.ok) {
      const typing = push(a, 'typing', 'Reading your message…'); changed();
      const r = await modelRead(a, text); reads.delete(readKey(a, text)); if (r) { task = mergeBrief(task, r); fromAI = true; }
      const i = a.log.indexOf(typing); if (i >= 0) a.log.splice(i, 1); a.ver++;
      if (a.briefN !== n) return false; // stopped, or a newer message came in while the model read this one
    }
    a.fromQueue = null; a.reading = null; persist(); // read: from here it's started or refused, not waiting in the queue (persist saves it there while it's read)
    if (task.job === 'none') { chat(a, text); return false; }
    if (nextSkip && (!task.program || task.program === 'auto')) task.skip = [...new Set([...(task.skip || []), ...nextSkip])]; // after "stop hunting X and hunt somewhere else"
    task.autoPick = (task.job === 'hunt' || task.job === 'map') && (!task.program || task.program === 'auto'); // no program named: the agent's pick, re-made each morning
    const notes = [resolveProgram(a, task), ...sanitize(a, task)].filter(Boolean);
    const problem = preflight(a, task);
    // A standing order on an empty tray (or no drafts) isn't refused: it just waits for tomorrow's.
    if (problem && (!task.forever || (task.program && C.banned(task.program)))) { push(a, 'refuse', problem); persist(); changed(); return false; }
    window.SessionLog?.event('task', {agent: a.id, brief: text, fromAI, task: {job: task.job, program: task.program, item: task.item, until: task.until, value: task.value, budget: task.budget, forever: !!task.forever}, notes});
    start(a, task, text, fromAI, notes);
    if (problem) finish(a, problem.split(/(?<=\.) /)[0]); // a standing order that can't run today waits for tomorrow instead of being refused
    return true;
  }
  // The next queued brief, once the current task is over. A refused one is skipped (its reason stays in the chat).
  let pulling = new Set();
  async function nextQueued(a) {
    if (pulling.has(a.id)) return; pulling.add(a.id);
    try { while (a.queue.length && !hasTask(a)) { const text = a.queue.shift(); push(a, 'sys', '— next in queue —'); a.fromQueue = text; const p = brief(a, text); changed(); await p; a.fromQueue = null; } } // brief() saves it in the queue while it's read
    finally { pulling.delete(a.id); if (a.queue.length && !hasTask(a)) setTimeout(() => nextQueued(a), 400); } // a finish inside the loop found it busy
  }
  function unpause(id, i) { const a = agents[id]; if (!a || !a.resume[i]) return; a.resume.splice(i, 1); a.ver++; persist(); changed(); }
  function unqueue(id, i) { const a = agents[id]; if (!a || !a.queue[i]) return; a.queue.splice(i, 1); a.ver++; persist(); changed(); }
  function start(a, task, raw, fromAI, notes) {
    const switching = live(a);
    if (switching) { a.q = null; say(a, `Dropping “${label(a.task)}”.`); release(a); a.status = 'idle'; } // its own GPU slot is free for the new task
    else if (a.task && !a.task.finished) say(a, `Dropping “${label(a.task)}”.`); // resting, out of focus
    else if (a.task) push(a, 'sys', '— new task —');
    a.task = {...task, autoPick: !!task.autoPick, raw, notes: notes || [], drafts: [], tried: {}, avoid: [], seen: {}, written: {}, rewrites: {}, accepted: 0, spent: 0, finished: false, overclaimLearned: false, standbyDay: null};
    if (task.forever) { const r = raw.replace(/^now\b[:,]?\s*/i, ''); a.resume = a.resume.filter(x => x !== r); a.queue = a.queue.filter(x => x !== r); } // the order sent again: one copy, not two (other standing orders stay paused)
    a.stats = blankStats();
    a.status = busy() < slots() ? 'thinking' : 'queued';
    push(a, 'brief', '', {task: {label: label(a.task), stop: stopLabel(a.task), budget: a.task.budget, program: a.task.program, fromAI}});
    (notes || []).forEach(n => ruled(a, n));
    if (a.status === 'queued') say(a, `All ${slots()} GPU slots are busy. I'll start when one frees up. (A bigger rig adds slots.)`);
    else narrate(a, 'start', planLine(a));
    persist(); changed();
  }
  function planLine(a) {
    const t = a.task, n = ruleList(a).length;
    return `${label(t)}. ${t.forever && t.until && t.until.kind !== 'more' && ({bugs: S().bugs, rep: S().rep, tier: S().gpu, cash: S().cash}[t.until.kind] >= t.until.val) ? 'That stop is already met, so I\'m done.' : t.forever ? (t.until && t.until.kind !== 'more' ? `Standing order: every day until ${stopLabel(t)}, then I stop for good.` : `Standing order: when ${stopLabel(t)}, I'll go again the next day.`) : `I'll stop when ${stopLabel(t)}.`} ${n ? `Following ${n} rule${n > 1 ? 's' : ''} from AGENTS.md.` : "AGENTS.md has no rules for me, so I'll use my own judgment."}`;
  }
  function chat(a, text) {
    const t = a.task, last = lastDone(a);
    const fallback = t && !t.finished ? `I'm on “${label(t)}”, stopping when ${stopLabel(t)}. So far: ${a.stats.accepted} accepted, ${a.stats.pens} penalt${a.stats.pens === 1 ? 'y' : 'ies'}.`
      : last ? `My last task was “${last.text}”. ${last.reason || ''} ${last.stats ? `${last.stats.accepted} accepted, ${last.stats.pens} penalties.` : ''}`.trim()
      : 'I can hunt, map, validate the tray, finish reports, buy upgrades, connect a chain or switch the active program. Give me the job, the program and when to stop.';
    narrate(a, 'chat', fallback, {text});
  }
  const lastDone = a => [...a.log].reverse().find(m => m.kind === 'done');

  // ---------- narration (the model writes words, never decisions) ----------
  async function api(url, body) {
    const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(16000)});
    if (!r.ok) throw new Error('model ' + r.status); return r.json();
  }
  function facts(a, event) {
    const st = a.stats, mine = crew().pens.filter(p => p.who === a.name).slice(-3).map(p => `${p.title}: ${p.text}`);
    const done = a.log.filter(m => m.kind === 'done').slice(-2).map(m => `Finished task "${m.text}": ${m.reason || ''} ${m.stats ? m.stats.accepted + ' accepted, ' + m.stats.pens + ' penalties' : ''}`);
    return {task: a.task ? label(a.task) : 'none', stopWhen: a.task ? stopLabel(a.task) : '', rules: ruleList(a).map(r => r.text),
      stats: {acceptedThisTask: st.accepted, earnedThisTask: st.earned, penaltiesThisTask: st.pens, reputationLostThisTask: st.repLost, questionsAsked: st.asked, wastedTrips: st.wasted, companyReputation: S().rep, companyBugs: S().bugs},
      history: [...(a.task?.notes || []).map(n => 'When this task started: ' + n), ...mine.map(x => 'Earlier penalty: ' + x), ...done],
      recent: a.log.filter(m => ['say', 'tool', 'good', 'bad', 'rule', 'pen', 'user', 'refuse'].includes(m.kind)).slice(-8).map(m => `${m.kind}: ${m.text}`), event,
      memory: a.id === 'nib' ? (S().memories || []) : []};
  }
  // The scripted line shows at once; the model's version replaces it when it arrives.
  function narrate(a, event, fallback, extra = {}) {
    const msg = push(a, 'say', fallback); changed();
    if (!model.ok) return msg;
    msg.pending = true;
    api('/api/agents/say', {event, agent: {id: a.id, name: a.name}, facts: facts(a, fallback), text: extra.text})
      .then(r => { if (r.say) { msg.text = r.say; msg.ai = true; } })
      .catch(() => {}).finally(() => { msg.pending = false; a.ver++; changed(); });
    return msg;
  }

  // ---------- questions ----------
  function ask(a, text, opts, fallback) {
    a.q = {text, opts, day: S().day}; a.status = 'waiting'; a.stats.asked++; a.ver++; // waits for you: no timer
    push(a, 'ask', text); changed();
  }
  function answer(id, i) {
    const a = agents[id]; if (!a?.q) return;
    if (a.q.ot && a.q.day !== S().day) { a.q = null; a.status = busy() < slots() ? 'thinking' : 'queued'; push(a, 'sys', 'New day, full focus: no coffee run needed.'); persist(); changed(); return true; } // yesterday's out-of-focus question
    const o = a.q.opts[i]; if (!o) return false; a.q = null; a.status = busy() < slots() ? 'thinking' : 'queued'; // a teammate may have taken the slot while it waited
    push(a, 'user', o.label); o.fn(a); a.ver++; persist(); changed(); return true;
  }

  // ---------- running a tool ----------
  // Agents use the engine exactly like the player: same rules, same checks, same save. Their own program
  // and energy are swapped in for the call, so they never spend the player's focus.
  function exec(a, fn, keepTarget) {
    // engine.js asAgent swaps in the agent's focus and program, and tags each call so a server replays it the same way.
    // asAgent opens an unopened program's map; a recorded call (meta) makes the server open it too, even if fn records nothing.
    const prog = ['hunt', 'map', 'take'].includes(a.task?.job) && a.task.program || null, fresh = prog && !S().lit[prog]; // only these work in a program: validating the vaultkit finds doesn't open its map
    return G.agentAct(s => E.asAgent(s, a.id, prog, keepTarget, fresh ? s => (E.meta(s, {}), fn(s)) : fn));
  }
  const act = (toolName, station, dur, run, onResult, desc) => ({act: {toolName, station, dur, run, onResult, desc}});
  function stepPhrase(n, a) {
    const d = n.desc || '', lc = d.toLowerCase(), prog = a.task?.program;
    return {hunt_finding: `Hunting in ${n.room && prog ? roomName(prog, n.room) : 'the code'}`, map_room: `Mapping ${d}`, write_report: `Writing up the ${lc}`, submit_report: `Sending the ${lc} report`,
      prove: "Proving one of Nib's finds", submit_as_is: "Submitting one of Nib's finds", buy: `Buying ${d}`, chain: `Chaining a critical in ${d}`, take_target: `Switching to ${d}`}[n.toolName] || gistOf(a.task);
  }
  // A teammate already on its way to this step (the same tray find, the same room to map): the agent picks another.
  const headingTo = (a, f) => Object.values(agents).some(o => o !== a && (o.status === 'walking' || o.status === 'working') && f(o)); // on the way or at it: a finished step's `next` lingers while thinking
  const room = (rid, x) => { x.act.room = rid; return x; }; // remembered so a penalty can mark the room to avoid
  // Floating finds (#16): a label rises from the agent's head on the floor (crew.js). The chip (#4) carries the money.
  const floatUp = (a, text, kind, after) => window.Stage3Float?.(a.id, text, kind, after); // after: the pay chip, which leaves the head first
  function paid(a, r, station) {
    if (!r.accepted) return;
    a.task.accepted++; a.stats.accepted++; a.stats.earned += r.pay || 0; a.today.bugs++; a.today.earned += r.pay || 0;
    const chip = G.payChip?.(r, station, a.id); // the chip flies from the agent to the wallet
    if (!chip) G.floatAt('+' + money(r.pay), station);
    G.toast(r.crit ? `CRITICAL · ${a.name} · +${money(r.pay)}` : `${a.name}: ${r.grade} report · +${money(r.pay)} · +${r.rep} rep`, r.crit ? 'crit' : 'good');
    if (r.tierUp) G.toast('Reputation: ' + r.tierUp.name + '. ' + r.tierUp.perk, 'good');
    floatUp(a, (r.crit ? 'CRITICAL' : r.grade + ' report') + (r.rep ? ` · +${r.rep} rep` : ''), r.crit ? 'crit' : 'find', chip); // #16
  }

  // ---------- job routines: read the game, pick one tool ----------
  const claims = {}; // agentId -> {program, room}
  const claimedByOther = (a, program, room) => Object.entries(claims).some(([id, c]) => id !== a.id && agents[id] && live(agents[id]) && c.program === program && c.room === room);
  function look(a, key, line) { if (a.task.seen[key]) return; a.task.seen[key] = 1; tool(a, line); }
  function reached(a) {
    const u = a.task.until, s = S(); if (!u) return false;
    return {bugs: () => s.bugs >= u.val, more: () => a.task.accepted >= u.val, rep: () => s.rep >= u.val, tier: () => s.gpu >= u.val, cash: () => s.cash >= u.val}[u.kind]?.() || false;
  }

  function decide(a) {
    const t = a.task, s = S();
    if (['hunt', 'map', 'take'].includes(t.job) && !t.program) return {done: 'Nothing in scope is left to find in any program.'};
    look(a, 'brief', '› read_brief');
    look(a, 'rules', `› read_rules · AGENTS.md${crew().rules[a.id] && Object.values(crew().rules[a.id]).some(Boolean) ? ` + agents/${a.id}.md` : ''} · ${ruleList(a).length} rules`);
    if (t.program) {
      if (C.banned(t.program)) return {done: `${T(t.program).name} has banned the company. I can't work there.`};
      if (!E.canTake(s, t.program).ok) return {done: `${T(t.program).name}: ${E.canTake(s, t.program).why}`};
    }
    if (reached(a) && !draftsOwned(a, s).length) return {done: 'stop'}; // a stop already met (a standing order's, or a teammate got there first): no step after "done"
    return ({hunt: decideHunt, map: decideMap, validate: decideValidate, report: decideReport, buy: decideBuy, chain: decideChain, take: decideTake})[t.job](a, t, s);
  }

  const workable = fid => !!E.FINDINGS[fid] && !C.banned(E.FINDINGS[fid].target); // a banned program takes nothing: its drafts and tray finds are dead
  const draftsOwned = (a, s) => a.task.drafts.filter(fid => s.found[fid] && s.found[fid].status === 'draft' && workable(fid));
  function decideHunt(a, t, s) {
    const prog = T(t.program);
    look(a, 'map', `› view_map(${prog.name})`);
    if (rule(a, 'scope')) look(a, 'scope', `› view_scope(${prog.name}) · off limits: ${C.outOfScope(prog.id).map(r => roomName(prog.id, r)).join(', ')}`);
    if (rule(a, 'lessons')) look(a, 'lessons', `› read_pattern_book · ${Object.values(s.lessons).reduce((n, l) => n + l.clean + l.noisy, 0)} lessons`);
    if (rule(a, 'claim')) look(a, 'claims', '› view_claims');
    const draft = draftsOwned(a, s)[0];
    if (draft) return reportStep(a, draft, s);
    if (reached(a)) return {done: 'stop'};
    if (!s.lit[prog.id] && headingTo(a, o => o.next?.toolName === 'map_room' && o.task?.program === prog.id)) return {asked: true}; // a teammate is opening it: wait
    if (!s.lit[prog.id]) return act('map_room', STATION.hunt, DUR.map, () => ({ok: true}), r => r.ok ? good(a, `Opened the ${prog.name} map at ${prog.rooms[0][1]}.`) : bad(a, r.why || 'Couldn\'t open it.'), prog.rooms[0][1]); // before claims: an unopened map shows only its first room
    const lit = s.lit[prog.id];
    const open = lit.flatMap(rid => E.roomFindings(prog.id, rid)).filter(fid => E.slotState(s, fid) === 'open' && allowedRoom(a, prog.id, E.FINDINGS[fid].room) && !(rule(a, 'claim') && claimedByOther(a, prog.id, E.FINDINGS[fid].room)));
    if (open.length) {
      const fid = open[0], f = E.FINDINGS[fid], lines = D.CLASSES[f.cls].variants[f.variant], bug = lines.findIndex(l => l.bad);
      if (rule(a, 'claim') && claims[a.id]?.room !== f.room) { claims[a.id] = {program: prog.id, room: f.room}; tool(a, `› claim_room(${roomName(prog.id, f.room)})`); }
      const tried = t.tried[fid] || (t.tried[fid] = []);
      const p = rule(a, 'lessons') ? Math.max(0.25, E.precision(s, f.cls)) : 0.25;
      const wrong = lines.map((_, i) => i).filter(i => i !== bug && !tried.includes(i));
      const line = !wrong.length || rnd() < p ? bug : pick(wrong);
      if (!tried.length) tool(a, `Something off in ${roomName(prog.id, f.room)}. Reading the sketch.`);
      return room(f.room, act('hunt_finding', STATION.hunt, DUR.hunt, s => E.guess(s, fid, line, s.actor), r => {
        if (!r.ok && E.slotState(S(), fid) === 'open') return bad(a, r.why || 'Could not hunt there.'); // banned, out of focus…: not a teammate
        if (!r.ok) { const f = S().found[fid], mate = f?.source === 'agent' && f.by !== a.name, fix = mate && !rule(a, 'claim') ? 'claim' : null; // the claim rule only keeps teammates apart
          a.stats.wasted++; a.today.wasted++; if (fix) a.today.fix ??= fix; return note(a, mate ? 'A teammate got to that finding first, so my trip was wasted.' : 'Someone got to that finding first, so my trip was wasted.', fix); }
        tried.push(line);
        if (r.hit) { t.drafts.push(fid); tool(a, `Found it on line ${line + 1}: ${D.CLASSES[f.cls].name.toLowerCase()}.`); }
        if (r.hit) floatUp(a, '+1 bug', 'find'); // #16
      }, `${D.CLASSES[f.cls].name} in ${roomName(prog.id, f.room)}, line ${line + 1}`));
    }
    const dark = prog.rooms.filter(r => E.canMap(s, prog.id, r[0]) && allowedRoom(a, prog.id, r[0]) && !headingTo(a, o => o.next?.toolName === 'map_room' && o.next.room === r[0] && o.task?.program === prog.id));
    if (dark.length) {
      const r = dark[0];
      return room(r[0], act('map_room', STATION.hunt, DUR.map, s => E.mapRoom(s, r[0]), res => res.ok ? tool(a, `Mapped ${r[1]}.`) : bad(a, res.why), r[1]));
    }
    if (headingTo(a, o => o.next?.toolName === 'map_room' && o.task?.program === prog.id)) return {asked: true}; // a teammate's map may open more: wait, don't finish
    // "Wherever there's work": this program is dry, so move on to the next best one (each once a day, so it can't ping-pong).
    if (t.autoPick) { const b = bestProgram(a), moved = t.moved || (t.moved = []); if (b && b.id !== prog.id && !moved.includes(b.id)) { moved.push(prog.id); t.program = b.id; t.seen = {}; tool(a, `Nothing left for me in ${prog.name}. Moving on to ${T(b.id).name}.`); return decideHunt(a, t, s); } }
    const locked = lockedLeft(prog.id).filter(fid => allowedRoom(a, prog.id, E.FINDINGS[fid].room));
    if (locked.length) return {done: `What's left in ${prog.name} needs the ${D.TOOLS.find(x => x.id === D.CLASSES[E.FINDINGS[locked[0]].cls].tool).name}. I can't buy tools on a hunting brief.`};
    const claimed = rule(a, 'claim') && prog.rooms.some(r => claimedByOther(a, prog.id, r[0]));
    return {done: claimed ? `The rest of ${prog.name} is claimed by teammates, so I'm done here.` : `Nothing left in ${prog.name} that I'm allowed to touch.`};
  }
  function reportStep(a, fid, s) {
    const f = E.FINDINGS[fid], t = a.task, name = D.CLASSES[f.cls].name;
    if (!t.written[fid]) {
      return act('write_report', STATION.ops, DUR.write, s => {
        const honest = rule(a, 'honest') || t.overclaimLearned, q = rule(a, 'lessons') && E.knows(s, f.cls) ? 0.85 : 0.45;
        const picks = {};
        for (const sec of D.SECTIONS) {
          let i = rnd() < q ? 0 : 1;
          if (sec.id === 'impact' && !honest && rnd() < 0.3) i = 2; // overclaim
          if (!E.setSection(s, fid, sec.id, i).ok) { i = 1; E.setSection(s, fid, sec.id, i); }
          picks[sec.id] = i;
        }
        return {ok: true, picks, grade: E.gradeOf(s.found[fid].report).grade};
      }, r => {
        if (!r.ok) { t.drafts = t.drafts.filter(x => x !== fid); return bad(a, r.why || 'Could not write it.'); }
        t.written[fid] = true;
        tool(a, `${D.SECTIONS.map(x => x.name + ':' + ['best', 'vague', 'overclaim'][r.picks[x.id]]).join(' ')}`);
        tool(a, r.picks.impact === 2 ? 'Wrote the impact up as big as it could plausibly be.' : r.grade === 'F' ? 'Report drafted. It\'s thin.' : `Report drafted. It reads like ${/^[AEFS]/.test(r.grade) ? 'an' : 'a'} ${r.grade}.`);
      }, name);
    }
    return act('submit_report', STATION.ops, DUR.submit, s => E.submit(s, fid), r => {
      if (!r.ok) { t.drafts = t.drafts.filter(x => x !== fid); return bad(a, r.why || 'Could not submit.'); }
      if (r.accepted) { t.drafts = t.drafts.filter(x => x !== fid); push(a, 'win', `${name} · ${T(f.target).name} · ${r.grade} · ${money(r.pay)}${r.crit ? ' · CRITICAL' : ''}`); return paid(a, r, STATION.ops); }
      t.rewrites[fid] = (t.rewrites[fid] || 0) + 1;
      if (r.over) { t.overclaimLearned = true; penaltyLine(a, C.penalize(S(), a.name, 'Report rejected', `Overclaimed the impact in the ${name.toLowerCase()} report.${r.repDelta < 0 ? ` −${-r.repDelta} rep.` : ''}`, -r.repDelta || 0, null, true)); }
      else tool(a, `Sent back: ${String(r.why).replace(/^Rejected: /, '')}`);
      if (t.rewrites[fid] > MAX_REWRITES) { t.drafts = t.drafts.filter(x => x !== fid); say(a, `I can't get the ${name} report past the triager. It's at Finds for you.`); }
      else t.written[fid] = false;
    }, name);
  }
  function decideMap(a, t, s) {
    const prog = T(t.program);
    look(a, 'map', `› view_map(${prog.name})`);
    if (rule(a, 'scope')) look(a, 'scope', `› view_scope(${prog.name}) · off limits: ${C.outOfScope(prog.id).map(r => roomName(prog.id, r)).join(', ')}`);
    if (!s.lit[prog.id] && headingTo(a, o => o.next?.toolName === 'map_room' && o.task?.program === prog.id)) return {asked: true}; // a teammate is opening it: wait
    if (!s.lit[prog.id]) return act('map_room', STATION.hunt, DUR.map, () => ({ok: true}), r => r.ok ? good(a, `Opened the ${prog.name} map at ${prog.rooms[0][1]}.`) : bad(a, r.why || 'Couldn\'t open it.'), prog.rooms[0][1]);
    const dark = prog.rooms.filter(r => E.canMap(s, prog.id, r[0]) && allowedRoom(a, prog.id, r[0]) && !headingTo(a, o => o.next?.toolName === 'map_room' && o.next.room === r[0] && o.task?.program === prog.id));
    if (!dark.length && headingTo(a, o => o.next?.toolName === 'map_room' && o.task?.program === prog.id)) return {asked: true}; // a teammate's map may open more: wait
    if (!dark.length) return {done: `Every room in ${prog.name} I'm allowed to map is lit.`};
    const r = dark[0];
    return room(r[0], act('map_room', STATION.hunt, DUR.map, s => E.mapRoom(s, r[0]), res => res.ok ? tool(a, `Mapped ${r[1]}. ${E.roomFindings(prog.id, r[0]).length} findings to look at.`) : bad(a, res.why), r[1]));
  }
  const onlyIn = (t, fid) => !t.program || !T(t.program) || E.FINDINGS[fid].target === t.program; // "validate the vaultkit finds"
  function decideValidate(a, t, s) {
    look(a, 'tray', `› view_tray · ${s.tray.length} candidates`);
    const draft = draftsOwned(a, s)[0];
    if (draft) return reportStep(a, draft, s);
    const nibDraft = Object.keys(s.found).find(fid => s.found[fid].status === 'draft' && s.found[fid].source === 'nib' && workable(fid) && onlyIn(t, fid) && !taken(a).has(fid) && !(t.rewrites[fid] > MAX_REWRITES));
    if (nibDraft) { t.drafts.push(nibDraft); return reportStep(a, nibDraft, s); }
    const c = s.tray.find(x => workable(x.fid) && onlyIn(t, x.fid) && !headingTo(a, o => o.next?.cid === x.id));
    if (!c) return {done: s.tray.some(x => workable(x.fid) && onlyIn(t, x.fid)) ? 'A teammate is on the rest of the tray.' : t.program && T(t.program) ? `No ${T(t.program).name} finds left on the tray.` : s.tray.length ? 'What\'s left on the tray is from programs that banned us.' : 'The tray is empty.'};
    const f = E.FINDINGS[c.fid], name = D.CLASSES[f.cls].name, proof = rule(a, 'proof') && c.conf < 60;
    const step = act(proof ? 'prove' : 'submit_as_is', STATION.ops, proof ? DUR.validate + 1.5 : DUR.validate, s => proof ? E.prove(s, c.id) : E.submitRaw(s, c.id), r => {
      if (!r.ok) return bad(a, r.why || 'Gone.');
      if (proof) {
        if (!r.real) return tool(a, 'Proof showed a false alarm. Closed safely, no penalty.');
        push(a, 'win', `${name} · proven · ${r.paid.grade} · ${money(r.paid.pay)}`); return paid(a, r.paid, STATION.ops); // proven finds file themselves
      }
      if (!r.real) return penaltyLine(a, {...C.penalize(S(), a.name, 'False alarm', `Submitted a ${c.conf}% candidate as-is. It wasn't real.${r.repDelta < 0 ? ` −${-r.repDelta} rep.` : ''}`, -r.repDelta || 0, null, true), conf: c.conf}); // conf: the proof rule only covers under 60%
      if (r.accepted) { push(a, 'win', `${name} · as-is · ${r.grade} · ${money(r.pay)}`); return paid(a, r, STATION.ops); }
      t.drafts.push(r.fid); tool(a, 'Real, but Nib\'s draft was too vague. Rewriting it.');
    }, `${name}, ${c.conf}% sure, ${proof ? 'with proof' : 'as-is'}`);
    step.act.cid = c.id; return step;
  }
  const taken = a => new Set(Object.values(agents).filter(o => o !== a && live(o)).flatMap(o => o.task?.drafts || []));
  function decideReport(a, t, s) {
    const mine = draftsOwned(a, s)[0];
    if (mine) return reportStep(a, mine, s);
    // Your own hand-found drafts stay yours: an agent never rewrites a report you're working on.
    const next = Object.keys(s.found).find(fid => s.found[fid].status === 'draft' && s.found[fid].source !== 'manual' && workable(fid) && onlyIn(t, fid) && !taken(a).has(fid) && !(t.rewrites[fid] > MAX_REWRITES));
    if (!next) return {done: 'No drafts are waiting.'};
    t.drafts.push(next); look(a, 'desk', '› view_drafts');
    return reportStep(a, next, s);
  }
  function decideBuy(a, t, s) {
    look(a, 'shop', '› view_shop');
    if (t.until?.kind === 'tier' && s.gpu >= t.until.val) return {done: `The rig is at tier ${s.gpu}.`};
    if (t.bought && t.until?.kind !== 'tier') return {done: 'Purchase done.'};
    if (t.item === 'rig' && t.until?.kind !== 'tier') { t.from ??= s.gpu; if (s.gpu > t.from) return {done: 'The rig was already upgraded.'}; } // one tier, even if someone else bought it meanwhile
    const it = t.item && ITEM[t.item]?.();
    if (!t.item) return {done: "You didn't say what to buy."};
    if (!it) return {done: 'We already own that, or it is fully upgraded.'};
    if (it.need) return {done: `${it.name} needs the ${it.need} first.`};
    if (it.cost > s.cash) return {done: `${it.name} costs ${money(it.cost)}. We have ${money(s.cash)}. Stopping.`};
    if (t.floor != null && s.cash - it.cost < t.floor) return {done: `${it.name} would leave ${money(s.cash - it.cost)}, under the ${money(t.floor)} you said to keep. Stopping.`};
    const buy = () => act('buy', it.station, DUR.buy, it.run, r => {
      if (!r.ok) return bad(a, r.why || 'Could not buy it.');
      t.spent += it.cost; a.stats.spent += it.cost; t.bought = true; push(a, 'win', `Bought ${it.name} · ${money(it.cost)}`);
      G.floatAt(it.name, it.station);
    }, it.name);
    if (t.budget != null && t.spent + it.cost <= t.budget) { say(a, `${it.name}: ${money(it.cost)}, inside the ${money(t.budget)} budget.`); return buy(); }
    if (t.budget === 0) return {done: 'You said not to spend anything.'};
    if (t.budget != null) return {done: `${it.name} costs ${money(it.cost)}; that would go past the ${money(t.budget)} budget.`};
    if (rule(a, 'spend') && it.cost <= 1000) { ruled(a, `AGENTS.md lets me spend up to $1,000 without asking. ${it.name} is ${money(it.cost)}.`); const st = buy(); st.act.byRule = 'spend'; return st; } // byRule: re-checked as it's carried out (run)
    if (t.approved === it.name) { t.approved = null; return buy(); }
    narrate(a, 'ask', `Nobody said I could spend money, so I'm checking before paying ${money(it.cost)}.`);
    ask(a, `Buy ${it.name} for ${money(it.cost)}?`, [{label: 'Allow once', fn: x => { x.task.approved = it.name; }},
      {label: 'Always allow up to $1,000', fn: x => { x.task.approved = it.name; setRule('all', 'spend', true); ruled(x, 'Added to AGENTS.md: spend up to $1,000 without asking.'); }},
      {label: "Don't", fn: x => { x.task.finished = 'declined'; }}]);
    return {asked: true};
  }
  function decideChain(a, t, s) {
    look(a, 'chains', '› view_chains');
    const ready = D.ALL_TARGETS.find(p => !C.banned(p.id) && (!t.program || p.id === t.program) && E.chainState(s, p.id).ready && /* "connect the vaultkit chain": that one */ !headingTo(a, o => o.next?.chain === p.id));
    if (!ready && D.ALL_TARGETS.some(p => headingTo(a, o => o.next?.chain === p.id))) return {asked: true}; // a teammate is on the last chain: wait for it
    if (ready) { const step = act('chain', STATION.hq, DUR.chain, s => E.trace(s, ready.id, 0), r => {
      if (!r.ok || !r.chained) return bad(a, r.why || 'The chain didn\'t hold.');
      t.chained = true;
      push(a, 'win', `CRITICAL chain · ${ready.name} · ${money(r.pay)}`); a.stats.earned += r.pay; a.today.earned += r.pay;
      G.toast(`CRITICAL chain · ${a.name} · +${money(r.pay)}`, 'crit');
      floatUp(a, 'CRITICAL chain', 'crit', G.payChip?.({...r, crit: true}, 'hq', a.id)); // #16 (the label over the agent is the CRITICAL); its pay flies amber, like yours
    }, ready.name); step.act.chain = ready.id; return step; } // tagged: teammates leave this chain to this agent
    if (t.chained) return {done: 'Chain connected.'};
    return {done: 'No chain is ready.'};
  }
  function decideTake(a, t) {
    if (t.taken) return {done: t.taken === true ? `${T(t.program).name} is now the active program.` : t.taken}; // taken: true, or why it failed
    return act('take_target', STATION.hunt, DUR.take, s => E.takeJob(s, t.program), r => { t.taken = r.ok || `Couldn't switch: ${r.why || 'refused'}`; r.ok ? good(a, `${T(t.program).name} is the active program.`) : bad(a, r.why); }, T(t.program).name);
  }

  function penaltyLine(a, p) {
    a.stats.pens++; a.stats.repLost += p.rep; a.lastPenalty = Date.now();
    if (p.rep) floatUp(a, `−${p.rep} rep`, 'pen'); // #16: the on-floor echo of the penalty toast (none at 0 rep: nothing was lost)
    const fix = p.program ? 'scope' : p.title === 'False alarm' ? (p.conf < 60 ? 'proof' : null) : p.title === 'Report rejected' ? 'honest' : null;
    a.today.pens++; if (fix && !rule(a, fix)) a.today.fix = fix;
    push(a, 'pen', p.text, {title: p.title, fix: fix && !rule(a, fix) ? fix : null});
    if (p.program && a.next?.room) a.task.avoid.push(p.program + ':' + a.next.room);
    if (p.banned) push(a, 'pen', `${T(p.program).name} banned the company after ${C.BAN_AT} strikes.`, {title: 'Banned'});
    narrate(a, 'penalty', p.program ? 'That was out of scope. I\'ll stay out of that room for the rest of this task.' : p.title === 'False alarm' ? 'I submitted it without proof and it was wrong. That one is on me.' : 'I overclaimed the impact. I\'ll rewrite it plainly.');
  }

  // A note with a one-tap fix: the AGENTS.md rule that would have prevented it.
  function note(a, text, fix) { push(a, 'note', text, {fix}); }

  function finish(a, why) {
    if (!a.task || a.task.finished === true) return;
    const byYou = why === 'Stopped by you.';
    const keep = a.task.forever && !byYou && a.task.finished !== 'declined' && !(a.task.until && a.task.until.kind !== 'more' && reached(a)) /* a company total (rep, bugs, cash, tier) met stays met */ && !(a.task.program && !a.task.autoPick && C.banned(a.task.program)); // a ban is for good: no point coming back tomorrow
    if (keep && !a.queue.length) return standby(a, why);
    if (keep) { const r = a.task.raw.replace(/^now\b[:,]?\s*/i, ''); if (!a.resume.includes(r)) a.resume.push(r); } // what you queued runs today; this standing order comes back tomorrow (step's day rollover), with any other paused one
    const reason = (why === 'stop' ? `Stop condition reached: ${stopLabel(a.task)}.` : why) + (keep && !/tomorrow|then the standing order/.test(why) ? ' Standing order: back tomorrow.' : '');
    a.task.finished = true; a.status = 'done'; a.q = null; release(a);
    say(a, reason);
    push(a, 'done', label(a.task), {stats: {...a.stats}, reason});
    narrate(a, 'done', `${a.stats.accepted} accepted, ${money(a.stats.earned)} earned, ${a.stats.pens} penalt${a.stats.pens === 1 ? 'y' : 'ies'}${a.stats.spent ? `, ${money(a.stats.spent)} spent` : ''}.`);
    persist(); pullQueue(); changed();
    if (a.queue.length) setTimeout(() => nextQueued(a), 400);
  }
  // A standing order that ran out for today: rest until morning, then pick it up again with a fresh count.
  function standby(a, why) {
    const t = a.task, first = t.standbyDay == null;
    t.standbyDay = S().day; t.accepted = 0; t.spent = 0; t.tried = {}; t.seen = {}; t.moved = []; t.bought = false; t.approved = null; t.taken = false; t.from = null; // a fresh day's run: buy and take again
    a.status = 'resting'; a.q = null; release(a);
    say(a, first ? `${why === 'stop' ? `Today's done: ${stopLabel(t)}.` : why} Standing order, so I'll go again tomorrow.` : 'Nothing more today. Again tomorrow.');
    persist(); pullQueue(); changed();
  }
  // Stop ends the running task; with nothing running, it also cancels a standing order paused until tomorrow.
  function stop(id, said) { const a = agents[id], paused = a?.resume?.length, reading = a?.briefing; if (a) a.briefN = (a.briefN || 0) + 1; /* a message still being read (send's early read included) won't start */ if (reading) { a.briefN++; a.briefing = false; a.fromQueue = null; a.reading = null; persist(); } if (!a?.task || a.task.finished === true) { if (paused && !reading) { a.resume = []; persist(); } if (said) say(a, reading ? 'Okay, I won\'t start that.' : paused ? (paused > 1 ? `The ${paused} paused standing orders won't come back tomorrow.` : 'The paused standing order won\'t come back tomorrow.') : 'Nothing to stop.'); changed(); return; } if (!said) push(a, 'user', 'Stop.'); a.q = null; finish(a, 'Stopped by you.'); }
  function release(a) { delete claims[a.id]; a.next = null; a.path = []; }
  function pullQueue() { for (const a of Object.values(agents)) if (a.status === 'queued' && busy() < slots()) { a.status = 'thinking'; say(a, 'A GPU slot freed up. Starting now.'); narrate(a, 'start', planLine(a)); } }

  // ---------- movement (office world px; drawn by crew.js, Nib by the game's own NibActor) ----------
  let stations = null;
  function world() {
    if (stations) return true;
    if (!G.world?.destinations) return false;
    stations = {}; for (const d of G.world.destinations()) stations[d.id] = d.approach; return true;
  }
  const order = () => Object.keys(agents).filter(id => id !== 'nib');
  function homeSpot(a) {
    const base = stations.training || stations.hq || {x: 200, y: 180}, i = order().indexOf(a.id);
    return {x: base.x - 20 + (i % 3) * 20, y: base.y + 16 + Math.floor(i / 3) * 18};
  }
  function spotAt(a, station) {
    const base = stations[station] || homeSpot(a);
    // Agents at the same desk stand side by side, in roster order.
    const here = Object.keys(agents).filter(id => agents[id].station === station || id === a.id), i = here.indexOf(a.id);
    return {x: base.x + [0, -16, 16, -32, 32][i % 5], y: base.y + 4};
  }
  function walkTo(a, p) {
    if (a.id === 'nib') { a.nibWalking = true; G.nib.goTo(p.x, p.y, () => { a.nibWalking = false; }); return; }
    const still = !a.path.length;
    a.path = window.CantinaWorld.findPath(a.pos.x, a.pos.y, p.x, p.y, 'office', {terminals: true}); if (!a.path.length) a.pos = {...p}; a.path.push(p);
    // Anticipation: an agent that was standing still crouches for ~6 frames, facing where it's headed, before it moves.
    if (still) { a.windup = WINDUP; const w = a.path[0]; if (Math.abs(w.x - a.pos.x) > 0.5) a.facing = w.x < a.pos.x ? -1 : 1; }
  }
  const WINDUP = 0.1;
  // Follow-through (#6): an agent that stops after walking keeps going a moment: 1px on in its travel direction
  // (~6 frames), 1px back (~4 frames), then still, as Nib does (nib.js). crew.js draws a.drift (art px).
  const FOLLOW = 0.16;
  function followThrough(a, dt, from) {
    if (a.path.length) { a.follow = 0; a.drift = null; return; }
    if (from) { const dx = a.pos.x - from.x, dy = a.pos.y - from.y; a.follow = FOLLOW; a.followDir = Math.abs(dy) > Math.abs(dx) ? [0, Math.sign(dy)] : [Math.sign(dx) || a.facing || 1, 0]; }
    else if (a.follow > 0) a.follow -= dt;
    const s = a.follow > 0 ? (a.follow > FOLLOW - 0.09 ? 1 : -1) : 0;
    a.drift = s ? [a.followDir[0] * s, a.followDir[1] * s] : null;
  }
  const walking = a => a.id === 'nib' ? a.nibWalking : a.path.length > 0;

  // ---------- main loop ----------
  // Frames only while an agent moves (walk, wind-up, follow-through), thinks (decides on the next frame) or has a step
  // to start. A tool's timer needs no frames: the loop sleeps and a timeout wakes it when the soonest one runs out, and
  // that frame counts the real time slept. Movement keeps its 0.1 s clamp. secondTick has its own interval.
  let last = performance.now(), nap = false, napT = 0, slept = false;
  const ready = () => !paused && !G.ui().night && !G.frozen();
  function moving(a) {
    if (a.id === 'nib') return a.nibWalking || a.status === 'thinking' || a.status === 'walking';
    return a.path.length > 0 || a.follow > 0 || !!a.drift || a.crouch || a.status === 'thinking' || a.status === 'walking' || a.energyDay !== S().day
      || ['idle', 'done', 'queued', 'resting'].includes(a.status) && a.station !== 'home';
  }
  const needs = () => !stations || ready() && Object.values(agents).some(a => !a.pos || moving(a));
  function agentsFrame(now) {
    const real = (now - last) / 1000, dt = Math.min(slept ? 1 / 60 : 0.1, real); last = now; // after a sleep, one frame's worth: nothing jumps
    slept = true;
    if (!world()) return slept = false, true;
    for (const a of Object.values(agents)) if (!a.pos) a.pos = a.id === 'nib' ? G.nib.pos() : homeSpot(a);
    if (!ready()) { settleNap(); nap = false; return false; } // pause, night or leaving: the nap so far still counts; woken by input, the night's end (crew.js) or A.pause
    // One bad step must never stop the team for good.
    try { step(dt * speed, (nap ? Math.min(real, 10) : dt) * speed); } catch (e) { console.error('agents:', e); }
    nap = false; clearTimeout(napT);
    if (Object.values(agents).some(moving)) return slept = false, true;
    const soon = Math.min(...Object.values(agents).map(a => a.status === 'working' ? a.timer : Infinity));
    if (soon < Infinity) { nap = true; napT = setTimeout(window.Loop.wake, Math.max(0, soon / speed * 1000)); }
    return false;
  }
  // A speed change mid-nap: the time napped so far counts at the old speed, so no tool's timer jumps.
  function settleNap() {
    if (!nap) return;
    const now = performance.now(), real = Math.min((now - last) / 1000, 10);
    for (const a of Object.values(agents)) if (a.status === 'working') a.timer -= real * speed;
    last = now;
  }
  // A hidden tab gets no frames, so its timers stand still as before; it starts counting again when shown.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { settleNap(); nap = false; } else last = performance.now(); }); // hiding mid-nap: the nap so far still counts
  function secondTick() {
    if (paused || document.hidden || !stations) return;
    pullQueue();
    changed();
  }
  function step(dt, tdt = dt) { // tdt: the tool timers' clock (real time across a nap)
    const scene = (G.ui().busy || G.ui().morning) && !window.Stage3UI?.isOpen(); // a lesson or the morning talk: Nib stays put (not while Team covers it: you can't answer it from there)
    if (crew().standupDay !== S().day) { if (crew().standupDay != null) standup(); crew().standupDay = S().day; C.save(); }
    for (const a of Object.values(agents)) {
      if (a.energyDay !== S().day && a.resume.length) { for (const r of a.resume.splice(0)) if (!a.queue.includes(r)) a.queue.push(r); if (!hasTask(a)) setTimeout(() => nextQueued(a), 0); }
      if (a.energyDay !== S().day && a.task?.forever) { a.task.accepted = 0; a.task.spent = 0; } // a standing order's daily stop counts from today
      if (a.energyDay !== S().day && a.task) a.task.moved = []; // "each program once a day": a new day may move anywhere again
      // New day. An unanswered coffee question on a standing order with something queued: the queue gets its turn (rest).
      if (a.energyDay !== S().day) { a.energyDay = S().day; if (a.q?.ot) { a.q = null; if (a.task?.forever && a.queue.length) { a.status = 'thinking'; finish(a, 'New day: first what you queued, then the standing order.'); for (const r of a.resume.splice(0)) if (!a.queue.includes(r)) a.queue.push(r); } else a.status = 'resting'; } if (a.status === 'resting') { if (a.task) { a.task.standbyDay = null; a.task.restDay = null; if (a.task.forever && a.task.autoPick) { const b = bestProgram(a); if (b) a.task.program = b.id; } } // "wherever there's work" re-picks each morning
 a.status = busy() < slots() ? 'thinking' : 'queued'; tool(a, 'New day, full focus.'); } }
      if (a.id === 'nib' && scene) continue; // a lesson or the morning talk: Nib stays put (its new day above still runs)
      const from = a.id !== 'nib' && a.path.length && !(a.windup > 0) ? {x: a.pos.x, y: a.pos.y} : null; // #6: a step that may end the walk
      if (a.id === 'nib') a.pos = G.nib.pos();
      else if (a.path.length && a.windup > 0) { a.windup -= dt; a.crouch = true; a.moving = false; }
      else if (a.path.length) {
        a.crouch = false;
        let budget = 70 * dt;
        while (budget > 0 && a.path.length) {
          const wp = a.path[0], dx = wp.x - a.pos.x, dy = wp.y - a.pos.y, n = Math.hypot(dx, dy);
          if (n < 0.5) { a.path.shift(); continue; }
          const d = Math.min(budget, n); a.pos.x += dx / n * d; a.pos.y += dy / n * d; if (Math.abs(dx) > 0.5) a.facing = dx < 0 ? -1 : 1; budget -= d;
        }
        a.moving = true;
      } else { a.moving = false; a.crouch = false; }
      if (a.id !== 'nib') followThrough(a, dt, from);
      if (a.status === 'thinking') think(a);
      else if (a.status === 'walking' && !walking(a)) { a.status = 'working'; a.timer = a.next.dur; a.bubble = a.next.toolName; }
      else if (a.status === 'working' && (a.timer -= tdt) <= 0) run(a);
      else if (a.id !== 'nib' && ['idle', 'done', 'queued', 'resting'].includes(a.status) && !a.path.length && a.station !== 'home') { a.station = 'home'; walkTo(a, homeSpot(a)); a.bubble = ''; }
    }
  }
  function think(a) {
    if (a.task.finished === 'declined') return finish(a, 'Okay, not buying.');
    const d = decide(a);
    if (!d || d.asked) return;
    if (d.done) return finish(a, d.done);
    const cost = FOCUS_COST[d.act.toolName] || 0;
    if (a.energy < cost) {
      release(a);
      // Overtime: a coffee run buys more focus today. Each run the same day costs more.
      const o = S().ot?.[a.id], n = o && o.day === S().day ? o.n : 0, price = OT.cost * (n + 1);
      if (n < OT.max && S().cash >= price && a.noOtDay !== S().day) return void (ask(a, `I'm out of focus (${a.energy} left). Coffee run for ${money(price)}? +${OT.focus} focus, or I'm back tomorrow.`, [
        {label: `Coffee run · ${money(price)}`, fn: a => { const r = G.agentAct(s => E.coffeeRun(s, a.id)); if (!r.ok) { say(a, `${r.why || 'No coffee run.'} So I'm back tomorrow.`); return rest(a); } a.stats.spent += r.price; tool(a, `› coffee_run · +${r.focus} focus`); }},
        {label: 'Back tomorrow', fn: a => { a.noOtDay = S().day; rest(a); }}]), a.q.ot = true);
      return rest(a);
    }
    a.next = {...d.act}; a.next.phrase = stepPhrase(a.next, a); a.station = d.act.station; a.bubble = 'walking';
    a.status = 'walking'; walkTo(a, spotAt(a, d.act.station));
    a.ver++;
  }
  const OT = E.OT; // coffee runs: price, focus and daily limit come from the engine
  function rest(a) {
    if (a.task?.forever && a.queue.length) return finish(a, 'I\'m out of focus for the standing order, so I\'ll do what you queued. The standing order resumes tomorrow.'); a.status = 'resting'; if (a.task) a.task.restDay = S().day; release(a); say(a, `I'm out of focus for today (${a.energy} left). I'll pick this up after you sleep.`); persist(); pullQueue(); changed(); }
  // Morning standup: yesterday in one line per agent, in Nib's chat. Each row links to that agent to brief it.
  function standup() {
    const rows = Object.values(agents).filter(a => a.today.bugs || a.today.earned || a.today.pens || a.today.wasted).map(a => ({id: a.id, name: a.name, ...a.today}));
    Object.values(agents).forEach(a => { a.today = blankDay(); });
    if (!rows.length || !agents.nib) return;
    push(agents.nib, 'standup', 'Day ' + (S().day - 1), {rows}); G.toast('Standup is in Team.', 'good'); persist();
  }
  function run(a) {
    const n = a.next; a.bubble = '';
    // A rule ticked (or unticked) in AGENTS.md since this step was picked applies to it: a step it now forbids isn't taken,
    // and the next think picks one under the current rules.
    const cand = n.cid != null && S().tray.find(c => c.id === n.cid);
    if ((n.room && a.task?.program && !allowedRoom(a, a.task.program, n.room)) || (n.toolName === 'submit_as_is' && cand && rule(a, 'proof') && cand.conf < 60) || (n.byRule && !rule(a, n.byRule))) {
      release(a); a.status = 'thinking'; persist(); changed(); return;
    }
    const r = exec(a, n.run, n.toolName === 'take_target') || {ok: false};
    tool(a, `› ${n.toolName}(${n.desc || ''})${!r.ok ? ' ✕' : n.toolName === 'hunt_finding' ? (r.hit ? ' · found' : ' · not it') : ''}`);
    try { n.onResult?.(r); } catch (e) { console.error('agents:', e); } // a bad result line must not leave the agent working forever
    if (r.penalty) penaltyLine(a, r.penalty);
    if (a.task && a.task.finished !== true) {
      a.status = 'thinking';
      if (busy() > slots()) { a.status = 'queued'; say(a, 'The rig has fewer slots now. Waiting for one.'); } // the rig was returned mid-task
      if (reached(a) && !draftsOwned(a, S()).length) finish(a, 'stop');
    }
    persist(); changed();
  }

  // ---------- model status ----------
  async function checkModel() {
    try { const r = await fetch('/api/agents/health'); const j = await r.json(); model = {ok: !!j.ok, label: j.ok ? `${j.model.split('/')[1]} · ${j.provider}` : 'Scripted lines (model offline)', used: j.used, limit: j.limit}; }
    catch { model = {ok: false, label: 'Scripted lines (no server)'}; }
    changed();
  }

  // ---------- public API ----------
  const hired = () => (S().hired || crew().hired).filter(id => ROSTER[id]); // the save's list (engine.js hire)
  function hire(id) {
    const r = ROSTER[id]; if (!r?.price || hired().includes(id) || S().cash < r.price) return false;
    // The agent exists before the save lists them: agentAct redraws, and every redraw reads list().
    makeAgent(id);
    if (!G.agentAct(s => E.hire(s, id)).ok) { delete agents[id]; return false; }
    persist(); changed(); return true;
  }
  // A rule changes every timeline's "Add to AGENTS.md" links, so each agent's version moves on and Team redraws it.
  function setRule(tab, k, on) { (crew().rules[tab] ??= {})[k] = on; Object.values(agents).forEach(a => a.ver++); C.save(); changed(); }
  function addRule(tab, text) {
    const t = text.toLowerCase();
    const k = /scope|off.?limit|boundar/.test(t) ? 'scope' : /pattern|lesson|nib'?s book/.test(t) ? 'lessons' : /overclaim|exaggerat|honest|impact/.test(t) ? 'honest'
      : /prov|proof|confiden|sure/.test(t) ? 'proof' : /claim|collid|same room|overlap/.test(t) ? 'claim' : /spend|budget|buy|\$/.test(t) ? 'spend' : null;
    if (k) setRule(tab, k, true); else { (crew().custom[tab] ??= []).push(text.slice(0, 160)); C.save(); changed(); }
    return k;
  }

  hired().forEach(makeAgent);
  // A reload right after a task ended: its queue picks up where it left off.
  setTimeout(() => Object.values(agents).forEach(a => { if (a.queue.length && !hasTask(a)) nextQueued(a); }), 800);
  Object.values(agents).filter(a => a.status === 'thinking').slice(slots()).forEach(a => { a.status = 'queued'; });
  C.on(() => changed());
  // Hidden: no model checks or saves on a timer; the log is saved as the tab hides or the page goes.
  checkModel(); setInterval(() => { if (!document.hidden) checkModel(); }, 60000);
  let saved = ''; // the 3 s save writes only when the crew changed
  setInterval(() => { if (document.hidden) return; const k = Object.values(agents).map(a => a.ver + ':' + a.energy + ':' + a.queue.length).join(); if (k !== saved) { saved = k; persist(); } }, 3000);
  setInterval(secondTick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  addEventListener('pagehide', persist);
  window.Loop.add(agentsFrame);

  // list(): a save loaded from another tab can list a hire this page hasn't made yet, so make it on sight.
  window.Stage3Agents = {
    list: () => hired().map(id => agents[id] || makeAgent(id)), get: id => agents[id], roster: ROSTER, hireable: () => Object.keys(ROSTER).filter(id => ROSTER[id].price && !hired().includes(id)),
    send, unqueue, unpause, answer, stop, hire, setRule, addRule, rule, ruleList, RULES, TOOLS, parseLocal, isQuestion, isStop, isClearQueue, stopThen, lint, label, stopLabel, live,
    resetAll: () => G.restart3(), slots, busy, phrase, gistOf, model: () => model,
    speed: v => { if (v) { settleNap(); speed = v; window.Loop.wake(); } return speed; }, pause: v => { if (v !== undefined) { paused = v; window.Loop.wake(); } return paused; },
    onChange: fn => listeners.push(fn), crew,
  };
});
