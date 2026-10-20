const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, runTransaction, writeBatch, collection, getDocsFromServer } = require('firebase/firestore');

const rules = fs.readFileSync('firestore.rules', 'utf8');
const ownerUid = 'Qf6BCLccnvfJv5JEjROoxYlwhSv1';
let environment;

test('Firestore emulator enforces owner-only launcher data and public owner recap', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-prglauncher',
    firestore: { rules }
  });
  const alice = environment.authenticatedContext(ownerUid).firestore();
  const bob = environment.authenticatedContext('user-b').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const privateRef = doc(alice, `users/${ownerUid}/profile/library`);
  const crossPrivateRef = doc(bob, `users/${ownerUid}/profile/library`);
  const otherPrivateRef = doc(bob, 'users/user-b/profile/library');
  const ownerGameRef = doc(alice, `users/${ownerUid}/games/g_demo`);
  const crossGameRef = doc(bob, `users/${ownerUid}/games/g_demo`);
  const publicRef = doc(alice, `public-dashboard/${ownerUid}`);
  const crossPublicRef = doc(bob, `public-dashboard/${ownerUid}`);

  await assertSucceeds(setDoc(privateRef, { schemaVersion: 3, games: [] }));
  await assertSucceeds(getDoc(privateRef));
  await assertFails(getDoc(crossPrivateRef));
  await assertFails(setDoc(otherPrivateRef, { schemaVersion: 3, games: [] }));
  await assertFails(getDoc(otherPrivateRef));
  await assertSucceeds(setDoc(ownerGameRef, { generation: 'demo', game: { id: 'demo', sessions: [] }, deleted: false }));
  await assertSucceeds(getDoc(ownerGameRef));
  await assertFails(getDoc(crossGameRef));
  await assertFails(setDoc(crossGameRef, { deleted: true }));
  await assertSucceeds(setDoc(publicRef, { version: 2, totals: { games: 0 } }));
  await assertSucceeds(getDoc(doc(anonymous, `public-dashboard/${ownerUid}`)));
  await assertFails(setDoc(crossPublicRef, { version: 2 }));
  await assertFails(getDoc(doc(anonymous, 'public-dashboard/user-b')));
  await assertFails(setDoc(doc(bob, 'public-dashboard/user-b'), { version: 2 }));
  await assertFails(setDoc(doc(alice, 'gamevault/legacy'), { blocked: true }));

  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('src/renderer/firebase-sync.js', 'utf8'), context);
  const sync = context.window.createFirebaseSyncTools();
  const base = [{ id: 'a', status: 'Backlog', sessions: [] }, { id: 'b', status: 'Backlog', sessions: [] }];
  const local = [{ ...base[0], status: 'Playing' }, base[1]];
  const remote = [base[0], { ...base[1], status: 'Completed' }];
  await setDoc(privateRef, { games: remote, ts: 1 });
  const committed = await sync.commitLibraryTransaction({
    runTransaction, db: alice, ref: privateRef, baseGames: base, localGames: local,
    extractGames: snapshot => snapshot.games,
    buildPayload: (games, ts) => ({ games: JSON.parse(JSON.stringify(games)), ts, ownerUid })
  });
  assert.equal(committed.games[0].status, 'Playing');
  assert.equal((await getDoc(privateRef)).data().games[1].status, 'Completed');
  await assert.rejects(sync.commitLibraryTransaction({
    runTransaction, db: alice, ref: privateRef, baseGames: base,
    localGames: [{ ...base[0], status: 'QuickPlay' }, base[1]],
    extractGames: snapshot => snapshot.games,
    buildPayload: (games, ts) => ({ games: JSON.parse(JSON.stringify(games)), ts, ownerUid })
  }), error => error.code === 'sync-conflict');

  vm.runInNewContext(fs.readFileSync('src/renderer/document-sync.js', 'utf8'), context);
  const documentSync = context.window.createDocumentSyncTools();
  const legacy = (await getDoc(privateRef)).data();
  // Firestore rejects objects created in the VM realm used by pure-module tests.
  // Normalize only at this test boundary; the renderer uses one browser realm.
  const normalize = value => JSON.parse(JSON.stringify(value));
  const normalizedTransaction = (database, callback) => runTransaction(database, transaction => callback({
    get: ref => transaction.get(ref),
    set: (ref, value, options) => transaction.set(ref, normalize(value), options)
  }));
  const normalizedBatch = database => {
    const batch = writeBatch(database);
    return { set: (ref, value) => batch.set(ref, normalize(value)), commit: () => batch.commit() };
  };
  const generation = await documentSync.migrateSnapshot({ runTransaction: normalizedTransaction, db: alice,
    rootRef: privateRef, doc, writeBatch: normalizedBatch, uid: ownerUid, root: legacy, games: legacy.games });
  const migrated = (await getDoc(privateRef)).data();
  assert.equal(migrated.documentGeneration, generation);
  assert.deepEqual(migrated.games, legacy.games);
  const gameDocs = await getDocsFromServer(collection(alice, `users/${ownerUid}/games`));
  assert.equal(documentSync.gamesFromDocuments(gameDocs.docs, generation).length, 2);
  await documentSync.commitGameChanges({ runTransaction: normalizedTransaction, db: alice, doc, uid: ownerUid, generation,
    baseGames: legacy.games, localGames: [{ ...legacy.games[0], status: 'QuickPlay' }, legacy.games[1]],
    reconcileLibraries: sync.reconcileLibraries });
  assert.equal((await getDoc(doc(alice, `users/${ownerUid}/games/g_a`))).data().game.status, 'QuickPlay');
  assert.deepEqual((await getDoc(privateRef)).data().games, legacy.games);

  vm.runInNewContext(fs.readFileSync('src/renderer/session-sync.js', 'utf8'), context);
  const sessionSync = context.window.createSessionSyncTools();
  const previousRoot = (await getDoc(privateRef)).data();
  const previousDocs = await getDocsFromServer(collection(alice, `users/${ownerUid}/games`));
  const sourceGames = documentSync.gamesFromDocuments(previousDocs.docs, generation, previousRoot.orderIds);
  const sessionGeneration = await sessionSync.migrateSnapshot({ runTransaction: normalizedTransaction,
    db: alice, rootRef: privateRef, doc, writeBatch: normalizedBatch, uid: ownerUid,
    root: previousRoot, games: sourceGames });
  const newRoot = (await getDoc(privateRef)).data();
  assert.equal(newRoot.storageMode, sessionSync.MODE);
  assert.deepEqual(newRoot.games, legacy.games);
  const separateGames = await getDocsFromServer(collection(alice, `users/${ownerUid}/game-records`));
  const separateSessions = await getDocsFromServer(collection(alice, `users/${ownerUid}/session-records`));
  assert.equal(sessionSync.gamesFromDocuments(separateGames.docs, separateSessions.docs, sessionGeneration).length, 2);
  const first = sourceGames[0];
  const added = { start: 100, end: 110, dur: 10, source: 'manual' };
  await sessionSync.commitChanges({ runTransaction: normalizedTransaction, db: alice, doc,
    uid: ownerUid, generation: sessionGeneration, baseGames: sourceGames,
    localGames: [{ ...first, sessions: [...(first.sessions || []), added],
      playtime: Number(first.playtime || 0) + 10, lastPlayed: 110 }, sourceGames[1]] });
  const afterGames = await getDocsFromServer(collection(alice, `users/${ownerUid}/game-records`));
  const afterSessions = await getDocsFromServer(collection(alice, `users/${ownerUid}/session-records`));
  const final = sessionSync.gamesFromDocuments(afterGames.docs, afterSessions.docs, sessionGeneration);
  assert.equal(final.find(game => game.id === first.id).sessions.length, 1);
  assert.equal(final.find(game => game.id === first.id).playtime, Number(first.playtime || 0) + 10);
  await assertFails(getDoc(doc(bob, `users/${ownerUid}/game-records/g_a`)));
  await assertFails(setDoc(doc(bob, `users/${ownerUid}/session-records/s_fake`), { session: { dur: 1 } }));
});

after(async () => {
  await environment?.cleanup();
});
