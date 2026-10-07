const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/hltb-utils.js', 'utf8');
const context = { window: {}, URL };
vm.runInNewContext(source, context, { filename: 'hltb-utils.js' });
const hltb = context.window.createHltbUtils();

test('extracts HLTB ids and search slugs from valid links only', () => {
  assert.equal(JSON.stringify(hltb.hltbLinkInfo('https://howlongtobeat.com/game/71441/assassins-creed')), JSON.stringify({ id: 71441, slug: 'assassins creed' }));
  assert.equal(hltb.hltbLinkInfo('https://evil.example/game/71441/title'), null);
});

test('normalizes edition and platform suffixes for partial matching', () => {
  assert.equal(hltb.hltbSearchTitle('The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition'), 'The Legend of Zelda: Breath of the Wild');
  assert.equal(hltb.hltbSearchTitle("Assassin’s Creed® The Ezio Collection"), 'Assassins Creed The Ezio Collection');
  assert.equal(hltb.hltbTitleKey('KINGDOM HEARTS -HD 1.5+2.5 ReMIX'), 'kingdom hearts hd 1 5 2 5 remix');
});

test('ranks exact normalized matches above nearby editions', () => {
  const game = { title: 'The Witcher 3: Wild Hunt - Complete Edition' };
  const ranked = hltb.rankHltbCandidates(game, [{ title: 'The Witcher 3: Wild Hunt' }, { title: 'The Witcher 2: Assassins of Kings' }]);
  assert.equal(ranked[0].title, 'The Witcher 3: Wild Hunt');
});
