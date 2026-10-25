const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const html = rendererSource();
const start = html.indexOf('function saveModal(){');
const end = html.indexOf('// ── HOWLONGTOBEAT', start);
assert.ok(start >= 0 && end > start);
const saveModalSource = html.slice(start, end);
const utilsContext = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/game-utils.js', 'utf8'), utilsContext);

function saveManually(existingGames, title) {
  const fields = new Map(Object.entries({
    'f-title': { value: title }, 'rawg-chips': { dataset: { genres: '[]', tags: '[]', steamAppId: '' } },
    'f-steam-appid': { value: '' }, 'f-year': { value: '2026' }, 'f-status': { value: 'Backlog' },
    'f-executable': { value: '' }, 'f-working-directory': { value: '' }, 'f-launch-arguments': { value: '' },
    'f-cover': { value: '' }, 'f-notes': { value: '' }, 'f-backlog-priority': { value: 'Later' }
  }));
  const opened = [];
  const context = {
    document: { getElementById: id => fields.get(id) }, games: existingGames, editingId: null,
    selectedPlatform: 'PC', selectedRating: 0, editReturnToDetailId: null, THIS_YEAR: 2026,
    uid: () => 'new', findExistingDuplicateGames: utilsContext.window.findExistingDuplicateGames,
    addGameHistory() {}, save() {}, pushToFb() {}, closeModal() {}, buildFilterBar() {},
    renderGrid() {}, updateStats() {}, openDetail() {}, openDuplicateCenter: id => opened.push(id)
  };
  vm.runInNewContext(`${saveModalSource}\nsaveModal();`, context);
  return { games: context.games, opened };
}

test('manual add suggests merging with an existing Switch game', () => {
  const result = saveManually([{ id: 'switch', title: 'Example Game', platform: 'Nintendo Switch' }], 'Example Game');
  assert.deepEqual(result.opened, ['new']);
  assert.equal(result.games.length, 2);
});

test('manual add does not suggest merging unrelated games', () => {
  const result = saveManually([{ id: 'switch', title: 'Different Game', platform: 'Nintendo Switch' }], 'Example Game');
  assert.deepEqual(result.opened, []);
  assert.equal(result.games.length, 2);
});
