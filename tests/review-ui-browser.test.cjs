const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const executablePath = process.env.PRG_TEST_BROWSER;
test('review tab fits the game dialog at 90–120% scale and previews safe Markdown', { skip: !executablePath }, async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const dialog = html.split('<div class="modal-overlay hidden" id="detail-modal">')[1]?.split('<!-- TIME EDITOR MODAL -->')[0];
  assert.ok(styles && dialog);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [390, 900, 1280]) for (const scale of [0.9, 1, 1.2]) {
      const page = await browser.newPage({ viewport: { width, height: 720 } });
      await page.setContent(`<style>${styles}</style><div class="modal-overlay" id="detail-modal">${dialog}`);
      await page.addScriptTag({ path: path.join(__dirname, '..', 'web-dashboard', 'review-markdown.js') });
      await page.evaluate(zoom => {
        document.documentElement.style.zoom = String(zoom);
        document.getElementById('d-overview-pane').classList.add('hidden');
        document.getElementById('d-history-pane').classList.add('hidden');
        document.getElementById('d-review-pane').classList.remove('hidden');
        document.getElementById('detail-tab-overview').classList.remove('active');
        document.getElementById('detail-tab-review').classList.add('active');
        document.getElementById('d-title').textContent = 'The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition';
        document.getElementById('d-review-preview').innerHTML = PRGReviewMarkdown.render('### Враження\n\n**Чудова** гра з довгою назвою.');
      }, scale);
      assert.equal(await page.locator('#d-review-preview strong').textContent(), 'Чудова');
      const result = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        dialogOverflow: document.querySelector('.detail-modal-inner').scrollWidth > document.querySelector('.detail-modal-inner').clientWidth + 1,
        bodyScrollable: document.querySelector('.detail-body').scrollHeight > document.querySelector('.detail-body').clientHeight
      }));
      assert.equal(result.documentOverflow, false, `page overflow at ${width}px × ${scale}`);
      assert.equal(result.dialogOverflow, false, `dialog overflow at ${width}px × ${scale}`);
      assert.equal(result.bodyScrollable, true, 'long review editor remains scrollable inside the dialog');
      if (process.env.PRG_REVIEW_SCREENSHOT_DIR && scale === 1 && [390, 1280].includes(width)) {
        fs.mkdirSync(process.env.PRG_REVIEW_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.PRG_REVIEW_SCREENSHOT_DIR, `review-${width}.png`) });
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

test('guest site shows only the published review as formatted, read-only text', { skip: !executablePath }, async () => {
  const siteHtml = fs.readFileSync(path.join(__dirname, '..', 'web-dashboard', 'index.html'), 'utf8');
  const siteCss = fs.readFileSync(path.join(__dirname, '..', 'web-dashboard', 'library.css'), 'utf8');
  const shell = `${siteHtml.split('<script src="./review-markdown.js"></script>')[0]}</body></html>`.replace('</head>', `<style>${siteCss}</style></head>`);
  const siteScript = siteHtml.split('<script type="module">')[1].split('</script>')[0].split('\n').filter(line => !line.trim().startsWith('import ')).join('\n');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const dashboard = {
        updatedAt: 1,
        publicLibraryEnabled: true,
        publicLibrary: [
          { gameId: 'demo', title: 'Demo Game', cover: null, platform: 'PC', status: 'Playing', rating: 8, playtime: 3600000, sessions: 1 },
          { gameId: 'long', title: 'The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition', cover: null, platform: 'Nintendo Switch', status: 'Completed', rating: 9, playtime: 194400000, sessions: 24 },
          { gameId: 'short', title: 'Far Cry 5', cover: null, platform: 'PC', status: 'Backlog', rating: null, playtime: 0, sessions: 0 },
          { gameId: 'quick', title: 'Vampire Survivors', cover: null, platform: 'PC', status: 'QuickPlay', rating: 7, playtime: 5400000, sessions: 12 }
        ],
        yearly: { 2026: { year: 2026, playtime: 3600000, sessions: 1, activeDays: 1, longestStreak: 1, monthly: Array(12).fill(0), games: [{ gameId: 'demo', title: 'Demo Game', cover: null, platform: 'PC', playtime: 3600000, sessions: 1, firstPlayedAt: 1, lastPlayedAt: 1 }] } },
        publicReviews: [{ gameId: 'demo', title: 'Demo Game', cover: null, rating: 8, markdown: '### Враження\n\n**Сильна** історія. <script>window.reviewXss=true</script>', updatedAt: 2 }],
        platforms: { PC: 1 }, status: { Playing: 1 }, recentSessions: []
      };
      await page.setContent(shell);
      await page.addScriptTag({ path: path.join(__dirname, '..', 'web-dashboard', 'review-markdown.js') });
      await page.addScriptTag({ path: path.join(__dirname, '..', 'web-dashboard', 'library.js') });
      await page.evaluate(data => {
        window.__PRG_TEST_DASHBOARD = data;
        window.initializeApp = () => ({});
        window.getFirestore = () => ({});
        window.doc = () => ({});
        window.onSnapshot = (_ref, apply) => apply({ exists: () => true, data: () => window.__PRG_TEST_DASHBOARD });
        window.getDoc = async () => ({ exists: () => true, data: () => window.__PRG_TEST_DASHBOARD });
      }, dashboard);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addScriptTag({ content: siteScript });
      if (await page.locator('#library-games [data-game="0"]').count() === 0) throw new Error(`Guest library did not render: ${errors.join('; ')}`);
      if (process.env.PRG_REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PRG_REVIEW_SCREENSHOT_DIR, `site-library-${width}.png`) });
      await page.locator('#library-search').fill('Zelda');
      assert.equal(await page.locator('#library-games .library-card').count(), 1);
      await page.locator('#library-search').fill('');
      if (width === 390) {
        await page.locator('#library-mobile-filters').click();
        await page.locator('#library-mobile-filter-list [data-status="Completed"]').click();
        assert.equal(await page.locator('#library-games .library-card').count(), 1);
        await page.locator('#library-mobile-filter-list [data-status="all"]').click();
      } else {
        await page.locator('#library-status-nav [data-status="Backlog"]').click();
        assert.equal(await page.locator('#library-games .library-card').count(), 1);
        await page.locator('#library-status-nav [data-status="all"]').click();
      }
      await page.locator('#library-games [data-game="0"]').click();
      await page.locator('#library-tab-review').click();
      assert.equal(await page.locator('#library-detail-review strong').textContent(), 'Сильна');
      assert.equal(await page.evaluate(() => Boolean(window.reviewXss)), false);
      assert.equal(await page.locator('#library-detail-review script').count(), 0);
      if (process.env.PRG_REVIEW_SCREENSHOT_DIR) {
        await page.evaluate(() => {
          window.__PRG_TEST_DASHBOARD.publicReviews[0].markdown = '### Що зачепило\n\n**Сильна історія** і світ, до якого хотілося повертатися.\n\n- Виразні персонажі\n- Чудова музика\n\n> Один із моїх фаворитів року.';
          PRGLibrary.render(window.__PRG_TEST_DASHBOARD); document.querySelector('#library-games [data-game="0"]').click(); document.querySelector('#library-tab-review').click();
        });
        await page.screenshot({ path: path.join(process.env.PRG_REVIEW_SCREENSHOT_DIR, `site-review-${width}.png`) });
      }
      const overflow = await page.evaluate(() => ({ exceeds: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, offenders: [...document.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(node => `${node.tagName}.${node.className}`) }));
      assert.equal(overflow.exceeds, false, `site overflow at ${width}px: ${overflow.offenders.join(', ')}`);
      assert.deepEqual(errors, []);
      await page.evaluate(() => { window.__PRG_TEST_DASHBOARD.yearly = {}; PRGLibrary.render(window.__PRG_TEST_DASHBOARD); });
      assert.equal(await page.locator('#library-tab-review').isVisible(), true, 'published reviews remain visible without any play sessions');
      await page.locator('#library-close').click();
      await page.evaluate(() => { window.__PRG_TEST_DASHBOARD.publicLibraryEnabled = false; PRGLibrary.render(window.__PRG_TEST_DASHBOARD); });
      assert.equal(await page.locator('#library-games .library-card').count(), 0, 'guest cards disappear when library publishing is disabled');
      await page.close();
    }
  } finally { await browser.close(); }
});

test('the original annual recap remains reachable from the guest library', { skip: !executablePath }, async () => {
  const siteHtml = fs.readFileSync(path.join(__dirname, '..', 'web-dashboard', 'index.html'), 'utf8');
  const shell = `${siteHtml.split('<script src="./review-markdown.js"></script>')[0]}</body></html>`;
  const siteScript = siteHtml.split('<script type="module">')[1].split('</script>')[0].split('\n').filter(line => !line.trim().startsWith('import ')).join('\n');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('https://prg.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://prg.example/?u=demo&view=recap');
    await page.addScriptTag({ path: path.join(__dirname, '..', 'web-dashboard', 'review-markdown.js') });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'web-dashboard', 'library.js') });
    await page.evaluate(() => {
      window.initializeApp = () => ({}); window.getFirestore = () => ({}); window.doc = () => ({});
      window.onSnapshot = (_ref, apply) => apply({ exists: () => true, data: () => ({
        updatedAt: 1, yearly: { 2026: { year: 2026, playtime: 3600000, sessions: 1, activeDays: 1, longestStreak: 1, monthly: Array(12).fill(0), games: [{ gameId: 'one', title: 'Demo Game', playtime: 3600000, sessions: 1 }] } },
        publicLibraryEnabled: true, publicLibrary: [{ gameId: 'one', title: 'Demo Game', status: 'Playing', playtime: 3600000, sessions: 1 }], publicReviews: [], platforms: { PC: 1 }, status: { Playing: 1 }, recentSessions: []
      }) });
      window.getDoc = async () => ({ exists: () => false });
    });
    await page.addScriptTag({ content: siteScript });
    assert.equal(await page.locator('#app').isVisible(), true);
    assert.equal(await page.locator('#library').isVisible(), false);
    assert.equal(await page.locator('#year-label').textContent(), '2026');
    assert.match(await page.locator('#recap-back-link').getAttribute('href'), /u=demo&view=library/);
  } finally { await browser.close(); }
});
