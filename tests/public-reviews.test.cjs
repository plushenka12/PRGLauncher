const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/recap-utils.js', 'utf8'), context);
const { buildPublicReviews, buildPublicLibrary, choosePublicLibraryConsent } = context.window.createRecapUtils();

test('public library consent follows the server unless explicitly changed', () => {
  assert.equal(choosePublicLibraryConsent(false, '1'), false, 'another device must not silently restore revoked access');
  assert.equal(choosePublicLibraryConsent(true, '0'), true, 'a stale local setting must not silently unpublish');
  assert.equal(choosePublicLibraryConsent(true, '0', true), false, 'an explicit off click revokes access');
  assert.equal(choosePublicLibraryConsent(false, '1', true), true, 'an explicit on click publishes');
  assert.equal(choosePublicLibraryConsent(null, null), false, 'new profiles default to private');
});

test('guest library includes only a small public projection', () => {
  const games = [{
    id: 'demo', title: 'Demo Game', status: 'Playing', platform: 'PC', platforms: ['PC', 'Nintendo Switch'],
    cover: 'https://media.rawg.io/demo.jpg', rating: 9, playtime: 7200000,
    sessions: [{ start: 123, end: 456, source: 'manual' }],
    hltb: { mainStoryMinutes: 240, sourceUrl: 'https://howlongtobeat.com/game/1', hidden: false },
    notes: 'secret note', executablePath: 'C:\\private\\game.exe', steamAppId: 123,
    review: { markdown: 'private draft', public: false }, account: { token: 'secret token' }
  }];
  const output = buildPublicLibrary(games);
  assert.equal(output.length, 1);
  assert.equal(output[0].sessions, 1);
  assert.equal(output[0].hltbMainMinutes, 240);
  for (const secret of ['secret note', 'game.exe', 'steamAppId', 'private draft', 'secret token', 'sourceUrl', 'start']) {
    assert.equal(JSON.stringify(output).includes(secret), false, secret);
  }
});

test('guest library rejects unsafe cover URLs and hidden HLTB', () => {
  const [game] = buildPublicLibrary([{ title: 'Unsafe', cover: 'javascript:alert(1)', hltb: { mainStoryMinutes: 60, hidden: true } }]);
  assert.equal(game.cover, null);
  assert.equal(game.hltbMainMinutes, null);
});

test('only expressly published reviews enter the public projection', () => {
  const games = [
    { id: 'private', title: 'Private', notes: 'secret', review: { markdown: 'draft', public: false } },
    { id: 'visible', title: 'Visible', notes: 'never publish this', steamAppId: 55, rating: 8, review: { markdown: '**Worth playing**', public: true, updatedAt: 123 } },
    { id: 'empty', title: 'Empty', review: { markdown: ' ', public: true } }
  ];
  const reviews = buildPublicReviews(games);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].gameId, 'visible');
  assert.equal(reviews[0].markdown, '**Worth playing**');
  assert.equal(reviews[0].rating, 8);
  assert.equal(JSON.stringify(reviews).includes('secret'), false);
  assert.equal(JSON.stringify(reviews).includes('steamAppId'), false);
});

test('overlong published text is not silently truncated in public', () => {
  assert.equal(buildPublicReviews([{ id: 'long', title: 'Long', review: { markdown: 'a'.repeat(3001), public: true } }]).length, 0);
});

test('merging duplicate games keeps both distinct reviews privately', () => {
  const source = fs.readFileSync('src/renderer/index.html', 'utf8');
  const mergeSource = source.split('function mergeGameRecord(')[1].split('\n')[0];
  const mergeContext = {
    ensureGameSources: game => { game.sources ||= []; },
    addGameSource: () => {},
    Date
  };
  vm.runInNewContext(`function mergeGameRecord(${mergeSource}`, mergeContext);
  const primary = { id: 'one', platform: 'PC', status: 'Backlog', review: { markdown: 'First review', public: true }, sessions: [], history: [] };
  const duplicate = { id: 'two', platform: 'PC', status: 'Backlog', review: { markdown: 'Second review', public: true }, sessions: [], history: [] };
  mergeContext.mergeGameRecord(primary, duplicate);
  assert.match(primary.review.markdown, /First review/);
  assert.match(primary.review.markdown, /Second review/);
  assert.equal(primary.review.public, false);
});
