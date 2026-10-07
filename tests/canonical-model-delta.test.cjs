const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/canonical-model.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'canonical-model.js' });
const model = context.window.createCanonicalModel();

test('merges offline session deltas idempotently without losing remote metadata', () => {
  const local = [{ id: 'g1', title: 'Local title', sessions: [{ start: 10, end: 20, source: 'steam' }] }];
  const remote = [{ id: 'g1', title: 'Remote title', sessions: [{ start: 30, end: 40, source: 'steam' }, { start: 10, end: 20, source: 'steam' }] }];
  const merged = model.mergeSessionDelta(local, remote);
  assert.equal(merged[0].title, 'Remote title');
  assert.equal(merged[0].sessions.length, 2);
  assert.equal(merged[0].sessions[0].start, 10);
  assert.equal(merged[0].sessions[1].start, 30);
  assert.equal(model.mergeSessionDelta(local, merged)[0].sessions.length, 2);
});
