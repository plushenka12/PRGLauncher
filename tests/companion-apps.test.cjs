const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCompanionApps } = require('../src/main/companion-apps.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const main = fs.readFileSync('src/main/index.js', 'utf8');
const preload = fs.readFileSync('src/preload/index.js', 'utf8');
const renderer = rendererSource();

function setup(running = []) {
  const commands = [];
  const spawned = [];
  const apps = createCompanionApps({
    platform: 'win32',
    runCommand: async (file, args) => {
      commands.push([file, ...args]);
      if (file === 'tasklist') {
        const name = args[1].replace('imagename eq ', '');
        return { ok: true, stdout: running.includes(name) ? `"${name}","123","Console","1","10 K"` : 'INFO: No tasks are running which match the specified criteria.' };
      }
      return { ok: true, stdout: '' };
    },
    spawn: (file, args, options) => { spawned.push({ file, args, cwd: options.cwd, detached: options.detached }); return { unref() {} }; },
  });
  return { apps, commands, spawned };
}

const pob = 'C:\\Games\\Path of Building\\Path of Building.exe';
const trade = 'C:\\Users\\me\\AppData\\Local\\Programs\\awakened-poe-trade\\Awakened PoE Trade.exe';

test('companions start next to their own folder and are remembered per game', async () => {
  const { apps, spawned } = setup();
  assert.deepEqual(await apps.launch({ gameId: 'poe', executable: pob, closeWithGame: true }), { action: 'requested' });
  assert.deepEqual(await apps.launch({ gameId: 'poe', executable: trade, closeWithGame: false }), { action: 'requested' });
  assert.deepEqual(spawned.map(item => [item.file, item.cwd, item.detached]), [[pob, 'C:\\Games\\Path of Building', true], [trade, 'C:\\Users\\me\\AppData\\Local\\Programs\\awakened-poe-trade', true]]);
  assert.deepEqual(apps.tracked('poe').map(app => app.imageName), ['Path of Building.exe', 'Awakened PoE Trade.exe']);
});

test('a program that is already open is not started twice and never closed by the launcher', async () => {
  const { apps, spawned, commands } = setup(['Path of Building.exe']);
  assert.deepEqual(await apps.launch({ gameId: 'poe', executable: pob, closeWithGame: true }), { action: 'already-running' });
  assert.deepEqual(spawned, []);
  assert.deepEqual(await apps.closeFor('poe'), { closed: 0 });
  assert.equal(commands.filter(([file]) => file === 'taskkill').length, 0);
});

test('ending the game closes only its companions marked "close with game", politely', async () => {
  const { apps, commands } = setup();
  await apps.launch({ gameId: 'poe', executable: pob, closeWithGame: true });
  await apps.launch({ gameId: 'poe', executable: trade, closeWithGame: false });
  await apps.launch({ gameId: 'other', executable: 'C:\\Tools\\Overlay.exe', closeWithGame: true });
  assert.deepEqual(await apps.closeFor('poe'), { closed: 1 });
  assert.deepEqual(commands.filter(([file]) => file === 'taskkill'), [['taskkill', '/im', 'Path of Building.exe', '/t']], 'no /f: the program may still ask to save');
  assert.deepEqual(apps.tracked('poe'), [], 'forgotten after closing');
  assert.equal(apps.tracked('other').length, 1, 'other games keep theirs');
  assert.deepEqual(await apps.closeFor('poe'), { closed: 0 }, 'closing twice does nothing');
});

test('main process launches companions through the same approval as games', () => {
  assert.match(main, /handleFromMain\('local:launchCompanion'[\s\S]*?const refused = await approveLocalExecutable\(executable, \[\]\)[\s\S]*?companionApps\.launch\(/);
  assert.match(main, /handleFromMain\('local:closeCompanions'/);
  const launchGame = main.slice(main.indexOf("ipcMain.handle('local:launchGame'"), main.indexOf('\n})', main.indexOf("ipcMain.handle('local:launchGame'")));
  assert.match(launchGame, /approveLocalExecutable\(executable,/);
  assert.match(main, /const parent = mainWindow && !mainWindow\.isDestroyed\(\) && mainWindow\.isVisible\(\) \? mainWindow : null/, 'confirmation stays visible when the big window is hidden');
  assert.match(preload, /launchCompanion: \(payload\) => ipcRenderer\.invoke\('local:launchCompanion', payload\)/);
  assert.match(preload, /closeCompanions: \(gameId\) => ipcRenderer\.invoke\('local:closeCompanions', gameId\)/);
});

test('renderer starts companions with the game and closes them when its session ends', () => {
  const launch = renderer.slice(renderer.indexOf('async function launchAndTrack(gameId){'), renderer.indexOf('function showSteamPage()'));
  assert.match(launch, /startTimer\(gameId,'local'\);launchCompanionsFor\(game\);return;/);
  assert.match(launch, /if\(result\?\.action==='requested'\)\{launchCompanionsFor\(game\);return;\}/);
  const stop = renderer.slice(renderer.indexOf('function stopTimer(silent){'), renderer.indexOf('\n}', renderer.indexOf('function stopTimer(silent){')));
  assert.match(stop, /window\.launcher\?\.closeCompanions\?\.\(activeGameId\)/);
  const render = renderer.slice(renderer.indexOf('function renderCompanions(game){'), renderer.indexOf('async function addCompanion('));
  assert.doesNotMatch(render, /innerHTML/, 'paths and names are set as text');
});

test('adding a companion skips duplicates and the game itself', async () => {
  const pick = name => { const start = renderer.indexOf(`${name}(`); const from = renderer.lastIndexOf('\n', start) + 1; return renderer.slice(from, renderer.indexOf('\n}', start) + 2); };
  const game = { id: 'poe', title: 'Path of Exile', localExecutable: 'C:\\Games\\PoE\\PathOfExile.exe', companions: [] };
  const picks = [pob, pob.toUpperCase(), 'C:\\Games\\PoE\\PathOfExile.exe', trade];
  let saves = 0;
  const context = {
    getGame: id => (id === 'poe' ? game : null), guestBlock: () => false, save: () => { saves += 1; }, renderCompanions: () => {},
    window: { launcher: { chooseExecutable: async () => ({ canceled: false, path: picks.shift() }) } },
    Date, Math, String, Array,
  };
  vm.runInNewContext(`${pick('function companionName')}\n${pick('async function addCompanion')}\nthis.add = addCompanion`, context);
  for (let i = 0; i < 4; i++) await context.add('poe');
  assert.deepEqual(game.companions.map(app => [app.name, app.closeWithGame]), [['Path of Building', false], ['Awakened PoE Trade', false]]);
  assert.equal(saves, 2);
  assert.ok(game.companions.every(app => /^c[a-z0-9]+$/.test(app.id)));
});
