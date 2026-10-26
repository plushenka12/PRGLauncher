const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/couch-mode.js', 'utf8'), context);
const { couchLists, move, createPadReader } = context.window.PRGCouch;
const ids = list => list.map(game => game.id).join(',');
const executablePath = process.env.PRG_TEST_BROWSER;

const games = [
  { id: 'a', title: 'Zelda', status: 'Playing', lastPlayed: 30 },
  { id: 'b', title: 'Astro Bot', status: 'Backlog', lastPlayed: 0 },
  { id: 'c', title: 'Celeste', status: 'Backlog', steamAppId: 504230, lastPlayed: 10 },
  { id: 'd', title: 'Dota', status: 'QuickPlay', lastPlayed: 50 },
  { id: 'e', title: '  ', status: 'Playing', lastPlayed: 99 },
];

test('each tab lists the right games in a useful order', () => {
  const lists = couchLists(games);
  assert.equal(ids(lists.recent), 'd,a,c', 'played games, newest first');
  assert.equal(ids(lists.playing), 'a');
  assert.equal(ids(lists.backlog), 'c,b', 'games that can start first');
  assert.equal(ids(lists.all), 'b,c,a', 'A–Z without QuickPlay or untitled cards');
});

test('moving stops at the row ends and tabs wrap around', () => {
  const lists = couchLists(games);
  let state = { tab: 'recent', index: 0 };
  state = move(state, 'left', lists);
  assert.equal(state.index, 0);
  for (let i = 0; i < 5; i += 1) state = move(state, 'right', lists);
  assert.equal(state.index, 2);
  assert.deepEqual({ ...move(state, 'tab-next', lists) }, { tab: 'playing', index: 0 });
  assert.equal(move({ tab: 'recent', index: 1 }, 'tab-prev', lists).tab, 'all');
  assert.equal(move({ tab: 'all', index: 0 }, 'last', lists).index, 2);
});

test('the gamepad fires a press once and repeats a held direction', () => {
  const read = createPadReader({ delay: 300, rate: 100 });
  const pad = (pressed = [], x = 0) => ({ buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0 })), axes: [x, 0] });
  assert.deepEqual([...read(pad([0]), 0)], ['launch']);
  assert.deepEqual([...read(pad([0]), 50)], [], 'held A does not launch again');
  assert.deepEqual([...read(pad(), 60)], []);
  assert.deepEqual([...read(pad([], 0.9), 100)], ['right'], 'the stick moves');
  assert.deepEqual([...read(pad([], 0.9), 300)], [], 'not before the repeat delay');
  assert.deepEqual([...read(pad([], 0.9), 400)], ['right']);
  assert.deepEqual([...read(pad([], 0.9), 450)], []);
  assert.deepEqual([...read(pad([], 0.9), 510)], ['right']);
  assert.deepEqual([...read(pad([1, 5]), 600)], ['exit', 'tab-next']);
  assert.deepEqual([...read(null, 700)], []);
});

test('gamepad mode is wired to the header button and the main window', () => {
  const renderer = rendererSource();
  assert.match(renderer, /<script src="\.\/couch-mode\.js"><\/script>/);
  assert.match(renderer, /id="couch-btn"/);
  assert.match(renderer, /launch:id=>\{if\(!guestBlock\(\)\)launchAndTrack\(id\);\}/, 'launches go through the normal checks');
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  assert.match(main, /handleFromMain\('couch:setFullscreen'/);
  const source = fs.readFileSync('src/renderer/couch-mode.js', 'utf8');
  assert.match(source, /if \(root\) frame = requestAnimationFrame\(poll\)/, 'the pad is read only while the mode is open');
  assert.doesNotMatch(source, /innerHTML/, 'titles are set as text');
});

test('gamepad mode opens, moves with the keys and closes in both languages', { skip: !executablePath }, async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const lang of ['uk', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https?:/, route => route.abort());
      await page.addInitScript(value => localStorage.setItem('gv-language', value), lang);
      await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
      await page.waitForFunction(() => typeof renderGrid === 'function');
    // Signed-out start-up clears the library once Firebase answers; demo games
    // go in after that (the login screen shows then).
    await page.waitForFunction(() => document.getElementById('login-overlay')?.style.display === 'flex', null, { timeout: 15000 });
      await page.evaluate(() => {
        document.getElementById('login-overlay').style.display = 'none';
        games = [{ id: 'g1', title: 'Hades II', status: 'Playing', platform: 'PC', steamAppId: 1145350, playtime: 7.2e6, lastPlayed: Date.now(), hltb: { mainStoryMinutes: 1200 }, sessions: [] }, { id: 'g2', title: 'Celeste', status: 'Backlog', platform: 'PC', playtime: 0, lastPlayed: Date.now() - 1e6, sessions: [] }];
        renderGrid();
        document.getElementById('couch-btn').click();
      });
      // Waits for the state instead of reading it at once: under a loaded CI
      // runner the page can lag a frame behind the key presses.
      const shows = (selector, pattern) => page.waitForFunction(([css, source]) => new RegExp(source).test(document.querySelector(css)?.textContent || ''), [selector, pattern.source], { timeout: 10000 });
      await shows('.couch-title', /^Hades II$/);
      await page.keyboard.press('ArrowRight');
      await shows('.couch-title', /^Celeste$/);
      await shows('.couch-hero', lang === 'en' ? /No launcher for this game/ : /Запуску немає/);
      await shows('.couch-hints', lang === 'en' ? /Play.*Exit/ : /Грати.*Вийти/);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.couch', { state: 'detached', timeout: 10000 });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('X opens the Switch window and Y the details panel, where a status can be set', { skip: !executablePath }, async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(() => { localStorage.setItem('gv-language', 'uk'); window.__switchOpened = 0; });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
    await page.waitForFunction(() => typeof renderGrid === 'function');
    // Signed-out start-up clears the library once Firebase answers; demo games
    // go in after that (the login screen shows then).
    await page.waitForFunction(() => document.getElementById('login-overlay')?.style.display === 'flex', null, { timeout: 15000 });
    await page.evaluate(() => {
      document.getElementById('login-overlay').style.display = 'none';
      window.launcher = { ...(window.launcher || {}), openSwitchView: async () => { window.__switchOpened += 1; return { ok: true }; } };
      games = [{ id: 'g1', title: 'Hades II', status: 'Playing', platform: 'PC', steamAppId: 1145350, playtime: 7.2e6, lastPlayed: Date.now(), hltb: { mainStoryMinutes: 1200, completionistMinutes: 3000 }, sessions: [{ start: Date.now() - 7.2e6, end: Date.now(), dur: 7.2e6, source: 'steam' }], companions: [{ id: 'c1', name: 'Path of Building', path: 'C:/x.exe' }] }];
      renderGrid();
      document.getElementById('couch-btn').click();
    });
    await page.keyboard.press('x');
    assert.equal(await page.evaluate(() => window.__switchOpened), 1);
    await page.keyboard.press('y');
    await page.waitForSelector('.couch-panel:not([hidden])');
    const panel = await page.textContent('.couch-panel');
    assert.match(panel, /Hades II.*Статус.*Беклог.*Граю.*Твій час.*2\.0 год.*Основний сюжет.*20\.0 год.*На 100%.*50\.0 год.*Останні сесії.*Path of Building/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => games[0].status), 'Completed');
    assert.equal(await page.isHidden('.couch-panel'), true, 'closes after a change');
    assert.match(await page.textContent('.couch-hints'), /Деталі.*Switch/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
