const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rules = fs.readFileSync('firestore.rules', 'utf8');
const privateFixture = JSON.parse(fs.readFileSync('tests/fixtures/private-profile.json', 'utf8'));
const publicFixture = JSON.parse(fs.readFileSync('tests/fixtures/public-recap.json', 'utf8'));

test('Firestore rules keep private profiles UID-scoped', () => {
  assert.match(rules, /match \/users\/\{uid\}\/\{document=\*\*\}/);
  assert.match(rules, /request\.auth != null && request\.auth\.uid == uid/);
  assert.match(rules, /match \/gamevault\/\{document=\*\*\}/);
  assert.match(rules, /match \/\{document=\*\*\}/);
  assert.match(rules, /allow read, write: if false/);
});

test('fixture payloads represent private profile and public recap boundaries', () => {
  assert.equal(privateFixture.ownerUid, 'user-a');
  assert.equal(privateFixture.schemaVersion, 3);
  assert.equal(privateFixture.sessions['fixture-game-1'].length, 1);
  assert.equal(publicFixture.profileId, 'user-a');
  assert.equal(publicFixture.totals.games, 1);
  assert.equal(publicFixture.yearly['2025'].games[0].title, 'Fixture Game');
});
