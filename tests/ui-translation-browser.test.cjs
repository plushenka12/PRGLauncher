const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const executablePath = process.env.PRG_TEST_BROWSER;

// Product, platform and format names stay as they are in both languages.
const ALLOWED = /^(Steam|Steam App ID|HLTB|HowLongToBeat|PRG|PRGLauncher|Launcher|PRG Account|PRG RECAP · \d{4}|Nintendo|Nintendo Sync|Nintendo Switch|Switch|Switch \/ Switch 2|RAWG|Backloggd|Google|Email|QuickPlay|PC|Beta|BETA|Markdown|PNG|3DS|PS3|PS4|PS5|Xbox|URL|https:\/\/\S+|npf\.\.\.:\/\/auth#\.\.\.|[A-Z]{2}|(🖥️|🎮|🕹️|📱|💻|🎯|❓) .+|Hades II|Demo)$/u;

test('the Ukrainian UI shows no leftover English labels', { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(() => localStorage.setItem('gv-language', 'uk'));
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href);
    await page.waitForFunction(() => typeof renderGrid === 'function');
    const english = async () => page.evaluate(() => {
      const found = new Set();
      const visible = el => { const style = getComputedStyle(el); const box = el.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0; };
      const latinOnly = text => text && !/[А-Яа-яІіЇїЄєҐґ]/.test(text) && /[A-Za-z]{2,}/.test(text);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
        const el = walker.currentNode.parentElement;
        if (latinOnly(text) && el && !['SCRIPT', 'STYLE'].includes(el.tagName) && visible(el)) found.add(text);
      }
      document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el => {
        if (!visible(el)) return;
        for (const name of ['placeholder', 'aria-label', 'title']) { const value = (el.getAttribute(name) || '').trim(); if (latinOnly(value)) found.add(value); }
      });
      return [...found];
    });
    await page.evaluate(() => {
      document.getElementById('login-overlay').style.display = 'none';
      const now = Date.now();
      games = [{ id: 'g1', title: 'Hades II', status: 'Playing', platform: 'PC', steamAppId: 1145350, playtime: 7.2e6, lastPlayed: now, sessions: [{ start: now - 7.2e6, end: now, dur: 7.2e6, source: 'steam' }] }];
      renderGrid(); updateStats();
    });
    const leftovers = new Set(await english());
    await page.evaluate(() => openDetail('g1'));
    (await english()).forEach(text => leftovers.add(text));
    await page.evaluate(() => { closeDetail(); openAddModal(); });
    (await english()).forEach(text => leftovers.add(text));
    const unexpected = [...leftovers].filter(text => !ALLOWED.test(text));
    assert.deepEqual(unexpected, []);
  } finally {
    await browser.close();
  }
});
