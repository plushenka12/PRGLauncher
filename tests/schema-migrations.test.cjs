const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/schema-migrations.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'schema-migrations.js' });
const migrations = context.window.createSchemaMigrations();

test('migrates legacy games to the current canonical shape', () => {
  const result = migrations.migrateProfileSnapshot({ schemaVersion: 1, games: [{ id: 7, title: 'Legacy', sessions: [{ start: 100, end: 160 }] }] });
  assert.equal(result.schemaVersion, migrations.CURRENT_SCHEMA_VERSION);
  assert.equal(result.games[0].id, '7');
  assert.equal(result.games[0].status, 'Backlog');
  assert.equal(result.games[0].platform, 'PC');
  assert.equal(result.games[0].sessions[0].dur, 60);
  assert.equal(result.games[0].playtime, 60);
});

test('migration is idempotent and does not mutate input', () => {
  const legacy = { id: 'g1', title: 'Game', sessions: [{ start: 1, dur: 10 }] };
  const once = migrations.migrateGames([legacy]);
  const twice = migrations.migrateGames(once);
  assert.equal(legacy.playtime, undefined);
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
});
