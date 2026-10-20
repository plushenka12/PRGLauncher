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
