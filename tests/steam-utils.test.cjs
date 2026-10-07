const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/steam-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'steam-utils.js' });
const steam = context.window.createSteamUtils();

test('normalizes Steam payloads and rejects invalid playtime', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(steam.normalizeSteamGame({ appId: '10', name: ' Test ', playtimeMinutes: -2 }))), { appId: 10, title: 'Test', cover: null, minutes: 0, installed: false });
});

test('merges only positive Steam playtime deltas', () => {
  const game = { playtime: 60000, steamLastSeenMinutes: 10 };
  assert.equal(steam.mergeSteamPlaytime(game, { minutes: 8 }), 0);
  assert.equal(game.playtime, 60000);
  assert.equal(steam.mergeSteamPlaytime(game, { minutes: 13 }), 180000);
  assert.equal(game.playtime, 240000);
  assert.equal(game.steamLastSeenMinutes, 13);
});

test('maps known Steam import errors to safe user-facing copy', () => {
  assert.match(steam.importErrorMessage('LIBRARY_PRIVATE'), /Бібліотека недоступна/);
  assert.match(steam.importErrorMessage('unknown'), /Не вдалося завантажити Steam/);
});
