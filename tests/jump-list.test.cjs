const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchIdFrom, cleanGames, pngToIco, findSteamIcon, buildItems, MAX_GAMES } = require('../src/main/jump-list.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

test('a jump-list click carries one safe game id', () => {
  assert.equal(launchIdFrom(['electron.exe', '.', '--prg-launch=mnb2x9k1abc']), 'mnb2x9k1abc');
  for (const argv of [['x', '--prg-launch='], ['x', '--prg-launch=a b'], ['x', '--prg-launch=../../x"'], ['x'], null]) assert.equal(launchIdFrom(argv), null, JSON.stringify(argv));
});

test('only recent, launchable games with safe fields reach the menu', () => {
  const games = cleanGames([
    { id: 'g1', title: 'Hades\u0000 II', appId: '1145350', executable: 'C:\\x.bat', detail: '20 h' },
    { id: 'g2', title: 'Local', executable: 'D:\\Games\\Game.exe' },
    { id: 'g3', title: 'Relative', executable: 'Game.exe', appId: '12a' },
    { id: 'bad id', title: 'x' },
    { id: 'g4', title: '   ' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, title: `More ${i}` })),
  ]);
  assert.deepEqual(games.slice(0, 3), [
    { id: 'g1', title: 'Hades II', appId: '1145350', executable: '', detail: '20 h' },
    { id: 'g2', title: 'Local', appId: '', executable: 'D:\\Games\\Game.exe', detail: '' },
    { id: 'g3', title: 'Relative', appId: '', executable: '', detail: '' },
  ]);
  assert.ok(games.length <= MAX_GAMES);
});

test('menu items start this exe with the game id and show its icon', () => {
  const items = buildItems([{ id: 'g1', title: 'Hades II', detail: '20 h' }, { id: 'g2', title: 'No icon', detail: '' }], {
    program: 'C:\\Program Files\\PRGLauncher\\PRGLauncher.exe',
    baseArgs: ['C:\\dev app'],
    iconFor: game => (game.id === 'g1' ? 'C:\\icons\\1145350.ico' : null),
  });
  assert.deepEqual(items[0], { type: 'task', title: 'Hades II', description: '20 h', program: 'C:\\Program Files\\PRGLauncher\\PRGLauncher.exe', args: '"C:\\dev app" --prg-launch=g1', iconPath: 'C:\\icons\\1145350.ico', iconIndex: 0 });
  assert.equal(items[1].iconPath, 'C:\\Program Files\\PRGLauncher\\PRGLauncher.exe', 'the app icon when the game has none');
  assert.equal(items[1].description, 'No icon');
});

test('Steam game icons become .ico files Windows can read', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const ico = pngToIco(png, 64);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.equal(ico.readUInt8(6), 64);
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.deepEqual(ico.subarray(22), png);
  assert.equal(pngToIco(png, 256).readUInt8(6), 0, '256 px is written as 0');

  const steam = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-steam-'));
  const dir = path.join(steam, 'appcache', 'librarycache', '10');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['header.jpg', 'library_600x900.jpg', '6b0312cda02f5f777efa2f3318c307ff9acafbb5.jpg']) fs.writeFileSync(path.join(dir, name), '');
  assert.equal(findSteamIcon(fs, steam, '10'), path.join(dir, '6b0312cda02f5f777efa2f3318c307ff9acafbb5.jpg'));
  assert.equal(findSteamIcon(fs, steam, '11'), null);
  assert.equal(findSteamIcon(fs, steam, '../10'), null);
});

test('main and renderer wire the jump list', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  assert.match(main, /handleFromMain\('jumplist:update'/);
  assert.match(main, /handleFromMain\('jumplist:takePending'/);
  assert.match(main, /app\.on\('second-instance', \(_, argv\) => \{\r?\n    if \(handleLaunchArgs\(argv\)\) return/);
  const renderer = rendererSource();
  assert.match(renderer, /function launchFromJumpList\(gameId\)\{/);
  assert.match(renderer, /if\(!game\|\|activeGameId===game\.id\|\|guestBlock\(\)\|\|\(!game\.steamAppId&&!game\.localExecutable\)\)return;\r?\n  launchAndTrack\(game\.id\);/, 'local games still go through the launch approval');
  assert.match(renderer, /importN3dsPending\(\);runPendingJumpLaunch\(\);/);
});
