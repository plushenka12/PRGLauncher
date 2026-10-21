const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

// A browser is an optional local UI smoke check, not a dependency of npm test.
const executablePath = process.env.PRG_TEST_BROWSER;
const rendererPath = path.join(__dirname, '..', 'src', 'renderer');

test('portrait game detail scrolls below the cover with the wheel over the cover', { skip: !executablePath }, async () => {
  const styles = fs.readFileSync(path.join(rendererPath, 'styles.css'), 'utf8');
  assert.ok(styles, 'renderer styles must exist');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const viewport of [{ width: 900, height: 600 }, { width: 1280, height: 800 }]) {
      for (const zoom of [0.9, 1, 1.2]) {
        const page = await browser.newPage({ viewport });
        await page.setContent(`<style>${styles}</style><div class="modal-overlay" id="detail-modal">
        <div class="detail-modal-inner">
          <div class="detail-cover-banner"><img alt="Portrait cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='900'%3E%3Crect width='600' height='900' fill='%237b2fff'/%3E%3C/svg%3E"></div>
          <div class="detail-body"><div style="height:1200px">Game information</div></div>
        </div></div>`);
        await page.addScriptTag({ path: path.join(rendererPath, 'ui-game-detail.js') });
        await page.evaluate(scale => {
          document.documentElement.style.zoom = String(scale);
          const detail = window.createGameDetailUi();
          const overlay = document.getElementById('detail-modal');
          overlay.addEventListener('wheel', event => detail.scrollWheel(event, overlay), { passive: false });
        }, zoom);
        const body = page.locator('.detail-body');
        assert.equal(await body.evaluate(element => element.scrollTop), 0);
        await page.locator('.detail-cover-banner').hover();
        await page.mouse.wheel(0, 500);
        await page.waitForFunction(() => document.querySelector('.detail-body').scrollTop > 0);
        assert.ok(await body.evaluate(element => element.scrollTop) > 0, `wheel should scroll detail body at ${viewport.width}x${viewport.height}, zoom ${zoom}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
