const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/session-sync.js', 'utf8'), context);
const tools = context.window.createSessionSyncTools();
const plain = value => JSON.parse(JSON.stringify(value));
const session = (start, dur, source = 'manual') => ({ start, end: start + dur, dur, source });
const game = (id, sessions = [], extra = 0) => ({ id, title: id, status: 'Playing',
  sessions, playtime: extra + sessions.reduce((sum, item) => sum + item.dur, 0), lastPlayed: sessions.at(-1)?.end || null });

function fakeFirestore(initial = {}) {
  const values = new Map(Object.entries(plain(initial)));
  const doc = (_db, ...path) => path.join('/');
  const get = async ref => ({ exists: () => values.has(ref), data: () => plain(values.get(ref)) });
  const set = (ref, data, options) => values.set(ref, options?.merge ? { ...values.get(ref), ...plain(data) } : plain(data));
  return { values, doc,
    runTransaction: async (_db, callback) => callback({ get, set }),
    writeBatch: () => { const writes = []; return { set: (ref, data) => writes.push([ref, data]),
      commit: async () => writes.forEach(([ref, data]) => set(ref, data)) }; }
  };
}
function docs(db, path) {
  return [...db.values.entries()].filter(([key]) => key.startsWith(path)).map(([key, data]) => ({ id: key.slice(path.length), data: () => data }));
}
function assembled(db, generation) {
  return plain(tools.gamesFromDocuments(docs(db, 'users/demo/game-records/'),
    docs(db, 'users/demo/session-records/'), generation));
}

test('migration preserves the old snapshot and separates imported time from sessions', async () => {
  const rootRef = 'users/demo/profile/library';
  const source = game('a', [session(1, 10), session(20, 30)], 100);
  const root = { storageMode: 'games-v1', ts: 5, games: [source] };
  const db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [source] });
  assert.equal(db.values.get(rootRef).storageMode, tools.MODE);
  assert.deepEqual(db.values.get(rootRef).games, [source]);
  assert.equal(db.values.get(rootRef).sessionDocumentCount, 2);
  assert.equal(assembled(db, generation)[0].playtime, 140);
  assert.equal(assembled(db, generation)[0].sessions.length, 2);
  assert.equal(assembled(db, generation)[0]._syncSessionRevision, 0);
});

test('distinct simultaneous sessions merge without duplicate playtime on retry', async () => {
  const rootRef = 'users/demo/profile/library', base = game('a', [], 100);
  const root = { ts: 1, games: [base] }, db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [base] });
  const a = { ...base, sessions: [session(10, 20)], playtime: 120, lastPlayed: 30 };
  const b = { ...base, sessions: [session(50, 40)], playtime: 140, lastPlayed: 90 };
  const args = { runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation, baseGames: [base] };
  await tools.commitChanges({ ...args, localGames: [a] });
  await tools.commitChanges({ ...args, localGames: [b] });
  await tools.commitChanges({ ...args, localGames: [b] });
  const result = assembled(db, generation)[0];
  assert.equal(result.playtime, 160);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.lastPlayed, 90);
});

test('a conflicting session edit is rejected while an independent metadata edit merges', async () => {
  const rootRef = 'users/demo/profile/library', base = game('a', [session(1, 10)]);
  const root = { ts: 1, games: [base] }, db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [base] });
  const args = { runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation, baseGames: [base] };
  await tools.commitChanges({ ...args, localGames: [{ ...base, status: 'Completed' }] });
  await tools.commitChanges({ ...args, localGames: [{ ...base, title: 'Renamed' }] });
  assert.equal(assembled(db, generation)[0].status, 'Completed');
  assert.equal(assembled(db, generation)[0].title, 'Renamed');
  const key = tools.sessionDocumentId('a', [...tools.sessionIndex(base.sessions).keys()][0], generation);
  db.values.get(`users/demo/session-records/${key}`).session.dur = 15;
  await assert.rejects(tools.commitChanges({ ...args, localGames: [{ ...base, sessions: [], playtime: 0 }] }),
    error => error.code === 'sync-conflict');
});

test('editing a session preserves a manually chosen total and duplicate sessions', async () => {
  const rootRef = 'users/demo/profile/library';
  const base = game('a', [session(1, 10), session(1, 10)], 90);
  const root = { ts: 1, games: [base] }, db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [base] });
  assert.equal(assembled(db, generation)[0].sessions.length, 2);
  const edited = { ...base, sessions: [session(1, 20), session(1, 10)], playtime: 110 };
  await tools.commitChanges({ runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation,
    baseGames: [base], localGames: [edited] });
  const result = assembled(db, generation)[0];
  assert.equal(result.sessions.length, 2);
  assert.equal(result.playtime, 110);
});

test('concurrent append-only history events merge alongside sessions', async () => {
  const rootRef = 'users/demo/profile/library', base = game('a');
  const root = { ts: 1, games: [base] }, db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [base] });
  const a = { ...base, history: [{ id: 'e1', kind: 'session', at: 1 }] };
  const b = { ...base, history: [{ id: 'e2', kind: 'session', at: 2 }] };
  const args = { runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation, baseGames: [base] };
  await tools.commitChanges({ ...args, localGames: [a] });
  await tools.commitChanges({ ...args, localGames: [b] });
  assert.deepEqual(assembled(db, generation)[0].history.map(event => event.id), ['e1', 'e2']);
});

test('deleting a game after another device adds a session requires resolution', async () => {
  const rootRef = 'users/demo/profile/library', base = game('a');
  const root = { ts: 1, games: [base] }, db = fakeFirestore({ [rootRef]: root });
  const generation = await tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: db.writeBatch, uid: 'demo', root, games: [base] });
  await tools.commitChanges({ runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation,
    baseGames: [base], localGames: [{ ...base, sessions: [session(1, 5)], playtime: 5, lastPlayed: 6 }] });
  await assert.rejects(tools.commitChanges({ runTransaction: db.runTransaction, db, doc: db.doc, uid: 'demo', generation,
    baseGames: [base], localGames: [] }), error => error.code === 'sync-conflict');
});

test('interrupted migration leaves the previous mode authoritative', async () => {
  const rootRef = 'users/demo/profile/library';
  const root = { storageMode: 'games-v1', ts: 1, games: [game('a')] };
  const db = fakeFirestore({ [rootRef]: root });
  await assert.rejects(tools.migrateSnapshot({ runTransaction: db.runTransaction, db, rootRef,
    doc: db.doc, writeBatch: () => ({ set: () => {}, commit: async () => { throw new Error('offline'); } }),
    uid: 'demo', root, games: root.games }), /offline/);
  assert.equal(db.values.get(rootRef).storageMode, 'games-v1');
  assert.deepEqual(db.values.get(rootRef).games, root.games);
});
