const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { resolveMiniTabBounds, loadSavedBounds, saveBounds, isReachable, MINI_TAB_SIZE } = require('../src/main/mini-tab-bounds.js');
const { createSteamLibraryArt } = require('../src/main/steam-library-art.js');
const { STEAM_GUARD_SCRIPT, createSteamWindowGuard } = require('../src/main/steam-window-guard.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const main = fs.readFileSync('src/main/index.js', 'utf8');
const html = rendererSource();

const primary = { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
const second = { id: 2, workArea: { x: 2560, y: 0, width: 1920, height: 1040 } };

test('mini-tab has one fixed size and opens in the top-right of the second monitor', () => {
  const bounds = resolveMiniTabBounds({ saved: null, displays: [primary, second], primaryId: 1 });
  assert.deepEqual({ width: bounds.width, height: bounds.height }, MINI_TAB_SIZE);
  assert.equal(bounds.x + bounds.width, 2560 + 1920 - 16);
  assert.equal(bounds.y, 16);
});

test('mini-tab falls back to the only monitor and shrinks only on a tiny screen', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 500 } };
  const bounds = resolveMiniTabBounds({ saved: null, displays: [small], primaryId: 1 });
  assert.ok(bounds.x > 0 && bounds.x + bounds.width <= 1280);
  assert.equal(bounds.height, 500 - 32);
});

test('a remembered position is reused, kept inside its monitor, and dropped if the monitor is gone', () => {
  const kept = resolveMiniTabBounds({ saved: { x: 3000, y: 300, width: 200, height: 900 }, displays: [primary, second], primaryId: 1 });
  assert.deepEqual(kept, { x: 3000, y: 300, ...MINI_TAB_SIZE }, 'old saved sizes are ignored');
  // Saved for a narrower window at the right edge: pulled back so it does not straddle monitors.
  const edge = resolveMiniTabBounds({ saved: { x: 2560 + 1920 - 286, y: 1000 }, displays: [primary, second], primaryId: 1 });
  assert.equal(edge.x + edge.width, 2560 + 1920);
  assert.equal(edge.y + edge.height, 1040);
  const fallback = resolveMiniTabBounds({ saved: { x: 3000, y: 300 }, displays: [primary], primaryId: 1 });
  assert.ok(isReachable(fallback, [primary]));
  assert.ok(fallback.x + fallback.width <= 2560);
  assert.equal(isReachable({ x: 2550, y: 0, width: 300, height: 400 }, [primary]), false, 'a sliver on screen is not enough');
});

test('saved position round-trips and junk is ignored', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prg-mini-')), 'mini-tab.json');
  assert.equal(loadSavedBounds(fs, file), null);
  saveBounds(fs, file, { x: 10.4, y: 20, width: 100, height: 50 });
  assert.deepEqual(loadSavedBounds(fs, file), { x: 10, y: 20 });
  fs.writeFileSync(file, '{"x":"left"}');
  assert.equal(loadSavedBounds(fs, file), null);
});

test('installed games use Steam\'s local library art, found in hashed folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-steam-art-'));
  const cache = path.join(root, 'appcache', 'librarycache');
  fs.mkdirSync(path.join(cache, '3265700', 'd2b2ab'), { recursive: true });
  fs.mkdirSync(path.join(cache, '3265700', 'baf02b'), { recursive: true });
  fs.writeFileSync(path.join(cache, '3265700', 'd2b2ab', 'library_capsule.jpg'), '');
  fs.writeFileSync(path.join(cache, '3265700', 'baf02b', 'library_hero.jpg'), '');
  fs.mkdirSync(path.join(cache, '570'), { recursive: true });
  fs.writeFileSync(path.join(cache, '570', 'library_600x900.jpg'), '');
  let steamPath = root;
  const art = createSteamLibraryArt({ fs, getSteamPath: () => steamPath });
  const found = art.find('3265700');
  assert.match(found.capsule, /^file:\/\/.*\/3265700\/d2b2ab\/library_capsule\.jpg$/);
  assert.match(found.hero, /library_hero\.jpg$/);
  assert.match(art.find(570).capsule, /570\/library_600x900\.jpg$/);
  assert.equal(art.find('../etc'), null);
  assert.equal(art.find('999'), null);
  const decorated = art.decorate({ active: false, games: [{ id: 'a', appId: '3265700' }, { id: 'b', appId: '999' }] });
  assert.ok(decorated.games[0].art.capsule);
  assert.equal(decorated.games[1].art, undefined);
  steamPath = null;
  assert.equal(art.find('570'), null, 'no Steam, no art');
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
  assert.match(main, /const MINI_BAR_CHANNELS = new Set\(\['mini:restore', 'mini:launch', 'switch:open'\]\)/);
  assert.doesNotMatch(main, /mini:togglePin|miniBarStandby|transitionToMainWindow|steam-startup-window/);
  assert.match(main, /createTray\(\)\r?\n {2}createMiniBar\(\)/, 'the mini-tab opens at start-up');
  assert.match(main, /miniBar\.on\('close', event => \{ if \(!isQuitting\) event\.preventDefault\(\) \}\)/);
  assert.match(main, /resizable: false,/, 'the mini-tab has a fixed size');
  assert.doesNotMatch(main, /miniBar\.on\('resized'/);
  assert.match(main, /lastMiniState = steamLibraryArt\.decorate\(state\)/);
  assert.match(html, /detailId!==game\.id\)return;/, 'background HLTB lookups do not draw into another card');
  assert.match(html, /queueMiniTabHltb\(\[state\.gameId,\.\.\.state\.games\.map\(game=>game\.id\)\]\)/);
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
  vm.runInNewContext(`${pick('miniTabGames')}\n${pick('miniTabHltb')}\n${pick('launchFromMiniTab')}\nfunction getGame(id){return games.find(g=>g.id===id)}\nthis.miniTabGames=miniTabGames;this.launchFromMiniTab=launchFromMiniTab;this.miniTabHltb=miniTabHltb`, context);
  assert.deepEqual(context.miniTabGames().map(game => game.id), ['b', 'a', 'd']);
  context.launchFromMiniTab('a');
  context.launchFromMiniTab('n');
  context.launchFromMiniTab('missing');
  assert.deepEqual(launched, ['a']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.miniTabHltb({ mainStoryMinutes: 1500, mainExtraMinutes: 2400, completionistMinutes: 0 }))), { main: 1500, extra: 2400, full: null });
  assert.equal(context.miniTabHltb({ mainStoryMinutes: 1500, hidden: true }), null, 'hidden HLTB stays hidden');
  assert.equal(context.miniTabHltb({ error: 'not found' }), null);
  assert.equal(context.miniTabHltb(undefined), null);
});

test('Wrapped is prepared once, on the first launch of the day only', () => {
  const pick = name => { const start = html.indexOf(`function ${name}(`); return html.slice(start, html.indexOf('\n}', start) + 2); };
  const make = ({ storedDay = null, launchDay = '2026-10-25', today = '2026-10-25', user = { uid: 'me' }, gameList = [{ id: 'a' }] } = {}) => {
    const values = new Map(storedDay ? [['me:gv-wrapped-day', storedDay]] : []);
    const built = [];
    const context = {
      currentUser: user, games: gameList, WRAPPED_LAUNCH_DAY: launchDay, pendingWrapped: null, wrappedChecked: false,
      localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
      profileStorageKey: name => `me:${name}`,
      localDayKey: () => today,
      window: { createRecapUtils: () => ({ buildWeeklyWrapped: input => { built.push(input); return { id: today }; } }) },
      setTimeout: () => 0, updateMiniBar: () => {}, Date,
    };
    vm.runInNewContext(`${pick('checkDailyWrapped')}\nthis.check = checkDailyWrapped`, context);
    return { context, built, values };
  };
  const first = make();
  first.context.check();
  first.context.check();
  assert.equal(first.built.length, 1, 'built once per launch');
  assert.equal(first.values.get('me:gv-wrapped-day'), '2026-10-25');
  assert.deepEqual({ ...first.context.pendingWrapped }, { id: '2026-10-25' });

  const again = make({ storedDay: '2026-10-25' });
  again.context.check();
  assert.equal(again.built.length, 0, 'already shown today');

  const overnight = make({ launchDay: '2026-10-24', today: '2026-10-25' });
  overnight.context.check();
  assert.equal(overnight.built.length, 0, 'a launcher left running overnight does not replay it');

  const signedOut = make({ user: null });
  signedOut.context.check();
  assert.equal(signedOut.built.length, 0);
  assert.equal(signedOut.context.wrappedChecked, false, 'checked again once the library is ready');
});
