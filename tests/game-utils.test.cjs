const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/game-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'game-utils.js' });

test('normalizes RAWG search titles without changing the useful words', () => {
  assert.equal(
    context.window.normalizeRawgSearchTitle("Assassin’s Creed®: The Ezio Collection"),
    'Assassins Creed The Ezio Collection'
  );
});

test('normalizes Backloggd titles and removes edition suffixes', () => {
  assert.equal(
    context.window.normalizeBackloggdTitle('The Witcher 3: Wild Hunt - Complete Edition'),
    'the witcher 3 wild hunt'
  );
});
