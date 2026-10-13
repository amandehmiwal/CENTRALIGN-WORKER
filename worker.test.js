const test = require('node:test');
const assert = require('node:assert/strict');
const { runWorker, resetState, getState } = require('./worker');

test('worker returns evidence from the approved workspace', async () => {
  resetState();
  const output = await runWorker('What does the operations handbook say about payment approval?');
  assert.equal(output.status, 'completed');
  assert.match(output.summary, /Payments above ₹100,000/);
  assert.equal(output.artifacts[0].label, 'company-handbook.md');
});

test('worker retries and verifies a ledger write', async () => {
  resetState();
  const output = await runWorker('Find the latest invoice from Company X, enter it into our internal system, and tell me once done.');
  assert.equal(output.status, 'completed');
  assert.equal(getState().ledger.length, 1);
  assert.ok(output.events.some((event) => event.kind === 'recovery'));
});

test('large payment stops for approval', async () => {
  resetState();
  const output = await runWorker('Find latest invoice from CloudFleet and enter it into the ledger.');
  assert.equal(output.status, 'needs_approval');
  assert.equal(getState().ledger.length, 0);
});
