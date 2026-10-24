const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, setDoc, writeBatch,
  disableNetwork, enableNetwork } = require('firebase/firestore');

const ownerUid = 'Qf6BCLccnvfJv5JEjROoxYlwhSv1';
const rules = fs.readFileSync('firestore.rules', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const game = { id: 'dual-device-demo', title: 'Demo Game', status: 'Playing',
  playtime: 60, sessions: [], lastPlayed: null };

function createClient(environment) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('src/renderer/session-sync.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('src/renderer/schema-migrations.js', 'utf8'), context);
  return { db: environment.authenticatedContext(ownerUid).firestore(),
    sync: context.window.createSessionSyncTools(), schema: context.window.createSchemaMigrations() };
}

function normalizedTransaction(database, callback) {
  return runTransaction(database, transaction => callback({
    get: ref => transaction.get(ref),
    set: (ref, value, options) => transaction.set(ref, plain(value), options)
  }));
}

async function readLibrary(client, generation) {
  const [gameDocs, sessionDocs] = await Promise.all([
    getDocsFromServer(collection(client.db, `users/${ownerUid}/game-records`)),
    getDocsFromServer(collection(client.db, `users/${ownerUid}/session-records`))
  ]);
  return plain(client.schema.migrateGames(client.sync.gamesFromDocuments(
    gameDocs.docs, sessionDocs.docs, generation)));
}

async function writeChange(client, generation, base, local) {
  await client.sync.commitChanges({ runTransaction: normalizedTransaction,
    db: client.db, doc, uid: ownerUid, generation, baseGames: base, localGames: local });
  const games = await readLibrary(client, generation);
  await setDoc(doc(client.db, `users/${ownerUid}/profile/library`),
    { ts: Date.now(), orderIds: games.map(item => String(item.id)) }, { merge: true });
  return games;
}

test('two independent clients merge offline sessions, retry idempotently and reject a conflicting status',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
    const environment = await initializeTestEnvironment({
      projectId: 'demo-prglauncher-two-clients', firestore: { rules }
    });
    try {
      const a = createClient(environment), b = createClient(environment);
      const rootRef = doc(a.db, `users/${ownerUid}/profile/library`);
      const normalizedGame = plain(a.schema.migrateGames([game])[0]);
      const legacy = { games: [normalizedGame], ts: 1, ownerUid };
      await setDoc(rootRef, plain(legacy));
      const generation = await a.sync.migrateSnapshot({ runTransaction: normalizedTransaction,
        db: a.db, rootRef, doc, uid: ownerUid, root: legacy, games: legacy.games,
        writeBatch: database => {
          const batch = writeBatch(database);
          return { set: (ref, value) => batch.set(ref, plain(value)), commit: () => batch.commit() };
        } });
      const baseA = await readLibrary(a, generation);
      const baseB = await readLibrary(b, generation);
      assert.deepEqual(baseA, baseB);

      // B keeps a local edit while the network is unavailable, as a second PC would.
      const sessionB = { start: 300, end: 330, dur: 30, source: 'manual' };
      const pendingB = [{ ...baseB[0], sessions: [sessionB], playtime: 90, lastPlayed: 330 }];
      await disableNetwork(b.db);
      await assert.rejects(getDocFromServer(doc(b.db, `users/${ownerUid}/profile/library`)));
      const sessionA = { start: 100, end: 120, dur: 20, source: 'manual' };
      await writeChange(a, generation, baseA,
        [{ ...baseA[0], sessions: [sessionA], playtime: 80, lastPlayed: 120 }]);
      await enableNetwork(b.db);
      await writeChange(b, generation, baseB, pendingB);

      const mergedA = await readLibrary(a, generation);
      const mergedB = await readLibrary(b, generation);
      assert.deepEqual(mergedA, mergedB);
      assert.deepEqual(mergedA[0].sessions.map(item => item.start), [100, 300]);
      assert.equal(mergedA[0].playtime, 110);
      assert.equal(mergedA[0].lastPlayed, 330);
      assert.deepEqual((await getDocFromServer(rootRef)).data().games, legacy.games,
        'the legacy recovery snapshot must remain intact');

      await writeChange(b, generation, baseB, pendingB);
      assert.equal((await readLibrary(a, generation))[0].sessions.length, 2);
      assert.equal((await readLibrary(a, generation))[0].playtime, 110);

      const staleA = await readLibrary(a, generation);
      const staleB = await readLibrary(b, generation);
      await writeChange(a, generation, staleA, [{ ...staleA[0], status: 'Completed' }]);
      await assert.rejects(writeChange(b, generation, staleB,
        [{ ...staleB[0], status: 'QuickPlay' }]), error => error.code === 'sync-conflict');
      assert.equal((await readLibrary(a, generation))[0].status, 'Completed');

      // After an explicit "keep this device" choice, the current cloud state
      // becomes the baseline. Local metadata and even a local deletion win.
      const latest = await readLibrary(b, generation);
      await writeChange(b, generation, latest, [{ ...latest[0], status: 'QuickPlay' }]);
      assert.equal((await readLibrary(a, generation))[0].status, 'QuickPlay');
      await writeChange(b, generation, await readLibrary(b, generation), []);
      assert.equal((await readLibrary(a, generation)).length, 0);
    } finally {
      await environment.cleanup();
    }
  });
