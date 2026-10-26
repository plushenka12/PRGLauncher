const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/library-export.js', 'utf8'), context);
const tools = context.window.createLibraryExport();
const plain = value => JSON.parse(JSON.stringify(value));

const HOUR = 3600000;
const games = [
  {
    id: 'g1', title: 'Hollow Knight', platform: 'Nintendo Switch', status: 'Playing', rating: 9, playtime: 27.5 * HOUR,
    added: Date.UTC(2026, 0, 2), lastPlayed: Date.UTC(2026, 9, 20),
    notes: 'private', localExecutable: 'C:\\Games\\hk.exe', launchArguments: '-x', companions: [{ path: 'C:\\x.exe' }], nintendoTitleId: '0100', review: { markdown: 'secret' },
    hltb: { mainStoryMinutes: 1620 },
    sessions: [{ start: Date.UTC(2026, 9, 20), end: Date.UTC(2026, 9, 20) + HOUR, dur: HOUR, source: 'nintendo-sync' }, { start: 'bad', dur: 5 }],
  },
  { id: 'g2', title: '=HYPERLINK("http://evil")', status: 'Weird', playtime: 0 },
  { id: 'g3', title: '   ' },
];

test('only what the library shows is exported', () => {
  const rows = plain(tools.exportGames(games));
  assert.equal(rows.length, 2, 'untitled games are skipped');
  assert.deepEqual(rows[0], {
    title: 'Hollow Knight', platform: 'Nintendo Switch', status: 'Playing', rating: 9, playtimeHours: 27.5, sessionCount: 1,
    firstPlayed: '2026-10-20T00:00:00.000Z', lastPlayed: '2026-10-20T00:00:00.000Z', added: '2026-01-02T00:00:00.000Z',
    hltbMainStoryHours: 27, steamAppId: '',
    sessions: [{ start: '2026-10-20T00:00:00.000Z', end: '2026-10-20T01:00:00.000Z', minutes: 60, source: 'nintendo-sync' }],
  });
  assert.equal(rows[1].status, 'Backlog');
  const json = tools.toJson(rows, Date.UTC(2026, 9, 26));
  for (const secret of ['private', 'hk.exe', 'secret', '0100', 'launchArguments', 'companions']) assert.ok(!json.includes(secret), secret);
  assert.equal(JSON.parse(json).format, 'prglauncher-library-export');
});

test('the CSV opens in Excel and cannot run formulas', () => {
  const csv = tools.toCsv(tools.exportGames(games));
  assert.ok(csv.startsWith('\uFEFFtitle;platform;status;'), 'BOM and semicolons');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^"'=HYPERLINK\(""http:\/\/evil""\)";;Backlog;/, 'formula neutralised and quoted');
});

test('the export buttons sit next to the backup', () => {
  const renderer = rendererSource();
  assert.match(renderer, /<script src="\.\/library-export\.js"><\/script>/);
  assert.match(renderer, /id="export-library-csv"/);
  assert.match(renderer, /id="export-library-json"/);
  assert.match(renderer, /function exportLibrary\(kind\)\{\r?\n  if\(guestBlock\(\)\)return;/);
});
