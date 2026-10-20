const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, runTransaction } = require('firebase/firestore');

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
  const publicRef = doc(alice, `public-dashboard/${ownerUid}`);
  const crossPublicRef = doc(bob, `public-dashboard/${ownerUid}`);

  await assertSucceeds(setDoc(privateRef, { schemaVersion: 3, games: [] }));
  await assertSucceeds(getDoc(privateRef));
  await assertFails(getDoc(crossPrivateRef));
  await assertFails(setDoc(otherPrivateRef, { schemaVersion: 3, games: [] }));
  await assertFails(getDoc(otherPrivateRef));
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
});

after(async () => {
  await environment?.cleanup();
});
