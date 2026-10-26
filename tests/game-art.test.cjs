const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { pickAccent, rgbToHsl } = require('../src/renderer/accent-color.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const executablePath = process.env.PRG_TEST_BROWSER;
const pixels = colors => Uint8Array.from(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

test('the accent comes from the vivid part of the art and reads on dark UI', () => {
  const art = pixels([...Array(40).fill([20, 20, 24]), ...Array(10).fill([220, 30, 40]), ...Array(4).fill([240, 240, 240])]);
  const color = pickAccent(art);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const [h, s, l] = rgbToHsl(r, g, b);
  assert.ok(h < 0.03 || h > 0.97, `red hue (${color})`);
  assert.ok(s >= 0.5 && Math.abs(l - 0.6) < 0.02, 'saturated, fixed lightness');
  assert.equal(pickAccent(pixels(Array(50).fill([128, 128, 128]))), null, 'grey art keeps the theme accent');
  assert.equal(pickAccent(pixels(Array(50).fill([220, 30, 40, 0]))), null, 'transparent pixels are ignored');
  const bgra = Uint8Array.from(Array(20).fill([40, 30, 220, 255]).flat());
  assert.equal(pickAccent(bgra, { bgra: true }), pickAccent(pixels(Array(20).fill([220, 30, 40]))), 'Electron bitmaps are BGRA');
});

test('Steam art feeds the game page, the library and the gamepad mode', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  assert.match(main, /handleFromMain\('art:steam'/);
  assert.match(main, /result\[String\(id\)\] = \{ \.\.\.art, color: steamArtColor\(art\) \}/);
  const renderer = rendererSource();
  assert.match(renderer, /bannerImage:artFor\(game\)\?\.hero\|\|game\.cover/);
  assert.match(renderer, /const hero=!game\.cover&&artFor\(game\)\?\.hero;/, 'only cards without a cover take Steam art');
  assert.match(renderer, /img-src 'self' data: file: /);
  assert.match(fs.readFileSync('src/renderer/styles.css', 'utf8'), /#detail-modal\[style\*="--game-accent"\] \.detail-modal-inner\{--accent:var\(--game-accent\)/);
  assert.match(fs.readFileSync('src/renderer/ui-game-detail.js', 'utf8'), /bannerImage = game\.cover/);
});

test('a finished session of a minute or more is offered to the mini-tab once', () => {
  const renderer = rendererSource();
  assert.match(renderer, /if\(game&&elapsed>=60000\)\{const main=/);
  assert.match(renderer, /wrapped:pendingWrapped,session:lastSessionSummary,/);
  const mini = fs.readFileSync('src/renderer/mini-bar.js', 'utf8');
  assert.match(mini, /if \(next\.session && next\.session\.id !== seenSessionId\) \{/);
  assert.match(mini, /if \(Date\.now\(\) - next\.session\.at < 60000 && !wrapped\) showSessionDone\(next\.session\)/);
  assert.doesNotMatch(mini.slice(mini.indexOf('function showSessionDone'), mini.indexOf('window.launcher?.onMiniState')), /innerHTML/);
});

test('the mini-tab shows the session card in both languages', { skip: !executablePath }, async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const lang of ['uk', 'en']) {
      const page = await browser.newPage({ viewport: { width: 340, height: 560 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(language => {
        let listener = null;
        window.launcher = { onMiniState: callback => { listener = callback; }, onMiniQuiet: () => {} };
        window.__send = state => listener({ lang: language, signedIn: true, games: [], ...state });
      }, lang);
      await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'mini-bar.html')).href);
      const session = { id: 'g1:1', title: 'Hades II', dur: 8100000, total: 136800000, hltbPct: 63, at: Date.now() };
      await page.evaluate(value => window.__send({ session: value }), session);
      await page.waitForSelector('#session-done:not([hidden])');
      const text = await page.textContent('#session-done');
      assert.match(text, lang === 'en' ? /Session ended.*Hades II.*2 h 15 min.*38 h in total.*63% of HLTB/ : /Сесію завершено.*Hades II.*2 год 15 хв.*разом 38 год.*63% від HLTB/);
      await page.click('#session-done');
      await page.waitForSelector('#session-done', { state: 'hidden' });
      await page.evaluate(value => window.__send({ session: value }), session);
      assert.equal(await page.isHidden('#session-done'), true, 'the same session is not shown twice');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
