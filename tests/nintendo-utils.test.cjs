const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/nintendo-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'nintendo-utils.js' });
const nintendo = context.window.createNintendoUtils();

test('normalizes Nintendo activity titles, minutes and platform', () => {
  const rows = nintendo.normalizeNintendoHistory({ playActivity: [{ titleId: '1', titleName: 'Zelda', totalPlayedHours: 2.5, platform: 'Switch 2' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Zelda');
  assert.equal(rows[0].minutes, 150);
  assert.equal(rows[0].platform, 'Nintendo Switch 2');
});

test('extracts unique daily Nintendo sessions', () => {
  const rows = nintendo.extractNintendoDaily({ history: [{ date: '2026-01-02', minutes: 30 }, { date: '2026-01-02', minutes: 30 }, { date: '2026-01-03', minutes: 15 }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows.map(row => row.minutes)), [30, 15]);
});

const plainJson = value => JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-10-26T12:00:00Z');

test('Switch and Switch 2 Edition titles share one key', () => {
  const key = nintendo.editionKey;
  assert.equal(key('Super Mario Party Jamboree – Nintendo Switch 2 Edition + Jamboree TV'), key('Super Mario Party Jamboree'));
  assert.equal(key('The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition'), key('The Legend of Zelda: Tears of the Kingdom'));
  assert.notEqual(key('Mario Kart 8 Deluxe'), key('Mario Kart World'));
  const games = fs.readFileSync('src/renderer/game-utils.js', 'utf8');
  const utils = { window: {} };
  vm.runInNewContext(games, utils);
  const normalize = utils.window.normalizeBackloggdTitle;
  assert.equal(normalize('Kirby and the Forgotten Land – Nintendo Switch 2 Edition + Star-Crossed World'), normalize('Kirby and the Forgotten Land'), 'the duplicate centre groups them');
});

test('each edition in a merged card keeps its own sync baseline', () => {
  const game = { title: 'Zelda TOTK', nintendoTitleId: 'base', nintendoLastSeenMinutes: 600, nintendoLastSeenPlayedAt: NOW - 86400000, playtime: 600 * 60000, sessions: [], lastPlayed: NOW - 86400000 };
  const base = { id: 'base', minutes: 600, lastPlayedAt: null, raw: {} };
  const edition = { id: 'ns2', minutes: 120, lastPlayedAt: new Date(NOW - 3600000).toISOString(), raw: {} };
  let result = nintendo.applyNintendoItem(game, edition, { now: NOW });
  assert.equal(result.updated, true, 'a new edition brings its time');
  assert.equal(game.playtime, 720 * 60000);
  assert.deepEqual(plainJson(game.nintendoEditions.map(entry => [entry.id, entry.minutes])), [['ns2', 120]]);
  // Syncing both titles again changes nothing: no baseline swinging between them.
  for (let round = 0; round < 3; round += 1) {
    assert.equal(nintendo.applyNintendoItem(game, base, { now: NOW }).updated, false);
    assert.equal(nintendo.applyNintendoItem(game, edition, { now: NOW }).updated, false);
  }
  assert.equal(game.playtime, 720 * 60000);
  result = nintendo.applyNintendoItem(game, { ...edition, minutes: 150 }, { now: NOW });
  assert.equal(game.playtime, 750 * 60000, 'only the edition grew');
  assert.equal(game.nintendoLastSeenMinutes, 600);
  assert.equal(nintendo.ownsTitle(game, 'ns2'), true);
});

test('merging two Nintendo editions adds their times and keeps the second baseline', () => {
  const primary = { nintendoTitleId: 'base', nintendoLastSeenMinutes: 600, playtime: 600 * 60000 };
  const duplicate = { nintendoTitleId: 'ns2', nintendoLastSeenMinutes: 120, nintendoImportedDailyKeys: ['k1'], playtime: 120 * 60000 };
  assert.equal(nintendo.mergeNintendoEditions(primary, duplicate), true);
  assert.deepEqual(plainJson(primary.nintendoEditions), [{ id: 'ns2', minutes: 120, playedAt: null, daily: ['k1'], sync: null }]);
  assert.equal(nintendo.mergeNintendoEditions({ nintendoTitleId: 'a' }, { nintendoTitleId: 'a' }), false, 'the same title is a plain duplicate');
  assert.equal(nintendo.mergeNintendoEditions({ nintendoTitleId: 'a' }, { title: 'manual' }), false);
  const app = fs.readFileSync('src/renderer/app.js', 'utf8');
  assert.match(app, /primary\.playtime=separateEditions\?Number\(primary\.playtime\|\|0\)\+Number\(duplicate\.playtime\|\|0\):Math\.max/);
  assert.match(app, /if\(game&&game\.nintendoTitleId&&!nintendoUtils\.ownsTitle\(game,item\.id\)&&cleanTitle\(game\.title\)!==normalizedIncoming\)game=null;/, 'a merely similar name is not linked');
  assert.match(app, /const applied=nintendoUtils\.applyNintendoItem\(game,item,\{now:Date\.now\(\)\}\)/);
});
