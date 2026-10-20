const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/document-sync.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('src/renderer/firebase-sync.js', 'utf8'), context);
const tools = context.window.createDocumentSyncTools();
const sync = context.window.createFirebaseSyncTools();
const plain = value => JSON.parse(JSON.stringify(value));
const game = (id, status = 'Backlog') => ({ id, status, sessions: [], playtime: 0 });

function fakeFirestore(initial = {}) {
  const values = new Map(Object.entries(plain(initial)));
  const ref = (_db, ...segments) => segments.join('/');
  const snap = key => ({ exists: () => values.has(key), data: () => plain(values.get(key)) });
  const set = (key, data, options) => values.set(key, options?.merge ? { ...values.get(key), ...plain(data) } : plain(data));
  return {
    values, ref,
    runTransaction: async (_db, callback) => callback({ get: async key => snap(key), set }),
    writeBatch: () => {
      const writes = [];
      return { set: (key, data) => writes.push([key, data]), commit: async () => writes.forEach(([key, data]) => set(key, data)) };
    }
  };
}

test('migration preserves legacy snapshot and writes generation-scoped game documents', async () => {
  const rootRef = 'users/demo/profile/library';
  const original = { games: [game('a'), game('b')], ts: 4 };
  const db = fakeFirestore({ [rootRef]: original });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db,
    rootRef, doc: db.ref, writeBatch: db.writeBatch, uid: 'demo', root: original, games: original.games });
  assert.equal(db.values.get(rootRef).storageMode, tools.MODE);
  assert.deepEqual(db.values.get(rootRef).games, original.games);
  const docs = [...db.values.entries()].filter(([key]) => key.startsWith('users/demo/games/'))
    .map(([key, value]) => ({ id: key.split('/').pop(), data: () => value }));
  assert.deepEqual(plain(tools.gamesFromDocuments(docs, generation, ['b', 'a']).map(item => item.id)), ['b', 'a']);
  assert.equal(await tools.migrateSnapshot({ root: db.values.get(rootRef) }), generation);
});

test('interrupted migration leaves the legacy snapshot authoritative', async () => {
  const rootRef = 'users/demo/profile/library';
  const original = { games: [game('a')], ts: 7 };
  const db = fakeFirestore({ [rootRef]: original });
  await assert.rejects(tools.migrateSnapshot({ runTransaction: db.runTransaction, db,
    rootRef, doc: db.ref, writeBatch: () => ({ set: () => {}, commit: async () => { throw new Error('offline'); } }),
    uid: 'demo', root: original, games: original.games }), /offline/);
  assert.equal(db.values.get(rootRef).storageMode, undefined);
  assert.deepEqual(db.values.get(rootRef).games, original.games);
});

test('separate game edits merge without rewriting the legacy snapshot', async () => {
  const rootRef = 'users/demo/profile/library';
  const base = [game('a'), game('b')];
  const db = fakeFirestore({ [rootRef]: { games: base },
    'users/demo/games/g_a': { game: base[0], generation: 'gen', deleted: false },
    'users/demo/games/g_b': { game: { ...base[1], status: 'Completed' }, generation: 'gen', deleted: false } });
  await tools.commitGameChanges({ runTransaction: db.runTransaction, db, doc: db.ref,
    uid: 'demo', generation: 'gen', baseGames: base,
    localGames: [{ ...base[0], status: 'Playing' }, base[1]], reconcileLibraries: sync.reconcileLibraries });
  assert.equal(db.values.get('users/demo/games/g_a').game.status, 'Playing');
  assert.equal(db.values.get('users/demo/games/g_b').game.status, 'Completed');
  assert.deepEqual(db.values.get(rootRef).games, base);
});

test('same-game independent sessions merge once, but conflicting status edits stop', async () => {
  const base = { ...game('a'), status: 'Playing' };
  const sessionA = { start: 1, end: 2, source: 'manual', dur: 10 };
  const sessionB = { start: 3, end: 4, source: 'manual', dur: 20 };
  const db = fakeFirestore({ 'users/demo/games/g_a': { game: { ...base, sessions: [sessionB], playtime: 20 }, generation: 'gen', deleted: false } });
  const args = { runTransaction: db.runTransaction, db, doc: db.ref, uid: 'demo', generation: 'gen',
    baseGames: [base], localGames: [{ ...base, sessions: [sessionA], playtime: 10 }], reconcileLibraries: sync.reconcileLibraries };
  await tools.commitGameChanges(args);
  await tools.commitGameChanges(args);
  assert.equal(db.values.get('users/demo/games/g_a').game.playtime, 30);
  assert.equal(db.values.get('users/demo/games/g_a').game.sessions.length, 2);
  db.values.get('users/demo/games/g_a').game.status = 'QuickPlay';
  await assert.rejects(tools.commitGameChanges({ ...args, localGames: [{ ...base, status: 'Completed' }] }),
    error => error.code === 'sync-conflict');
});

test('a deletion is tombstoned; conflicting remote edits are rejected and stale generations ignored', async () => {
  const base = game('a');
  const key = 'users/demo/games/g_a';
  const db = fakeFirestore({ [key]: { game: base, generation: 'gen', deleted: false } });
  const args = { runTransaction: db.runTransaction, db, doc: db.ref, uid: 'demo', generation: 'gen',
    baseGames: [base], localGames: [], reconcileLibraries: sync.reconcileLibraries };
  await tools.commitGameChanges(args);
  assert.equal(db.values.get(key).deleted, true);
  assert.deepEqual(plain(tools.gamesFromDocuments([{ id: 'g_a', data: () => db.values.get(key) }], 'gen')), []);
  db.values.set(key, { game: { ...base, status: 'Playing' }, generation: 'gen', deleted: false });
  await assert.rejects(tools.commitGameChanges(args), error => error.code === 'sync-conflict');
  db.values.set(key, { game: base, generation: 'another', deleted: false });
  await tools.commitGameChanges(args);
  assert.deepEqual(plain(tools.gamesFromDocuments([{ id: 'g_a', data: () => db.values.get(key) }], 'gen')), []);
  await tools.commitGameChanges({ ...args, baseGames: [], localGames: [game('a', 'Playing')] });
  assert.equal(db.values.get(key).generation, 'gen');
  assert.equal(db.values.get(key).game.status, 'Playing');
});
