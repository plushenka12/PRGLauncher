const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const executablePath = process.env.PRG_TEST_BROWSER;

test('renderer loads its Firebase SDK and sign-in screen without network', { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const zoom of [0.9, 1, 1.2]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.route(/^https?:/, route => route.abort());
      await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
      await page.waitForFunction(() => Boolean(window._fbImports?.getAuth && window._fbImports?.runTransaction && window._fbImports?.getDocFromServer));
      await page.evaluate(scale => { document.documentElement.style.zoom = String(scale); }, zoom);
      const overlay = page.locator('#login-overlay');
      assert.equal(await overlay.isVisible(), true);
      const submit = page.locator('#auth-submit-btn');
      const box = await submit.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 600);
      await page.evaluate(() => {
        document.getElementById('login-overlay').classList.add('hidden');
        currentLanguage = 'uk';
        openSyncConflict([{ id: 'demo', title: 'Demo', sessions: [] }], 42);
      });
      const conflict = page.locator('#sync-conflict-modal .modal');
      assert.equal(await conflict.isVisible(), true);
      assert.match(await page.locator('#sync-conflict-copy').textContent(), /У хмарі/);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'sync-conflict-local');
      const conflictBox = await conflict.boundingBox();
      assert.ok(conflictBox && conflictBox.x >= 0 && conflictBox.y >= 0 && conflictBox.x + conflictBox.width <= 900 && conflictBox.y + conflictBox.height <= 600);
      await page.evaluate(() => { closeSyncConflict(); currentLanguage = 'en'; openSyncConflict([], 42); });
      assert.match(await page.locator('#sync-conflict-copy').textContent(), /Cloud:/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('keeping local data leaves the conflict visible until the upload succeeds', { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
    await page.waitForFunction(() => Boolean(window._fbImports?.getAuth && window._fbImports?.runTransaction));
    await page.evaluate(() => {
      document.getElementById('login-overlay').classList.add('hidden');
      currentLanguage = 'uk';
      currentUser = { uid: 'demo' };
      document.getElementById('login-overlay').style.display = 'none';
      pushToFb = () => new Promise(resolve => { window.resolveConflictUpload = resolve; });
      openSyncConflict([{ id: 'demo', title: 'Demo', sessions: [] }], 42);
    });
    await page.locator('#sync-conflict-local').click();
    assert.equal(await page.locator('#sync-conflict-modal').isVisible(), true);
    assert.equal(await page.locator('#sync-conflict-local').isDisabled(), true);
    await page.evaluate(() => window.resolveConflictUpload(true));
    await page.waitForFunction(() => document.getElementById('sync-conflict-modal').classList.contains('hidden'));
    await page.evaluate(() => {
      games = [];
      pushToFb = () => new Promise(resolve => { window.resolveConflictUpload = resolve; });
      openSyncConflict([{ id: 'demo', title: 'Demo', sessions: [] }], 43);
    });
    await page.locator('#sync-conflict-local').click();
    await page.evaluate(() => {
      games = [{ id: 'demo', title: 'Demo', sessions: [] }];
      window.resolveConflictUpload(false);
    });
    await page.waitForFunction(() => !document.getElementById('sync-conflict-local').disabled);
    assert.equal(await page.locator('#sync-conflict-modal').isVisible(), true);
    assert.equal(await page.locator('#sync-conflict-local').isEnabled(), true);
    assert.equal(await page.evaluate(() => games.length), 0);
    assert.match(await page.locator('#sync-conflict-copy').textContent(), /Не вдалося зберегти/);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a local conflict choice waits for an active write and then publishes once', { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
    await page.waitForFunction(() => Boolean(window._fbImports?.getAuth && window._fbImports?.runTransaction));
    await page.evaluate(() => {
      document.getElementById('login-overlay').style.display = 'none';
      currentUser = { uid: 'demo' };
      fbDb = {};
      syncActive = true;
      documentGeneration = 'demo-generation';
      documentOrderIds = ['cloud'];
      documentExpectedCount = 1;
      sessionExpectedCount = 0;
      games = [];
      const cloud = schema.migrateGames([{ id: 'cloud', title: 'Cloud', sessions: [], playtime: 0 }]);
      cloud[0]._syncSessionRevision = 0;
      readDocumentLibrary = async (_user, _ids, withCount = false) => withCount
        ? { games: [], count: 1, sessionCount: 0 } : cloud;
      window._fbImports.doc = () => 'demo-ref';
      window._fbImports.runTransaction = async () => {};
      window._fbImports.setDoc = async () => {};
      window.commitCalls = 0;
      sessionTools.commitChanges = async ({ localGames }) => {
        window.commitCalls++;
        window.uploadedGameCount = localGames.length;
      };
      publishStatsDashboard = async () => {};
      renderLocalLibrary = () => {};
      openSyncConflict(cloud, 42);
      syncState.beginWrite();
    });
    await page.locator('#sync-conflict-local').click();
    assert.equal(await page.locator('#sync-conflict-modal').isVisible(), true);
    assert.equal(await page.evaluate(() => window.commitCalls), 0);
    await page.evaluate(() => {
      games = schema.migrateGames([{ id: 'cloud', title: 'Cloud', sessions: [], playtime: 0 }]);
      syncState.endWrite();
    });
    await page.waitForFunction(() => document.getElementById('sync-conflict-modal').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.commitCalls), 1);
    assert.equal(await page.evaluate(() => window.uploadedGameCount), 0);
    assert.equal(await page.evaluate(() => hasPendingLibrarySync()), false);
    await page.close();
  } finally {
    await browser.close();
  }
});
