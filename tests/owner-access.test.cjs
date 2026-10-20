const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ownerUid = 'Qf6BCLccnvfJv5JEjROoxYlwhSv1';

test('launcher, Firestore and Steam endpoint use the same owner UID', () => {
  const renderer = fs.readFileSync('src/renderer/index.html', 'utf8');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const steamFunction = fs.readFileSync('netlify/functions/steam-library.js', 'utf8');

  assert.match(renderer, new RegExp(`PRG_OWNER_UID='${ownerUid}'`));
  assert.match(renderer, /user\.uid!==PRG_OWNER_UID/);
  assert.doesNotMatch(renderer, /id="auth-mode-btn"|createUserWithEmailAndPassword/);
  assert.match(rules, new RegExp(`request\\.auth\\.uid == '${ownerUid}'`));
  assert.match(rules, new RegExp(`allow read: if uid == '${ownerUid}'`));
  assert.match(steamFunction, new RegExp(`OWNER_UID = '${ownerUid}'`));
  assert.match(steamFunction, /account\.users\[0\]\?\.localId !== OWNER_UID/);
});
