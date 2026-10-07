const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const rules = fs.readFileSync('firestore.rules', 'utf8');
let environment;

test('Firestore emulator enforces private and public boundaries', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-prglauncher',
    firestore: { rules }
  });
  const alice = environment.authenticatedContext('user-a').firestore();
  const bob = environment.authenticatedContext('user-b').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const privateRef = doc(alice, 'users/user-a/profile/library');
  const crossPrivateRef = doc(bob, 'users/user-a/profile/library');
  const publicRef = doc(alice, 'public-dashboard/user-a');
  const crossPublicRef = doc(bob, 'public-dashboard/user-a');

  await assertSucceeds(setDoc(privateRef, { schemaVersion: 3, games: [] }));
  await assertSucceeds(getDoc(privateRef));
  await assertFails(getDoc(crossPrivateRef));
  await assertSucceeds(setDoc(publicRef, { version: 2, totals: { games: 0 } }));
  await assertSucceeds(getDoc(doc(anonymous, 'public-dashboard/user-a')));
  await assertFails(setDoc(crossPublicRef, { version: 2 }));
  await assertFails(setDoc(doc(alice, 'gamevault/legacy'), { blocked: true }));
});

after(async () => {
  await environment?.cleanup();
});
