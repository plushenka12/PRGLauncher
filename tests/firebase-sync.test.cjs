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

test('pending offline edits require explicit resolution before replacing a different local library', () => {
  const local = [{ id: 'a', title: 'Local edit', sessions: [{ start: 1, dur: 10 }] }];
  const remote = [{ id: 'a', title: 'Remote edit', sessions: [{ start: 1, dur: 10 }] }];
  assert.equal(tools.shouldPromptForPendingConflict(true, local, remote), true);
  assert.equal(tools.shouldPromptForPendingConflict(false, local, remote), false);
  assert.equal(tools.shouldPromptForPendingConflict(true, local, local), false);
  assert.equal(tools.shouldPromptForPendingConflict(true, [], remote), true);
  assert.equal(tools.shouldPromptForPendingConflict(true, [], []), false);
});

test('three-way merge combines edits to different games and preserves deletions', () => {
  const base = [{ id: 'a', title: 'A', status: 'Backlog', sessions: [] }, { id: 'b', title: 'B', status: 'Backlog', sessions: [] }];
  const local = [{ ...base[0], status: 'Playing' }, base[1]];
  const remote = [base[0], { ...base[1], status: 'Completed' }];
  const merged = tools.reconcileLibraries(base, local, remote);
  assert.equal(merged.conflict, false);
  assert.equal(merged.games.find(game => game.id === 'a').status, 'Playing');
  assert.equal(merged.games.find(game => game.id === 'b').status, 'Completed');
  assert.equal(tools.reconcileLibraries(base, [base[0]], remote).conflict, true);
  assert.deepEqual(Array.from(tools.reconcileLibraries(base, [base[0]], base).games, game => game.id), ['a']);
});

test('three-way merge combines distinct appended sessions without double counting', () => {
  const base = [{ id: 'a', title: 'A', playtime: 10, lastPlayed: 5, sessions: [{ start: 1, end: 2, dur: 10, source: 'manual' }] }];
  const local = [{ ...base[0], playtime: 15, lastPlayed: 20, sessions: [...base[0].sessions, { start: 10, end: 11, dur: 5, source: 'manual' }] }];
  const remote = [{ ...base[0], playtime: 17, lastPlayed: 30, sessions: [...base[0].sessions, { start: 25, end: 26, dur: 7, source: 'steam' }] }];
  const merged = tools.reconcileLibraries(base, local, remote);
  assert.equal(merged.conflict, false);
  assert.equal(merged.games[0].playtime, 22);
  assert.equal(merged.games[0].lastPlayed, 30);
  assert.equal(merged.games[0].sessions.length, 3);
  assert.equal(tools.reconcileLibraries(base, merged.games, remote).games[0].sessions.length, 3);
});

test('three-way merge keeps independent fields on the same game', () => {
  const base = [{ id: 'a', title: 'A', status: 'Backlog', notes: '', sessions: [] }];
  const local = [{ ...base[0], status: 'Playing' }];
  const remote = [{ ...base[0], notes: 'Cloud note' }];
  const merged = tools.reconcileLibraries(base, local, remote);
  assert.equal(merged.conflict, false);
  assert.equal(merged.games[0].status, 'Playing');
  assert.equal(merged.games[0].notes, 'Cloud note');
});

test('three-way merge refuses unknown base, same-field conflict, deletion versus edit, and edited sessions', () => {
  const base = [{ id: 'a', title: 'A', status: 'Backlog', sessions: [{ start: 1, end: 2, dur: 10, source: 'manual' }] }];
  const local = [{ ...base[0], status: 'Playing' }];
  const remote = [{ ...base[0], status: 'Completed' }];
  assert.equal(tools.reconcileLibraries(null, local, remote).conflict, true);
  assert.equal(tools.reconcileLibraries(base, local, remote).conflict, true);
  assert.equal(tools.reconcileLibraries(base, [], local).conflict, true);
  const editedLocal = [{ ...base[0], sessions: [{ ...base[0].sessions[0], dur: 20 }] }];
  const appendedRemote = [{ ...base[0], sessions: [...base[0].sessions, { start: 3, end: 4, dur: 5, source: 'manual' }] }];
  assert.equal(tools.reconcileLibraries(base, editedLocal, appendedRemote).conflict, true);
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

test('transaction re-reads the cloud and merges concurrent edits before writing', async () => {
  const base = [{ id: 'a', status: 'Backlog', sessions: [] }, { id: 'b', status: 'Backlog', sessions: [] }];
  const local = [{ ...base[0], status: 'Playing' }, base[1]];
  const remote = [base[0], { ...base[1], status: 'Completed' }];
  let written;
  const runTransaction = async (_db, update) => update({
    get: async () => ({ exists: () => true, data: () => ({ games: remote, ts: 42 }) }),
    set: (_ref, payload) => { written = payload; }
  });
  const result = await tools.commitLibraryTransaction({
    runTransaction, db: {}, ref: {}, baseGames: base, localGames: local,
    extractGames: snapshot => snapshot.games,
    buildPayload: (games, ts) => ({ games, ts })
  });
  assert.equal(result.games[0].status, 'Playing');
  assert.equal(result.games[1].status, 'Completed');
  assert.deepEqual(Array.from(written.games, game => game.status), ['Playing', 'Completed']);
  assert.ok(written.ts > 42);
});

test('transaction refuses a concurrent same-game conflict without writing', async () => {
  const base = [{ id: 'a', status: 'Backlog', sessions: [] }];
  const local = [{ ...base[0], status: 'Playing' }];
  const remote = [{ ...base[0], status: 'Completed' }];
  let writes = 0;
  await assert.rejects(tools.commitLibraryTransaction({
    runTransaction: async (_db, update) => update({
      get: async () => ({ exists: () => true, data: () => ({ games: remote, ts: 42 }) }),
      set: () => { writes++; }
    }),
    db: {}, ref: {}, baseGames: base, localGames: local,
    extractGames: snapshot => snapshot.games,
    buildPayload: games => ({ games })
  }), error => error.code === 'sync-conflict' && error.remoteGames[0].status === 'Completed');
  assert.equal(writes, 0);
});

test('transaction never recreates a deleted cloud library without an explicit choice', async () => {
  const library = [{ id: 'a', title: 'A', sessions: [] }];
  let writes = 0;
  const args = {
    runTransaction: async (_db, update) => update({
      get: async () => ({ exists: () => false }),
      set: () => { writes++; }
    }),
    db: {}, ref: {}, baseGames: library, localGames: library,
    extractGames: snapshot => snapshot.games,
    buildPayload: games => ({ games })
  };
  await assert.rejects(tools.commitLibraryTransaction(args), error => error.code === 'sync-conflict');
  assert.equal(writes, 0);
  const accepted = await tools.commitLibraryTransaction({ ...args, forceLocalAgainst: [] });
  assert.equal(accepted.games.length, 1);
  assert.equal(writes, 1);
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
