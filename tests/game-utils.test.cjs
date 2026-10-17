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

test('finds existing games to suggest a merge after a manual add', () => {
  const games = [
    { id: 'new', title: 'The Legend of Zelda: Echoes of Wisdom', platform: 'PC' },
    { id: 'switch', title: 'The Legend of Zelda: Echoes of Wisdom', platform: 'Nintendo Switch' },
    { id: 'other', title: 'The Legend of Zelda: Breath of the Wild', platform: 'Nintendo Switch' }
  ];
  const matches = context.window.findExistingDuplicateGames(games, 'new');
  assert.deepEqual(Array.from(matches, game => game.id), ['switch']);
  assert.equal(context.window.findExistingDuplicateGames(games, 'other').length, 0);
});

test('retains local launch data and notes when merging into a Switch card', () => {
  const switchGame = { title: 'Example Game', notes: 'Switch notes', genres: ['Adventure'], tags: [] };
  const localGame = { localExecutable: 'C:\\Games\\Example\\game.exe', workingDirectory: 'C:\\Games\\Example', launchArguments: '--safe', notes: 'PC notes', genres: ['Puzzle'], tags: ['Manual'] };
  context.window.preserveManualMergeFields(switchGame, localGame);
  assert.equal(switchGame.localExecutable, localGame.localExecutable);
  assert.equal(switchGame.workingDirectory, localGame.workingDirectory);
  assert.equal(switchGame.launchArguments, '--safe');
  assert.match(switchGame.notes, /Switch notes/);
  assert.match(switchGame.notes, /PC notes/);
  assert.deepEqual(Array.from(switchGame.genres), ['Adventure', 'Puzzle']);
  assert.deepEqual(Array.from(switchGame.tags), ['Manual']);
});
