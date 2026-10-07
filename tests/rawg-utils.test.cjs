const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gameSource = fs.readFileSync('src/renderer/game-utils.js', 'utf8');
const rawgSource = fs.readFileSync('src/renderer/rawg-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(gameSource, context, { filename: 'game-utils.js' });
vm.runInNewContext(rawgSource, context, { filename: 'rawg-utils.js' });
const rawg = context.window.createRawgUtils();

test('ranks exact RAWG title matches above nearby editions', () => {
  const match = rawg.bestRawgMatch('KINGDOM HEARTS -HD 1.5+2.5 ReMIX', [
    { id: 1, name: 'KINGDOM HEARTS HD 1.5 +2.5 ReMIX' },
    { id: 2, name: 'Kingdom Hearts III' }
  ]);
  assert.equal(match.id, 1);
  assert.ok(rawg.rawgMatchScore('Kingdom Hearts III', match) < 1000);
});

test('returns no RAWG candidate for empty results', () => {
  assert.equal(rawg.bestRawgMatch('Unknown', []), null);
});
