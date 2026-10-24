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

test('a conflict choice can wait for an in-flight write without losing it', async () => {
  const state = context.window.createSyncState();
  assert.equal(state.beginWrite(), true);
  let settled = false;
  const waiting = state.waitForWrite().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  state.endWrite();
  await waiting;
  assert.equal(settled, true);
  assert.equal(state.beginWrite(), true);
  state.reset();
});

test('account reset releases a waiting conflict choice', async () => {
  const state = context.window.createSyncState();
  state.beginWrite();
  const waiting = state.waitForWrite();
  state.reset();
  await waiting;
  assert.equal(state.snapshot().writing, false);
});
