const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/sync-state.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'sync-state.js' });

test('coalesces concurrent writes and preserves dirty state', () => {
  const state = context.window.createSyncState();
  state.markDirty();
  assert.equal(state.beginWrite(), true);
  assert.equal(state.beginWrite(), false);
  state.requestWriteAgain();
  assert.equal(state.hasWriteAgain(), true);
  assert.equal(state.endWrite(), true);
  assert.equal(state.snapshot().dirty, true);
  state.clearDirty();
  assert.equal(state.snapshot().dirty, false);
});

test('allows only one retry at a time and resets cleanly', () => {
  const state = context.window.createSyncState();
  assert.equal(state.beginRetry(), true);
  assert.equal(state.beginRetry(), false);
  state.endRetry();
  assert.equal(state.beginRetry(), true);
  state.reset();
  assert.equal(JSON.stringify(state.snapshot()), JSON.stringify({ dirty: false, retrying: false, writing: false, writeAgain: false }));
});
