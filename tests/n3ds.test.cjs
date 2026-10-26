const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const { parseUpload, readEntries, buildSessions, minuteToTime, MAX_SPAN_MINUTES } = require('../src/main/n3ds-history.js');
const { createN3dsReceiver, isLocalAddress, newCode } = require('../src/main/n3ds-receiver.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const GAME = [0x00040000, 0x00055D00];
const OTHER = [0x00040000, 0x0011C400];
const SYSTEM = [0x00040010, 0x00020800];
const SPECIAL = [0xFFFFFFFF, 0xFFFFFFFF];
const E = { launch: 0b0000, close: 0b0001, suspend: 0b0101, resume: 0b0100 };
const S = { dsEnd: 1, sleep: 8, wake: 9, stopped: 10, clockFrom: 11, clockTo: 12 };

// Builds a PlayHistory.dat buffer; `start` rotates the ring like the console does.
function history(entries, { start = 0 } = {}) {
  const buffer = Buffer.alloc(8 + entries.length * 12);
  buffer.writeUInt32LE(start, 0);
  buffer.writeUInt32LE(entries.length, 4);
  entries.forEach(([title, event, minute], index) => {
    const slot = (start + index) % entries.length;
    buffer.writeUInt32LE(title[0], 8 + slot * 12);
    buffer.writeUInt32LE(title[1], 12 + slot * 12);
    buffer.writeUInt32LE(((minute << 4) | event) >>> 0, 16 + slot * 12);
  });
  return buffer;
}
const sessionsOf = entries => buildSessions(readEntries(history(entries)));
const T0 = 14_000_000; // minutes since 2000, around 2026

test('a launch and a close make one session; suspend and sleep pause it', () => {
  const { sessions, skipped } = sessionsOf([
    [GAME, E.launch, T0], [GAME, E.suspend, T0 + 30], [GAME, E.resume, T0 + 40],
    [SPECIAL, S.sleep, T0 + 50], [SPECIAL, S.wake, T0 + 200], [GAME, E.close, T0 + 230],
  ]);
  assert.equal(skipped, 0);
  assert.deepEqual(sessions, [{ titleId: '0004000000055D00', startMinute: T0, endMinute: T0 + 230, minutes: 30 + 10 + 30 }]);
});

test('the ring buffer is read from its start index', () => {
  const entries = [[GAME, E.launch, T0], [GAME, E.close, T0 + 20], [OTHER, E.launch, T0 + 30], [OTHER, E.close, T0 + 45]];
  assert.deepEqual(buildSessions(readEntries(history(entries, { start: 3 }))).sessions.map(item => item.minutes), [20, 15]);
});

test('history from the PTM service is read in whichever order runs forward in time', () => {
  const entries = [[GAME, E.launch, T0], [GAME, E.close, T0 + 20], [OTHER, E.launch, T0 + 30], [OTHER, E.close, T0 + 45]];
  const minutes = buffer => parseUpload({ version: 1, source: 'ptm', titles: [{ id: '0004000000055D00', name: 'A' }, { id: '000400000011C400', name: 'B' }], history: buffer.toString('base64') }).games.map(game => game.sessions[0].dur / 60000);
  // Oldest first even though PTM reports a start index.
  const ordered = history(entries); ordered.writeUInt32LE(3, 0);
  assert.deepEqual(minutes(ordered), [20, 15]);
  // Ring order, as in the file.
  assert.deepEqual(minutes(history(entries, { start: 3 })), [20, 15]);
});

test('system titles, open sessions and broken spans are not counted', () => {
  const { sessions, skipped } = sessionsOf([
    [SYSTEM, E.launch, T0], [SYSTEM, E.close, T0 + 90],
    [GAME, E.launch, T0 + 100], [GAME, E.close, T0 + 100 + MAX_SPAN_MINUTES + 1],
    [OTHER, E.launch, T0 + 2000], [OTHER, E.close, T0 + 1990],
    [GAME, E.launch, T0 + 3000],
  ]);
  assert.deepEqual(sessions, [], 'only the system title and broken or unfinished spans');
  assert.equal(skipped, 2);
});

test('a new launch, services stopping or DS mode ending closes the running game', () => {
  const { sessions } = sessionsOf([
    [GAME, E.launch, T0], [OTHER, E.launch, T0 + 15], [SPECIAL, S.stopped, T0 + 40],
    [GAME, E.launch, T0 + 50], [SPECIAL, S.dsEnd, T0 + 55],
  ]);
  assert.deepEqual(sessions.map(item => [item.titleId.slice(8), item.minutes]), [['00055D00', 15], ['0011C400', 25], ['00055D00', 5]]);
});

test('a clock change moves the running span with the clock', () => {
  const { sessions } = sessionsOf([
    [GAME, E.launch, T0], [SPECIAL, S.clockFrom, T0 + 10], [SPECIAL, S.clockTo, T0 + 10 + 600], [GAME, E.close, T0 + 620],
  ]);
  assert.equal(sessions[0].minutes, 20);
});

test('uploads are validated and only named games are returned', () => {
  const body = { version: 1, titles: [{ id: '0004000000055d00', name: '  Pokémon\u0000 Y ' }, { id: 'nope', name: 'x' }], history: history([[GAME, E.launch, T0], [GAME, E.close, T0 + 60], [OTHER, E.launch, T0 + 70], [OTHER, E.close, T0 + 80]]).toString('base64') };
  const result = parseUpload(body);
  assert.equal(result.ok, true);
  assert.equal(result.unnamed, 1);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].title, 'Pokémon Y');
  assert.deepEqual(result.games[0].sessions, [{ start: minuteToTime(T0), end: minuteToTime(T0) + 3600000, dur: 3600000 }]);
  assert.equal(minuteToTime(0), new Date(2000, 0, 1).getTime());
  for (const bad of [null, {}, { version: 2, history: '' }, { version: 1, history: '!!' }, { version: 1, history: Buffer.alloc(4).toString('base64') }]) {
    assert.equal(parseUpload(bad).ok, false, JSON.stringify(bad));
  }
  const lying = Buffer.alloc(20); lying.writeUInt32LE(5000, 4);
  assert.equal(parseUpload({ version: 1, history: lying.toString('base64') }).ok, false, 'a count larger than the data');
});

test('the receiver accepts the home network only and needs the pairing code', async () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.20.1.1', '169.254.3.3']) assert.equal(isLocalAddress(address), true, address);
  for (const address of ['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:db8::1', '']) assert.equal(isLocalAddress(address), false, address);
  assert.match(newCode(), /^\d{6}$/);
  assert.equal(newCode(() => 42), '000042');

  const uploads = [];
  let clock = 0;
  const receiver = createN3dsReceiver({ http, getCode: () => '123456', onUpload: async body => { uploads.push(body); return { ok: true, games: 1 }; }, now: () => clock });
  const port = 47833 + 1000 + Math.floor(Math.random() * 1000);
  assert.deepEqual(await receiver.start(port), { ok: true, port });
  const send = (code, body = '{"version":1}', path = '/n3ds/v1/upload') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'X-PRG-Code': code, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal((await send('123456', '{"version":1}', '/other')).status, 404);
    assert.deepEqual(await send('123456'), { status: 200, body: { ok: true, games: 1 } });
    assert.equal((await send('123456', '{not json')).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await send('000000')).status, 403);
    assert.equal((await send('123456')).status, 429, 'five wrong codes lock it, even for the right one');
    clock += 10 * 60 * 1000 + 1;
    assert.equal((await send('123456')).status, 200, 'unlocked after 10 minutes');
    assert.equal(uploads.length, 2);
  } finally {
    await receiver.stop();
  }
  assert.equal(receiver.isRunning(), false);
});

const n3ds = (() => { const context = { window: {} }; vm.runInNewContext(fs.readFileSync('src/renderer/n3ds-utils.js', 'utf8'), context); return context.window.createN3dsUtils(); })();
const HOUR = 3600000;
const now = Date.parse('2026-10-26T12:00:00Z');
let ids = 0;
const makeId = () => `id${++ids}`;

test('merging an upload adds games and sessions once', () => {
  const games = [];
  const upload = { games: [
    { titleId: '0004000000055D00', title: 'Pokémon Y', sessions: [{ start: now - 2 * HOUR, end: now - HOUR, dur: HOUR }] },
    { titleId: '0004000000030800', title: 'Mario Kart 7', sessions: [{ start: now - 400 * 24 * HOUR, end: now - 400 * 24 * HOUR + HOUR, dur: HOUR }] },
  ] };
  const first = n3ds.mergeUpload(games, upload, { now, makeId });
  assert.equal(first.added.length, 2);
  assert.equal(first.sessions, 2);
  const pokemon = games.find(game => game.title === 'Pokémon Y');
  assert.equal(pokemon.status, 'Playing');
  assert.equal(pokemon.platform, 'Nintendo 3DS');
  assert.equal(pokemon.playtime, HOUR);
  assert.equal(games.find(game => game.title === 'Mario Kart 7').status, 'QuickPlay', 'old games do not fill Playing');
  const again = n3ds.mergeUpload(games, upload, { now, makeId });
  assert.deepEqual([again.added.length, again.updated.length, again.sessions], [0, 0, 0], 'sending again changes nothing');
  assert.equal(pokemon.playtime, HOUR);
  upload.games[0].sessions.push({ start: now - 30 * 60000, end: now, dur: 30 * 60000 });
  const later = n3ds.mergeUpload(games, upload, { now, makeId });
  assert.equal(later.updated.length, 1);
  assert.equal(pokemon.playtime, HOUR * 1.5);
  assert.equal(pokemon.lastPlayed, now);
});

test('the first link to a game typed in by hand does not double its time', () => {
  const games = [{ id: 'm', title: 'Pokémon  Y', platform: 'Nintendo 3DS', status: 'Completed', playtime: 50 * HOUR, sessions: [] }];
  const upload = { games: [{ titleId: '0004000000055D00', title: 'Pokémon Y', sessions: [{ start: now - 9 * HOUR, end: now - HOUR, dur: 8 * HOUR }] }] };
  n3ds.mergeUpload(games, upload, { now, makeId });
  assert.equal(games.length, 1, 'matched by title on the 3DS platform');
  assert.equal(games[0].n3dsTitleId, '0004000000055D00');
  assert.equal(games[0].playtime, 50 * HOUR, 'the larger total is kept');
  assert.equal(games[0].status, 'Completed');
  const switchGame = [{ id: 's', title: 'Pokémon Y', platform: 'Nintendo Switch', playtime: HOUR, sessions: [] }];
  n3ds.mergeUpload(switchGame, upload, { now, makeId });
  assert.equal(switchGame.length, 2, 'a game on another platform is not merged');
});

test('main and renderer wire the 3DS receiver behind the owner window', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  for (const channel of ['n3ds:getStatus', 'n3ds:setEnabled', 'n3ds:newCode', 'n3ds:takePending']) assert.match(main, new RegExp(`handleFromMain\\('${channel}'`), channel);
  assert.match(main, /if \(loadN3dsConfig\(\)\.enabled\) n3dsReceiver\.start\(N3DS_PORT\)/, 'off unless the owner turned it on');
  assert.match(main, /enabled: config\.enabled === true/);
  const renderer = rendererSource();
  assert.match(renderer, /<script src="\.\/n3ds-utils\.js"><\/script>/);
  assert.match(renderer, /id="n3ds-enabled"/);
  assert.match(renderer, /if\(isGuest\|\|!currentUser\|\|!window\.launcher\?\.takeN3dsPending\)return;/);
  const status = renderer.slice(renderer.indexOf('function renderN3dsStatus(status){'), renderer.indexOf('async function loadN3dsSettings()'));
  assert.doesNotMatch(status, /innerHTML/);
  assert.ok(fs.existsSync('homebrew/prg3ds/source/main.c'));
  assert.match(fs.readFileSync('homebrew/prg3ds/source/main.c', 'utf8'), /"\/PlayHistory\.dat"\), FS_OPEN_READ, 0\)/, 'the history is opened read only');
});
