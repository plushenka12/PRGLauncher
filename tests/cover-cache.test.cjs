const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createCoverCache, isAllowedCoverUrl, fileNameFor, MAX_BYTES } = require('../src/main/cover-cache.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const executablePath = process.env.PRG_TEST_BROWSER;
const COVER = 'https://media.rawg.io/media/games/demo/one.jpg';
const OTHER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/header.jpg';

function makeCache(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-covers-'));
  const fetched = [];
  const cache = createCoverCache({
    dir, fs, path, toFileUrl: file => pathToFileURL(file).href,
    fetchImage: async url => { fetched.push(url); return { buffer: Buffer.from('full-size'), contentType: 'image/jpeg', finalUrl: url }; },
    shrink: async (buffer, width) => Buffer.from(`thumb-${width}`),
    ...overrides,
  });
  return { dir, cache, fetched };
}

test('only https covers from the hosts the renderer may show are fetched', () => {
  for (const good of [COVER, OTHER, 'https://images.igdb.com/igdb/image/upload/t_cover_big/demo.jpg', 'https://www.backloggd.com/demo.png']) assert.equal(isAllowedCoverUrl(good), true, good);
  for (const bad of ['http://media.rawg.io/a.jpg', 'https://evil.example/a.jpg', 'https://media.rawg.io.evil.example/a.jpg', 'https://user:pass@media.rawg.io/a.jpg', 'https://media.rawg.io:8443/a.jpg',
    'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'file:///C:/Windows/win.ini', 'not a url', '', null, `https://media.rawg.io/${'a'.repeat(2100)}`]) assert.equal(isAllowedCoverUrl(bad), false, String(bad).slice(0, 60));
});

test('a requested cover is shrunk once, kept on disk and listed after a restart', async () => {
  const { dir, cache, fetched } = makeCache();
  assert.deepEqual(cache.index(), {});
  assert.deepEqual(cache.request([COVER, COVER, 'https://evil.example/a.jpg', 42]), { queued: 1, removed: 0 });
  await cache.whenIdle();
  assert.deepEqual(fetched, [COVER]);
  const file = path.join(dir, fileNameFor(COVER));
  assert.equal(fs.readFileSync(file, 'utf8'), 'thumb-480');
  assert.deepEqual(cache.index(), { [COVER]: pathToFileURL(file).href });
  assert.deepEqual(cache.request([COVER]), { queued: 0, removed: 0 }, 'already cached');
  const restarted = makeCache();
  fs.cpSync(dir, restarted.dir, { recursive: true });
  assert.deepEqual(Object.keys(restarted.cache.index()), [COVER]);
  assert.deepEqual(restarted.fetched, []);
});

test('covers the library no longer uses are removed; an empty list removes nothing', async () => {
  const { dir, cache } = makeCache();
  cache.request([COVER, OTHER]);
  await cache.whenIdle();
  assert.deepEqual(cache.request([]), { queued: 0, removed: 0 });
  assert.equal(Object.keys(cache.index()).length, 2);
  assert.deepEqual(cache.request([OTHER]), { queued: 0, removed: 1 });
  assert.deepEqual(Object.keys(cache.index()), [OTHER]);
  assert.equal(fs.existsSync(path.join(dir, fileNameFor(COVER))), false);
});

test('a bad download leaves no file and is not retried in the same run', async () => {
  const cases = [
    { fetchImage: async url => ({ buffer: Buffer.from('<html>'), contentType: 'text/html', finalUrl: url }) },
    { fetchImage: async () => ({ buffer: Buffer.from('x'), contentType: 'image/jpeg', finalUrl: 'https://evil.example/a.jpg' }) },
    { fetchImage: async url => ({ buffer: Buffer.alloc(MAX_BYTES + 1), contentType: 'image/jpeg', finalUrl: url }) },
    { fetchImage: async () => { throw new Error('offline'); } },
    { shrink: async () => null },
  ];
  for (const overrides of cases) {
    let calls = 0;
    const wrapped = Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, (...args) => { calls++; return fn(...args); }]));
    const { dir, cache } = makeCache(wrapped);
    cache.request([COVER]);
    await cache.whenIdle();
    assert.deepEqual(cache.index(), {});
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.jpg')), []);
    assert.deepEqual(cache.request([COVER]), { queued: 0, removed: 0 });
    assert.equal(calls, 1);
  }
});

test('an index entry without its file, or pointing at another file, is ignored', () => {
  const { dir, cache } = makeCache();
  fs.writeFileSync(path.join(dir, 'secret.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ [COVER]: fileNameFor(COVER), [OTHER]: 'secret.jpg', 'https://evil.example/a.jpg': 'secret.jpg' }));
  assert.deepEqual(cache.index(), {});
  const broken = makeCache();
  fs.writeFileSync(path.join(broken.dir, 'index.json'), '{not json');
  assert.deepEqual(broken.cache.index(), {});
});

test('the cover cache is wired through guarded IPC and the library cards', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  for (const channel of ['covers:index', 'covers:request']) assert.match(main, new RegExp(`handleFromMain\\('${channel}'`));
  assert.match(main, /net\.fetch\(url, \{ credentials: 'omit'/);
  const preload = fs.readFileSync('src/preload/index.js', 'utf8');
  assert.match(preload, /getCoverThumbs: \(\) => ipcRenderer\.invoke\('covers:index'\)/);
  const renderer = rendererSource();
  assert.match(renderer, /img\.src=thumb\|\|game\.cover/);
  assert.match(renderer, /coverThumbs\.get\(game\.cover\)\|\|''\]\.join\(/, 'a card is rebuilt when its thumbnail appears');
  assert.match(renderer, /bannerImage:artFor\(game\)\?\.hero\|\|game\.cover/, 'the game page keeps the full-size cover');
});

test('a card shows the local thumbnail and falls back to the cover when it is broken', { skip: !executablePath }, async () => {
  const { chromium } = require('playwright-core');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-thumb-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(dir, 'good.png'), png);
  const good = pathToFileURL(path.join(dir, 'good.png')).href;
  const missing = pathToFileURL(path.join(dir, 'missing.png')).href;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(([first, second, goodFile, missingFile]) => {
      window.launcher = {
        getCoverThumbs: async () => ({ [first]: goodFile, [second]: missingFile, 'https://media.rawg.io/x.jpg': 'https://evil.example/x.jpg' }),
        requestCoverThumbs: async urls => { window.requestedCovers = urls; },
      };
    }, [COVER, OTHER, good, missing]);
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
    await page.waitForFunction(() => document.getElementById('login-overlay')?.style.display === 'flex', null, { timeout: 15000 });
    const result = await page.evaluate(async ([first, second]) => {
      document.getElementById('login-overlay').style.display = 'none';
      currentUser = { uid: 'demo' };
      games = schema.migrateGames([{ id: 'a', title: 'Alpha', cover: first }, { id: 'b', title: 'Beta', cover: second }, { id: 'c', title: 'Gamma' }]);
      renderGrid();
      requestCoverThumbs();
      // Whether and when the browser loads an image differs between machines,
      // so the load failures are raised here; everything runs in one task.
      const image = id => document.querySelector(`[data-id="${id}"] .card-cover img`);
      const href = value => Object.assign(document.createElement('a'), { href: value }).href;
      const out = { thumbsAtStart: coverThumbs.size, a: image('a')?.src === href(coverThumbs.get(first)), b: image('b')?.src === href(coverThumbs.get(second)), noCover: Boolean(image('c')) };
      const broken = image('b');
      broken.dispatchEvent(new Event('error'));
      out.afterFirstError = { src: broken.src === href(second), connected: broken.isConnected, thumbs: coverThumbs.size, forgotten: !coverThumbs.has(second) };
      broken.dispatchEvent(new Event('error'));
      out.afterSecondError = { image: Boolean(image('b')), fallback: Boolean(document.querySelector('[data-id="b"] .cover-fallback')) };
      out.requested = window.requestedCovers;
      return out;
    }, [COVER, OTHER]);
    assert.equal(result.thumbsAtStart, 2, 'entries that are not local files are refused');
    assert.equal(result.a, true, 'the card shows the thumbnail');
    assert.equal(result.b, true);
    assert.equal(result.noCover, false);
    assert.deepEqual(result.afterFirstError, { src: true, connected: true, thumbs: 1, forgotten: true }, 'a broken thumbnail falls back to the cover');
    assert.deepEqual(result.afterSecondError, { image: false, fallback: true }, 'a broken cover falls back to the placeholder');
    assert.deepEqual(result.requested, [COVER, OTHER]);
    await page.close();
  } finally {
    await browser.close();
  }
});
