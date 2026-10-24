const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { resolveMiniTabBounds, loadSavedBounds, saveBounds, isReachable, MIN_HEIGHT } = require('../src/main/mini-tab-bounds.js');
const { STEAM_GUARD_SCRIPT, createSteamWindowGuard } = require('../src/main/steam-window-guard.js');

const main = fs.readFileSync('src/main/index.js', 'utf8');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');

const primary = { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
const second = { id: 2, workArea: { x: 2560, y: 0, width: 1920, height: 1040 } };

test('mini-tab opens in the top-right of the second monitor at a third of its height', () => {
  const bounds = resolveMiniTabBounds({ saved: null, displays: [primary, second], primaryId: 1 });
  assert.equal(bounds.height, Math.round(1040 / 3));
  assert.equal(bounds.x + bounds.width, 2560 + 1920 - 16);
  assert.equal(bounds.y, 16);
});

test('mini-tab falls back to the only monitor and never goes below its minimum height', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 600 } };
  const bounds = resolveMiniTabBounds({ saved: null, displays: [small], primaryId: 1 });
  assert.ok(bounds.x > 0 && bounds.x + bounds.width <= 1280);
  assert.equal(bounds.height, MIN_HEIGHT);
});

test('a remembered position is reused while it is still on a monitor', () => {
  const saved = { x: 3000, y: 300, width: 300, height: 400 };
  assert.deepEqual(resolveMiniTabBounds({ saved, displays: [primary, second], primaryId: 1 }), saved);
  // The second monitor was unplugged: open on the primary instead of off-screen.
  const fallback = resolveMiniTabBounds({ saved, displays: [primary], primaryId: 1 });
  assert.ok(isReachable(fallback, [primary]));
  assert.ok(fallback.x + fallback.width <= 2560);
  assert.equal(isReachable({ x: 2550, y: 0, width: 300, height: 400 }, [{ id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 } }]), false, 'a sliver on screen is not enough');
});

test('saved bounds round-trip and junk is ignored', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prg-mini-')), 'mini-tab.json');
  assert.equal(loadSavedBounds(fs, file), null);
  saveBounds(fs, file, { x: 10.4, y: 20, width: 100, height: 50 });
  assert.deepEqual(loadSavedBounds(fs, file), { x: 10, y: 20, width: 270, height: MIN_HEIGHT });
  fs.writeFileSync(file, '{"x":"left"}');
  assert.equal(loadSavedBounds(fs, file), null);
});

test('Steam guard only hides the unowned SDL_app window titled "Steam"', () => {
  assert.match(STEAM_GUARD_SCRIPT, /GetWindow\(h, 4\) != IntPtr\.Zero\) return true/, 'owned dialogs are skipped');
  assert.match(STEAM_GUARD_SCRIPT, /c\.ToString\(\) == "SDL_app" && t\.ToString\(\) == "Steam"/);
  assert.match(STEAM_GUARD_SCRIPT, /Get-Process steamwebhelper/);
  assert.doesNotMatch(STEAM_GUARD_SCRIPT, /MainWindowHandle/, 'no longer hides whatever window a process calls main');
});

test('Steam guard runs one watcher and restarts it only to cover a longer period', () => {
  let time = 0;
  const spawned = [];
  const killed = [];
  const guard = createSteamWindowGuard({
    now: () => time,
    spawnGuard: ms => { const child = { ms, kill: () => killed.push(ms), on() {} }; spawned.push(child); return child; },
  });
  assert.equal(guard.guard(60000), true);
  time = 10000;
  assert.equal(guard.guard(20000), false, 'already covered until 60 s');
  time = 50000;
  assert.equal(guard.guard(30000), true, 'reaches past the current period');
  assert.deepEqual(spawned.map(child => child.ms), [60000, 30000]);
  assert.deepEqual(killed, [60000]);
  guard.stop();
  assert.equal(guard.active(), false);
});

test('main process wires the mini-tab, launch requests and the Steam guard', () => {
  assert.match(main, /const MINI_BAR_CHANNELS = new Set\(\['mini:restore', 'mini:launch'\]\)/);
  assert.doesNotMatch(main, /mini:togglePin|miniBarStandby|transitionToMainWindow|steam-startup-window/);
  assert.match(main, /createTray\(\)\n {2}createMiniBar\(\)/, 'the mini-tab opens at start-up');
  assert.match(main, /miniBar\.on\('close', event => \{ if \(!isQuitting\) event\.preventDefault\(\) \}\)/);
  for (const hook of ['hideSteamWindow(STEAM_GUARD_MS.launch)', 'hideSteamWindow(STEAM_GUARD_MS.exit)', 'hideSteamWindow(STEAM_GUARD_MS.startup)']) {
    assert.ok(main.includes(hook), hook);
  }

  const start = main.indexOf("handleFromMain('mini:launch'");
  const body = main.slice(start, main.indexOf('\n})', start) + 3);
  const sent = [];
  let handler;
  vm.runInNewContext(body, {
    handleFromMain: (_name, fn) => { handler = fn; },
    mainWindow: { isDestroyed: () => false, webContents: { send: (channel, id) => sent.push([channel, id]) } },
    String,
  });
  assert.equal(handler({}, 'g42'), true);
  for (const bad of ['', '../x', 'a b', 'x'.repeat(200), null]) assert.equal(handler({}, bad), false, String(bad));
  assert.deepEqual(sent, [['mini:launch', 'g42']]);
});

test('renderer lists installed Steam games by last played and launches only known ones', () => {
  const pick = name => {
    const start = html.indexOf(`function ${name}(`);
    return html.slice(start, html.indexOf('\n}', start) + 2);
  };
  const launched = [];
  const context = {
    games: [
      { id: 'a', title: 'Alpha', steamAppId: 1, lastPlayed: 100 },
      { id: 'b', title: 'Beta', steamAppId: 2, lastPlayed: 300 },
      { id: 'c', title: 'Gamma', steamAppId: 3, lastPlayed: 200 },
      { id: 'n', title: 'Switch game', nintendoTitleId: 'x', lastPlayed: 999 },
      { id: 'd', title: 'Delta', steamAppId: 4 },
    ],
    steamStatusCache: new Map([['1', { state: 'ready' }], ['2', { state: 'ready' }], ['3', { state: 'waiting' }], ['4', { state: 'ready' }]]),
    activeGameId: null,
    guestBlock: () => false,
    launchAndTrack: id => launched.push(id),
    String,
  };
  vm.runInNewContext(`${pick('miniTabGames')}\n${pick('launchFromMiniTab')}\nfunction getGame(id){return games.find(g=>g.id===id)}\nthis.miniTabGames=miniTabGames;this.launchFromMiniTab=launchFromMiniTab`, context);
  assert.deepEqual(context.miniTabGames().map(game => game.id), ['b', 'a', 'd']);
  context.launchFromMiniTab('a');
  context.launchFromMiniTab('n');
  context.launchFromMiniTab('missing');
  assert.deepEqual(launched, ['a']);
});
