const policies = require('./policies.json');
const { browserTool, createMockBrowserState } = require('./mock-browser');
const { clearCheckpoint, getRun, getRuns, saveCheckpoint, saveRun } = require('./persistence');
const { searchWorkspace, workspaceInfo } = require('./workspace-search');

let state;

function resetState() {
  state = { ledger: [], failureBudget: { 'Company X': 1 }, browser: createMockBrowserState() };
}

resetState();

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clone = (value) => JSON.parse(JSON.stringify(value));

function parseTask(task) {
  const text = task.toLowerCase();
  const vendor = /company x/i.test(task) ? 'Company X' : /cloudfleet/i.test(task) ? 'CloudFleet' : null;
  return {
    usesBrowser: /browser|website|portal|computer use/i.test(text),
    vendor,
    wantsInvoice: /invoice|amount|due date|payment|bill/i.test(text),
    wantsWrite: /internal system|ledger|record|enter|add it|finance system/i.test(text)
  };
}

function createPlan(spec) {
  const source = spec.usesBrowser ? 'Search the simulated vendor portal' : 'Search the approved workspace folder';
  const plan = [source, 'Observe and extract relevant evidence'];
  if (spec.wantsWrite) plan.push('Apply policy checks before writing', 'Write through an idempotent tool', 'Verify the final state independently');
  else plan.push('Return a grounded answer with source evidence');
  return plan;
}

function ledgerTool(name, args) {
  if (name === 'create_ledger_entry') {
    const existing = state.ledger.find((entry) => entry.invoiceId === args.invoiceId);
    if (existing) return { status: 'already_exists', entry: existing };
    if (state.failureBudget[args.vendor] > 0) {
      state.failureBudget[args.vendor] -= 1;
      const error = Error('Ledger gateway timed out');
      error.code = 'TRANSIENT';
      throw error;
    }
    const entry = { id: `led-${String(state.ledger.length + 1).padStart(4, '0')}`, ...args, createdAt: new Date().toISOString(), status: 'recorded' };
    state.ledger.push(entry);
    return { status: 'created', entry };
  }
  if (name === 'verify_ledger') {
    const entry = state.ledger.find((item) => item.invoiceId === args.invoiceId);
    return { verified: Boolean(entry && entry.amount === args.amount && entry.dueDate === args.dueDate), entry: entry || null };
  }
  throw Error(`Unknown internal tool: ${name}`);
}

function sourcedAnswer(matches) {
  if (!matches.length) return 'I could not find relevant information in the approved workspace folder.';
  return `Based on ${matches[0].path}: ${matches[0].excerpt}`;
}

function runOutput(runId, status, task, plan, events, artifacts, memory, summary) {
  const output = { runId, status, task, plan, events, artifacts, memory, summary };
  saveRun(output);
  if (status === 'completed' || status === 'failed' || status === 'needs_clarification') clearCheckpoint(runId);
  return output;
}

async function runWorker(task, options = {}) {
  if (!task || !task.trim()) throw Error('Please provide a task.');
  const runId = options.runId || `run-${Date.now().toString(36)}`;
  const spec = parseTask(task);
  const plan = createPlan(spec);
  const events = [];
  const artifacts = [];
  const memory = { workspace: workspaceInfo(), policyVersion: policies.version };
  const checkpoint = () => saveCheckpoint(runId, { task, plan, events, artifacts, memory, status: 'running' });
  const log = (kind, title, detail, data) => {
    events.push({ at: new Date().toISOString(), kind, title, detail, data });
    checkpoint();
  };

  log('goal', 'Goal received', task);
  log('plan', 'Plan created', plan.map((step, index) => `${index + 1}. ${step}`).join(' → '));

  if (spec.usesBrowser) {
    if (!spec.vendor || !spec.wantsInvoice) {
      log('approval', 'Clarification required', 'The browser worker needs a supported vendor and an invoice-related objective.');
      return runOutput(runId, 'needs_clarification', task, plan, events, artifacts, memory, 'Please name Company X or CloudFleet and describe the invoice task.');
    }
    log('action', 'Browser: search portal inbox', `Searching invoices for ${spec.vendor}.`);
    await pause(140);
    const matches = browserTool(state.browser, 'browser_search_invoices', { vendor: spec.vendor });
    log('observation', 'Browser: portal results', `${matches.length} matching invoice(s) found.`);
    const invoice = matches.sort((left, right) => right.received.localeCompare(left.received))[0];
    if (!invoice) return runOutput(runId, 'failed', task, plan, events, artifacts, memory, 'No matching invoice was found in the portal.');
    log('action', 'Browser: open invoice', invoice.id);
    const opened = browserTool(state.browser, 'browser_open_invoice', { id: invoice.id });
    artifacts.push({ type: 'browser_evidence', label: `Portal invoice ${opened.invoiceId}`, detail: `₹${opened.amount.toLocaleString('en-IN')} due ${opened.dueDate}`, id: opened.id });
    memory.invoice = opened;
    if (!spec.wantsWrite) return runOutput(runId, 'completed', task, plan, events, artifacts, memory, `The portal's latest ${opened.vendor} invoice is ₹${opened.amount.toLocaleString('en-IN')}, due ${opened.dueDate}.`);
    if (opened.amount > policies.rules.ledgerWriteRequiresApprovalAbove && !options.approved) {
      log('approval', 'Human approval required', `₹${opened.amount.toLocaleString('en-IN')} exceeds the policy threshold. The portal was not changed.`);
      return runOutput(runId, 'needs_approval', task, plan, events, artifacts, memory, 'Approval is required before submitting this high-value invoice.');
    }
    const args = { invoiceId: opened.invoiceId, vendor: opened.vendor, amount: opened.amount, dueDate: opened.dueDate, currency: 'INR' };
    log('action', 'Browser: submit finance form', JSON.stringify(args));
    const saved = browserTool(state.browser, 'browser_submit_finance', args);
    log('observation', 'Browser: finance form saved', saved.entry.id);
    const verified = browserTool(state.browser, 'browser_verify_finance', args);
    log('verification', 'Browser outcome verified', verified.verified ? 'The finance record matches the invoice.' : 'The portal record did not match.');
    return runOutput(runId, verified.verified ? 'completed' : 'failed', task, plan, events, artifacts, memory, verified.verified ? 'The browser worker submitted and verified the finance record.' : 'The browser submission could not be verified.');
  }

  log('action', 'Searching approved workspace', task);
  await pause(140);
  const matches = searchWorkspace(task);
  memory.matches = matches.map(({ path, modifiedAt, score }) => ({ path, modifiedAt, score }));
  log('observation', 'Workspace search returned', `${matches.length} relevant file(s).`);
  for (const match of matches.slice(0, 4)) artifacts.push({ type: 'source_file', label: match.path, detail: match.excerpt, id: match.path });
  if (!spec.wantsInvoice || !spec.wantsWrite) {
    log('verification', 'Answer grounded in workspace', 'Every response includes a source-file excerpt.');
    return runOutput(runId, matches.length ? 'completed' : 'needs_clarification', task, plan, events, artifacts, memory, sourcedAnswer(matches));
  }

  if (!spec.vendor) {
    log('approval', 'Clarification required', 'A vendor name is required before a financial record can be created.');
    return runOutput(runId, 'needs_clarification', task, plan, events, artifacts, memory, 'Please provide a supported vendor name before I create a ledger record.');
  }

  const invoiceMatch = matches.find((match) => match.invoice);
  if (!invoiceMatch?.invoice) {
    log('approval', 'Clarification required', 'A complete invoice with amount and due date could not be extracted safely.');
    return runOutput(runId, 'needs_clarification', task, plan, events, artifacts, memory, 'Please identify the source file or provide a clearer vendor name.');
  }
  const invoice = invoiceMatch.invoice;
  memory.invoice = invoice;
  log('memory', 'Remembered extracted invoice', `${invoice.invoiceId}: ₹${invoice.amount.toLocaleString('en-IN')} due ${invoice.dueDate}.`);
  if (invoice.amount > policies.rules.ledgerWriteRequiresApprovalAbove && !options.approved) {
    log('approval', 'Human approval required', `₹${invoice.amount.toLocaleString('en-IN')} exceeds the policy threshold. No write was made.`);
    return runOutput(runId, 'needs_approval', task, plan, events, artifacts, memory, `Approval is required before recording ₹${invoice.amount.toLocaleString('en-IN')}.`);
  }
  const args = { invoiceId: invoice.invoiceId, vendor: invoice.vendor || spec.vendor || 'Unspecified vendor', amount: invoice.amount, currency: invoice.currency || 'INR', dueDate: invoice.dueDate, sourceFile: invoiceMatch.path };
  let write;
  try {
    log('action', 'Using create_ledger_entry', JSON.stringify(args));
    write = ledgerTool('create_ledger_entry', args);
  } catch (error) {
    if (error.code !== 'TRANSIENT') throw error;
    log('failure', 'create_ledger_entry failed', error.message);
    log('recovery', 'Transient failure detected', `Retrying once; policy allows ${policies.rules.maxTransientRetries} transient retry.`);
    await pause(300);
    write = ledgerTool('create_ledger_entry', args);
  }
  artifacts.push({ type: 'ledger_receipt', label: `Ledger entry ${write.entry.id}`, detail: `${write.entry.vendor} · ₹${write.entry.amount.toLocaleString('en-IN')}`, id: write.entry.id });
  const verification = ledgerTool('verify_ledger', args);
  log('verification', 'Outcome verified', verification.verified ? 'The ledger exactly matches invoice ID, amount, and due date.' : 'The ledger record did not match.');
  return runOutput(runId, verification.verified ? 'completed' : 'failed', task, plan, events, artifacts, memory, verification.verified ? `Recorded ${args.vendor}'s invoice and verified it in the internal ledger.` : 'The ledger write could not be verified.');
}

async function resumeRun(runId, approved = false) {
  const previous = getRun(runId);
  if (!previous) throw Error('That saved run no longer exists.');
  return runWorker(previous.task, { approved });
}

async function evaluateSuite() {
  const scenarios = [
    ['Grounded file answer', 'What does the operations handbook say about payment approval?', 'completed'],
    ['Retry + verification', 'Find the latest invoice from Company X and enter it into our internal system.', 'completed'],
    ['Approval gate', 'Find the latest invoice from CloudFleet and enter it into the ledger.', 'needs_approval'],
    ['Browser execution', 'Use the browser portal to find Company X invoice and enter it into the finance system.', 'completed'],
    ['Safe ambiguity', 'Find the invoice from Unknown Co and enter it into the ledger.', 'needs_clarification']
  ];
  const results = [];
  for (const [name, task, expected] of scenarios) {
    resetState();
    const output = await runWorker(task);
    results.push({ name, expected, actual: output.status, passed: output.status === expected });
  }
  return { total: results.length, passed: results.filter((result) => result.passed).length, results };
}

module.exports = { evaluateSuite, getRun, getRuns, getState: () => ({ ...clone(state), workspace: workspaceInfo(), policies }), resetState, resumeRun, runWorker };
