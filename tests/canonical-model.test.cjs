const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/canonical-model.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'canonical-model.js' });
const model = context.window.createCanonicalModel();

test('builds a backward-compatible canonical snapshot with separated sessions', () => {
  const games = [{ id: 'g1', title: 'Game', sessions: [{ start: 1, dur: 5 }] }];
  const snapshot = model.buildCanonicalSnapshot({ games, ownerUid: 'u1', ts: 10, profile: { theme: 'neon' }, integrations: { steamProfile: 'x' }, statsDashboard: { version: 2 } });
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.ownerUid, 'u1');
  assert.equal(snapshot.games.length, 1);
  assert.equal(snapshot.sessions.g1[0].dur, 5);
  assert.equal(snapshot.profile.theme, 'neon');
  assert.equal(snapshot.integrations.steamProfile, 'x');
});

test('extracts canonical sessions and remains compatible with legacy snapshots', () => {
  const canonical = { games: [{ id: 'g1', title: 'Game', sessions: [] }], sessions: { g1: [{ start: 5, dur: 8 }] } };
  assert.equal(model.extractGames(canonical)[0].sessions[0].dur, 8);
  assert.equal(model.extractGames({ games: [{ id: 'g2', title: 'Legacy', sessions: [{ dur: 2 }] }] })[0].sessions[0].dur, 2);
});
