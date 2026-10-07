const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/firebase-sync.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'firebase-sync.js' });
const tools = context.window.createFirebaseSyncTools();

test('clones library snapshots without sharing session objects', () => {
  const sourceGames = [{ id: 'g1', sessions: [{ start: 1, dur: 20 }] }];
  const snapshot = tools.cloneLibrarySnapshot(sourceGames);
  snapshot[0].sessions[0].dur = 99;
  assert.equal(sourceGames[0].sessions[0].dur, 20);
});

test('chooses the newest remote snapshot unless local data is the only usable copy', () => {
  const remote = [{ id: 'remote' }];
  const local = [{ id: 'local' }];
  assert.equal(tools.chooseRemoteLibrary(remote, 20, local, 10)[0].id, 'remote');
  assert.equal(tools.chooseRemoteLibrary(remote, 10, local, 20)[0].id, 'local');
  assert.equal(tools.chooseRemoteLibrary(undefined, 20, local, 10)[0].id, 'local');
  assert.equal(tools.chooseRemoteLibrary([], 20, local, 10).length, 0);
});

test('writes a cloned library payload with ownership metadata', async () => {
  let payload;
  const setDoc = async (_ref, value, options) => { payload = { value, options }; };
  const games = [{ id: 'g1', sessions: [{ start: 1 }] }];
  await tools.writeLibrarySnapshot({ setDoc, ref: 'library-ref', uid: 'user-a', games, ts: 42, schemaVersion: 3, statsDashboard: { version: 2 } });
  assert.equal(payload.value.ownerUid, 'user-a');
  assert.equal(payload.value.ts, 42);
  assert.equal(payload.value.schemaVersion, 3);
  assert.equal(JSON.stringify(payload.value.statsDashboard), JSON.stringify({ version: 2 }));
  assert.equal(payload.options.merge, true);
  assert.notEqual(payload.value.games, games);
  assert.notEqual(payload.value.games[0].sessions, games[0].sessions);
});

test('queues one retry with exponential backoff and can retry immediately', async () => {
  let now = 0;
  const timers = new Map();
  const calls = [];
  const timerApi = {
    setTimeout: (fn, wait) => { const id = ++now; timers.set(id, { fn, wait }); return id; },
    clearTimeout: id => timers.delete(id)
  };
  const queue = tools.createFirebaseSyncQueue({
    isCurrentUser: user => user?.uid === 'u1',
    isBusy: () => false,
    isOffline: () => false,
    onStatus: (_state, _reason, wait) => calls.push(wait),
    onRetry: user => calls.push(`retry:${user.uid}`),
    timerApi
  });
  queue.schedule({ uid: 'u1' }, 'offline');
  queue.schedule({ uid: 'u1' }, 'duplicate');
  assert.deepEqual(calls, [5000]);
  assert.equal(queue.getState().pending, true);
  queue.retryNow({ uid: 'u1' });
  assert.deepEqual(calls, [5000, 'retry:u1']);
  assert.equal(queue.getState().pending, false);
});
