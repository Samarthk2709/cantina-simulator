/* First Office · Stage 2 content. Every program, app and snippet is fictional.
   Snippets are short teaching sketches of a bug *shape*; they contain no attack inputs. */
(function (root) {
  'use strict';

  // Each snippet line: [text, verdict]. verdict is either {ok: why this line is fine}
  // or {bad: why this line is the bug}. {x} placeholders come from the room's nouns.
  const L = (t, ok) => ({ t, ok });
  const B = (t, bad) => ({ t, bad });

  const CLASSES = {
    auth: {
      name: 'Missing access check', tool: null, mult: 1,
      hint: 'Signed in is not the same as allowed. Find where it forgets to ask "is this yours?"',
      teach: {
        sharp: 'Being signed in proves who you are, not what you own. It has to check the {thing} belongs to them.',
        shallow: 'Numbers in URLs are dangerous. Hide the id and it\'s fixed.',
        wrong: 'It\'s too slow. It should cache the {thing}.'
      },
      variants: [
        [L('function open{Thing}(req) {', 'Just the handler.'),
         L('  const user = requireLogin(req)', 'Proves someone is signed in. Good, but it only says who they are.'),
         L('  const {thing} = db.{things}.byId(req.params.id)', 'Looking a record up by id is normal.'),
         L('  log.info("opened", {thing}.id)', 'Logging an id is harmless.'),
         B('  return {thing}', 'Hands the {thing} back without checking {thing}.owner is this user. Anyone signed in can read anyone\'s.'),
         L('}', 'End of handler.')],
        [L('function rename{Thing}(req) {', 'Just the handler.'),
         L('  const user = requireLogin(req)', 'Checks a session exists. Fine.'),
         L('  const {thing} = db.{things}.byId(req.body.id)', 'A lookup. Fine on its own.'),
         L('  if (!req.body.name) return error(400)', 'Input validation. Good habit.'),
         B('  {thing}.name = req.body.name', 'Edits a {thing} that was never checked to belong to this user.'),
         L('  db.save({thing})', 'Saving is fine; the damage was already done.')],
        [L('function delete{Thing}(req) {', 'Just the handler.'),
         L('  const user = requireLogin(req)', 'Someone is signed in. Fine.'),
         B('  if (req.query.admin === "yes") {', 'Trusts the request to say it\'s an admin. The person sending it controls that.'),
         L('    db.{things}.remove(req.params.id)', 'Removing is what admins should be able to do.'),
         L('  }', 'Block end.'),
         L('  return ok()', 'Normal reply.')]
      ],
      report: {
        title: ['Any signed-in user can open other people\'s {things}', 'Problem with {things}', 'Full takeover of every account through {things}'],
        impact: ['Any account can read or change another customer\'s private {things}.', 'Some data might be visible.', 'An attacker controls the whole company.'],
        steps: ['1. Sign in as account A. 2. Request account B\'s {thing} by its id. 3. B\'s {thing} comes back.', 'Change the number in the address bar.', 'Trust me, it works everywhere.'],
        fix: ['Check {thing}.owner equals the signed-in user before returning or changing it.', 'Add a firewall.', 'Rewrite the whole app.']
      }
    },
    info: {
      name: 'Information leak', tool: null, mult: 0.8,
      hint: 'Something leaves the server that the person asking should never see.',
      teach: {
        sharp: 'It sends back more than the page needs. Internal details should never leave the server.',
        shallow: 'Errors are always dangerous. Remove every error message.',
        wrong: 'The messages are unfriendly. Users will get confused.'
      },
      variants: [
        [L('function show{Thing}(req) {', 'Just the handler.'),
         L('  const {thing} = db.{things}.byId(req.params.id)', 'A lookup. Fine.'),
         L('  if (!{thing}.public) return error(404)', 'Hides private {things}. Good.'),
         B('  return { ...{thing} }', 'Copies every field out, including internal notes and the owner\'s email. Pick the public fields instead.'),
         L('}', 'End of handler.')],
        [L('function find{Things}(req) {', 'Just the handler.'),
         L('  try {', 'Error handling is a good idea.'),
         L('    return db.{things}.search(req.query.q)', 'A normal, parameterised search.'),
         L('  } catch (err) {', 'Catching the error is fine.'),
         B('    return error(500, err.stack)', 'Sends the full stack trace to the visitor: file paths, query text, library versions.'),
         L('  }', 'Block end.')],
        [L('function signIn(req) {', 'Just the handler.'),
         L('  const user = db.users.byEmail(req.body.email)', 'Looking up the account. Fine.'),
         B('  if (!user) return error("No account with that email")', 'Tells strangers which emails have accounts here. Say "wrong email or password" for both.'),
         L('  if (!passwordOk(user, req.body.password)) return error("Wrong password")', 'Checking the password. Fine, though the message could be shared with the line above.'),
         L('  return startSession(user)', 'Normal success path.')]
      ],
      report: {
        title: ['{Thing} endpoint returns internal fields to the public', 'Data exposure maybe', 'Massive data breach of all customers'],
        impact: ['Visitors can read internal details (emails, notes) that help further attacks.', 'Could be bad.', 'Every customer record ever stored is exposed.'],
        steps: ['1. Open a public {thing}. 2. Read the raw response. 3. Internal fields are included.', 'Look at the page.', 'Run any scanner.'],
        fix: ['Return an explicit list of public fields; keep internal details server-side.', 'Turn off errors.', 'Encrypt everything.']
      }
    },
    inj: {
      name: 'Injection', tool: null, mult: 1.2,
      hint: 'Look for text from the user being glued into something that gets run.',
      teach: {
        sharp: 'User text gets mixed into a command. Data has to stay data, passed separately from the instruction.',
        shallow: 'Search boxes are always dangerous. Remove search.',
        wrong: 'It should run the command twice to be sure it worked.'
      },
      variants: [
        [L('function search{Things}(req) {', 'Just the handler.'),
         L('  const term = req.query.q', 'Reading the input is fine.'),
         L('  if (term.length > 100) return error(400)', 'Limiting length is good hygiene. Not the bug.'),
         B('  const sql = "SELECT * FROM {things} WHERE title LIKE \'%" + term + "%\'"', 'Glues the visitor\'s text straight into the query. Their text can change what the query does.'),
         L('  return db.raw(sql)', 'Runs whatever was built above.')],
        [L('function thumbnail(req) {', 'Just the handler.'),
         L('  const file = saveUpload(req.file)', 'Storing the upload is fine.'),
         B('  shell("resize " + req.body.name + " thumb.png")', 'The visitor\'s file name becomes part of a shell command.'),
         L('  return ok()', 'Normal reply.')],
        [L('function preview{Thing}(req) {', 'Just the handler.'),
         L('  const page = loadTemplate("{thing}.html")', 'Loading a template is fine.'),
         B('  return page.replace("{{title}}", req.query.title)', 'Puts the visitor\'s text into the page unescaped, so it can become script in someone else\'s browser.'),
         L('}', 'End of handler.')]
      ],
      report: {
        title: ['User input reaches the {things} query unescaped', 'Search is weird', 'Remote takeover of all servers'],
        impact: ['A visitor can change what the query does and read other customers\' {things}.', 'Might break something.', 'Total control of the company\'s infrastructure.'],
        steps: ['1. Search {things} with a term containing a quote. 2. The query errors or returns other users\' rows.', 'Type weird stuff.', 'Use any hacking tool.'],
        fix: ['Use parameterised queries so input is passed as data, never as query text.', 'Block quotes.', 'Delete the search feature.']
      }
    },
    path: {
      name: 'Path traversal', tool: null, mult: 1,
      hint: 'A file name from the visitor decides where on disk the server reads or writes.',
      teach: {
        sharp: 'The name can climb out of the folder with ../. Resolve the full path and check it\'s still inside.',
        shallow: 'Long file names are risky. Cap them at 20 characters.',
        wrong: 'Files should be compressed before sending.'
      },
      variants: [
        [L('function download(req) {', 'Just the handler.'),
         L('  const user = requireLogin(req)', 'Signed-in only. Fine.'),
         B('  const path = "/srv/{things}/" + req.query.file', 'Joins the visitor\'s name onto a folder. "../" walks right out of it.'),
         L('  return readFile(path)', 'Reads whatever path was built.')],
        [L('function avatar(req) {', 'Just the handler.'),
         L('  const name = req.params.name', 'Reading the parameter is fine.'),
         L('  if (!name.endsWith(".png")) return error(400)', 'An extension check. Not a folder boundary, but not where the escape happens.'),
         B('  return sendFile(join(AVATARS, name))', 'Nothing stops the name from leaving the AVATARS folder.')],
        [L('function import{Things}(zip, dest) {', 'Just the function.'),
         L('  for (const entry of zip.entries()) {', 'Looping over the archive is fine.'),
         B('    const out = join(dest, entry.name)', 'Archive entry names can contain "../", so files land outside dest.'),
         L('    writeFile(out, entry.data)', 'Writes to wherever out points.'),
         L('  }', 'Loop end.')]
      ],
      report: {
        title: ['File name in {things} download escapes the storage folder', 'File bug', 'Attacker owns the whole server'],
        impact: ['A visitor can read files outside the {things} folder, like config files.', 'Files are involved.', 'Every server everywhere is compromised.'],
        steps: ['1. Request a {thing} file. 2. Change the name to climb one folder up. 3. A file from outside the folder comes back.', 'Mess with the URL.', 'Obvious, no steps needed.'],
        fix: ['Resolve the full path and reject it unless it is still inside the {things} folder.', 'Ban long names.', 'Stop storing files.']
      }
    },
    mem: {
      name: 'Buffer overflow', tool: 'fuzz', mult: 1.5,
      hint: 'Native code. Find the copy that trusts a size it never checked.',
      teach: {
        sharp: 'The copy trusts a length the sender chose. Check it against the buffer\'s real size first.',
        shallow: 'Big inputs are bad. Compress them.',
        wrong: 'C is the bug. It should be rewritten in a new language today.'
      },
      variants: [
        [L('void read_{thing}(conn c) {', 'Just the function.'),
         L('  char buf[256];', 'A fixed buffer is fine by itself.'),
         L('  uint16 len = read_u16(c);', 'Reading a length field is normal.'),
         B('  read_bytes(c, buf, len);', 'len can be up to 65,535. buf holds 256. Bytes spill past the end.'),
         L('  handle(buf, len);', 'Processing comes after the damage.')],
        [L('void set_{thing}_name(char *input) {', 'Just the function.'),
         L('  char name[32];', 'Small buffer. Fine if used carefully.'),
         B('  strcpy(name, input);', 'Copies until the input ends, however long it is. No limit.'),
         L('  save(name);', 'Uses the copy.')],
        [L('void load_{things}(item *items, int count) {', 'Just the function.'),
         L('  // items has room for exactly count entries', 'A comment, and a useful one.'),
         B('  for (int i = 0; i <= count; i++)', 'Off by one: <= writes one entry past the end.'),
         L('    items[i] = parse(next());', 'Writes where the loop says.')]
      ],
      report: {
        title: ['Unchecked length in {thing} parser overflows a 256-byte buffer', 'Crash sometimes', 'Instant control of every device'],
        impact: ['A crafted {thing} crashes the service and may let an attacker run code.', 'It crashed once.', 'Every computer on earth is at risk.'],
        steps: ['1. Send a {thing} whose length field is larger than 256. 2. The service crashes in read_{thing}.', 'Send a big file.', 'Just fuzz it.'],
        fix: ['Reject lengths larger than the buffer before copying.', 'Use a bigger buffer.', 'Turn the service off.']
      }
    },
    race: {
      name: 'Race condition', tool: 'dbg', mult: 1.4,
      hint: 'Two requests at the same moment. Find the check that can go stale before the update.',
      teach: {
        sharp: 'The check and the update are separate steps, so two requests can both pass. They have to happen as one.',
        shallow: 'Fast users cause bugs. Add a delay.',
        wrong: 'The function name doesn\'t describe what it does.'
      },
      variants: [
        [L('function redeem(req) {', 'Just the handler.'),
         L('  const {thing} = db.{things}.byCode(req.body.code)', 'A lookup. Fine.'),
         B('  if ({thing}.used) return error("Already used")', 'Checked here, marked used two lines later. Two requests at once both get past this line.'),
         L('  credit(req.user, {thing}.value)', 'Crediting is the point.'),
         L('  {thing}.used = true; db.save({thing})', 'Marking it used is right, but too late.')],
        [L('function transfer(from, to, amount) {', 'Just the function.'),
         B('  const balance = getBalance(from)', 'Reads a balance that may change before it is written back.'),
         L('  if (balance < amount) return error("Insufficient")', 'The check itself is sensible.'),
         L('  await fraudCheck(from)', 'A slow step, which widens the gap.'),
         L('  setBalance(from, balance - amount)', 'Writes a balance computed from the stale read.')],
        [L('function claim{Thing}(user, slot) {', 'Just the function.'),
         B('  if (!slot.taken) {', 'Two people can both see the slot free before either takes it.'),
         L('    slot.taken = true', 'Taking it. Correct, if it were atomic.'),
         L('    slot.owner = user', 'Recording the owner.'),
         L('  }', 'Block end.')]
      ],
      report: {
        title: ['{Thing} can be redeemed twice by sending two requests at once', 'Timing issue', 'Infinite money for everyone forever'],
        impact: ['A customer can use one {thing} several times and get paid repeatedly.', 'Something with timing.', 'The company goes bankrupt tonight.'],
        steps: ['1. Prepare two redeem requests for the same {thing}. 2. Send them at the same moment. 3. Both succeed.', 'Click fast.', 'Spam it.'],
        fix: ['Make the check and update one atomic step, such as a conditional database update.', 'Add a delay.', 'Remove {things}.']
      }
    }
  };
  // Proof is the same shape for every class.
  const PROOF = ['A recording of the request and the response showing the problem', 'A screenshot of a page', 'None. It\'s obvious'];
  // Triager reactions per pick: index 0 good, 1 vague, 2 overclaim.
  const TRIAGE = {
    title: ['Clear title. I know what this is.', 'What problem, exactly?', 'Big claim. We\'ll see.'],
    impact: ['Concrete impact. Thank you.', 'That doesn\'t tell me how bad it is.', 'Overclaiming. That\'s not what this shows.'],
    steps: ['I reproduced it in a minute.', 'I can\'t follow that.', 'That isn\'t a reproduction.'],
    proof: ['Evidence attached. Lovely.', 'A screenshot proves little.', 'No proof, no payout.'],
    fix: ['Good fix. The devs will like this.', 'That doesn\'t fix this bug.', 'Not helpful.']
  };
  const SECTIONS = [
    { id: 'title', name: 'Title' }, { id: 'impact', name: 'Impact' }, { id: 'steps', name: 'Steps' },
    { id: 'proof', name: 'Proof' }, { id: 'fix', name: 'Fix' }
  ];

  // Room: [id, name, x%, y%, nouns, finding classes]. Nouns: thing, things.
  const N = (thing, things) => ({ thing, things: things || thing + 's' });
  const TARGETS = [
    { id: 'chat', name: 'ChatterBox', kind: 'Messaging app', base: 150, stars: 1, picked: 0.55,
      blurb: 'Everyone has poked at it. Low pay, but a gentle first job.',
      rooms: [
        ['login', 'Login', 16, 26, N('session'), ['info', 'auth']],
        ['msgs', 'Messages', 50, 26, N('message'), ['auth', 'inj']],
        ['groups', 'Groups', 84, 26, N('group'), ['auth']],
        ['media', 'Media', 16, 74, N('attachment'), ['path', 'info']],
        ['search', 'Search', 50, 74, N('message'), ['inj']],
        ['bots', 'Bots API', 84, 74, N('bot'), ['auth', 'inj']]],
      links: [['login', 'msgs'], ['msgs', 'groups'], ['login', 'media'], ['msgs', 'search'], ['groups', 'bots'], ['media', 'search'], ['search', 'bots']],
      chain: { a: 'login:0', b: 'msgs:0', name: 'Read anyone\'s private chats',
        options: ['Login leaks something about other users, and Messages trusts it without an owner check, so anyone can open anyone\'s chats.', 'Both bugs are in the same app, so together they are critical.', 'Two medium bugs always add up to one critical.'] } },
    { id: 'inv', name: 'Invoicely', kind: 'Billing & payments', base: 300, stars: 2, picked: 0.22,
      blurb: 'Follow the money. Some rooms need tools you don\'t have yet.',
      rooms: [
        ['acct', 'Accounts', 16, 26, N('account'), ['info', 'auth']],
        ['inv', 'Invoices', 50, 26, N('invoice'), ['auth', 'path']],
        ['pay', 'Payments', 84, 26, N('coupon'), ['race', 'auth']],
        ['up', 'Upload', 16, 74, N('receipt'), ['path', 'mem']],
        ['pdf', 'PDF export', 50, 74, N('invoice'), ['inj', 'mem']],
        ['admin', 'Admin', 84, 74, N('customer'), ['auth', 'info']]],
      links: [['acct', 'inv'], ['inv', 'pay'], ['acct', 'up'], ['up', 'pdf'], ['inv', 'pdf'], ['pdf', 'admin'], ['pay', 'admin']],
      chain: { a: 'acct:0', b: 'inv:0', name: 'Read every customer\'s invoices',
        options: ['Accounts leaks something about other customers, and Invoices trusts it without an owner check, so every customer\'s invoices are readable.', 'Billing bugs are always critical.', 'The two rooms are next to each other.'] } },
    { id: 'vault', name: 'VaultKit', kind: 'Password manager', base: 600, stars: 4, picked: 0.06,
      blurb: 'Fresh and well paid. Half of it is native code: bring a fuzzer and a debugger.',
      rooms: [
        ['sync', 'Sync', 16, 26, N('vault'), ['info', 'race']],
        ['share', 'Sharing', 50, 26, N('share'), ['auth', 'race']],
        ['crypto', 'Crypto core', 84, 26, N('key'), ['mem', 'mem']],
        ['import', 'Import', 16, 74, N('backup'), ['path', 'mem']],
        ['ext', 'Extension', 50, 74, N('note'), ['inj', 'info']],
        ['login', 'Login', 84, 74, N('device'), ['auth', 'race']]],
      links: [['sync', 'share'], ['share', 'crypto'], ['sync', 'import'], ['import', 'ext'], ['crypto', 'ext'], ['ext', 'login']],
      chain: { a: 'sync:0', b: 'share:0', name: 'Open someone else\'s vault',
        options: ['Sync leaks something about other vaults, and Sharing trusts it without an owner check, so a stranger can open someone else\'s vault.', 'Password managers are always critical.', 'The fuzzer said so.'] } },
    { id: 'bank', name: 'Northwind Bank', kind: 'Private invite', base: 1100, stars: 5, picked: 0, private: true, rep: 30,
      blurb: 'Invite only. Nobody else is looking. Big payouts.',
      rooms: [
        ['portal', 'Portal', 16, 26, N('statement'), ['info', 'auth']],
        ['cards', 'Cards', 50, 26, N('card'), ['auth', 'mem']],
        ['xfer', 'Transfers', 84, 26, N('transfer'), ['race', 'race']],
        ['loans', 'Loans', 16, 74, N('loan'), ['inj']],
        ['stmt', 'Statements', 50, 74, N('statement'), ['path']],
        ['core', 'Core ledger', 84, 74, N('entry', 'entries'), ['mem']]],
      links: [['portal', 'cards'], ['cards', 'xfer'], ['portal', 'loans'], ['loans', 'stmt'], ['cards', 'core'], ['stmt', 'core']],
      chain: { a: 'portal:0', b: 'cards:0', name: 'Read another customer\'s cards',
        options: ['The portal leaks something about other customers, and Cards trusts it without an owner check, exposing their cards.', 'Banks are critical by definition.', 'Both rooms have cards in them.'] } }
  ];

  // Opens in chapter 3 only, so a team always has fresh work after the first job.
  const LATE_TARGETS = [
    { id: 'ship', name: 'Parcelly', kind: 'Shipping & tracking', base: 450, stars: 3, picked: 0.04, late: true,
      blurb: 'New to bug bounties. Opened its program the week you hired a team.',
      rooms: [
        ['track', 'Tracking', 16, 26, N('parcel'), ['info', 'auth']],
        ['label', 'Labels', 50, 26, N('label'), ['inj', 'path']],
        ['rates', 'Rates', 84, 26, N('quote'), ['race']],
        ['drivers', 'Drivers', 16, 74, N('route'), ['auth', 'info']],
        ['returns', 'Returns', 50, 74, N('refund'), ['path', 'race']],
        ['hub', 'Sorting hub', 84, 74, N('crate'), ['mem', 'auth']]],
      links: [['track', 'label'], ['label', 'rates'], ['track', 'drivers'], ['drivers', 'returns'], ['label', 'returns'], ['returns', 'hub'], ['rates', 'hub']],
      chain: { a: 'track:0', b: 'drivers:0', name: 'Reroute anyone\'s parcels',
        options: ['Tracking leaks something about other shipments, and Drivers trusts it without an owner check, so anyone can reroute parcels.', 'Shipping apps are always critical.', 'Both rooms mention parcels.'] } }
  ];
  const ALL_TARGETS = TARGETS.concat(LATE_TARGETS);

  const TOOLS = [
    { id: 'proxy', name: 'Proxy', cost: 0, owned: true, opens: 'Web bugs: access checks, leaks, injection, file paths.' },
    { id: 'fuzz', name: 'Fuzzer', cost: 450, opens: 'Buffer overflows in native code.' },
    { id: 'dbg', name: 'Debugger', cost: 600, opens: 'Race conditions between simultaneous requests.' },
    { id: 'trace', name: 'Tracer', cost: 600, opens: 'Chain two linked bugs into a sure critical.' }
  ];
  const RIGS = [
    { name: 'Old laptop', tries: 1, cost: 0 },
    { name: 'One used GPU', tries: 3, cost: 350 },
    { name: 'Two GPUs', tries: 5, cost: 800 },
    { name: 'Four-GPU rig', tries: 8, cost: 1800 }
  ];
  const DESK = [
    { id: 'coffee', name: 'Coffee machine', cost: 250, does: '+1 coffee a day.' },
    { id: 'monitor', name: 'Second monitor', cost: 500, does: 'Max focus 100 → 130.' }
  ];
  const REP_TIERS = [
    { min: 0, name: 'Unknown', bonus: 1, perk: 'Nobody knows you yet.' },
    { min: 10, name: 'Noticed', bonus: 1.1, perk: '+10% on every payout.' },
    { min: 30, name: 'Trusted', bonus: 1.1, perk: 'Private invites open.' },
    { min: 60, name: 'Elite', bonus: 1.25, perk: '+25% on every payout.' }
  ];
  const GRADES = { S: { m: 1.5, rep: 3 }, A: { m: 1.2, rep: 2 }, B: { m: 1, rep: 1 }, C: { m: 0.6, rep: 1 } };
  const COST = { map: 15, find: 30, miss: 8, prove: 15, coffee: 20, focus: 100, cups: 2, tray: 12, crit: 0.05, crowd: 0.02 };

  // Builds one finding from its room and slot.
  function finding(target, room, slot) {
    const cls = room[5][slot], nouns = room[4], C = CLASSES[cls];
    const v = (target.id.length * 7 + room[0].length * 3 + slot * 5 + room[2]) % C.variants.length;
    return { id: target.id + ':' + room[0] + ':' + slot, target: target.id, room: room[0], slot, cls, variant: v, nouns };
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function fill(text, nouns) {
    return String(text).replace(/\{(thing|things|Thing|Things)\}/g, (_, k) => k === 'thing' ? nouns.thing : k === 'things' ? nouns.things : k === 'Thing' ? cap(nouns.thing) : cap(nouns.things));
  }

  const api = { CLASSES, PROOF, TRIAGE, SECTIONS, TARGETS, LATE_TARGETS, ALL_TARGETS, TOOLS, RIGS, DESK, REP_TIERS, GRADES, COST, finding, fill };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Stage2Data = api;
})(typeof window !== 'undefined' ? window : null);
