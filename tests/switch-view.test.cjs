const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { sanitizeSwitchConfig, isConfigured, pickSwitchDisplay, allowPermission, QUALITIES } = require('../src/main/switch-view.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const main = fs.readFileSync('src/main/index.js', 'utf8');
const executablePath = process.env.PRG_TEST_BROWSER;

test('Switch settings are sanitized and default to 1080p60 with the card sound', () => {
  assert.deepEqual(sanitizeSwitchConfig(null), { videoId: '', videoLabel: '', audioId: 'auto', audioLabel: '', displayId: null, quality: '1080p60' });
  const clean = sanitizeSwitchConfig({ videoId: 'abc', videoLabel: 'Elgato HD60 X', audioId: 'none', displayId: '42', quality: '4k120', extra: 'x' });
  assert.deepEqual(clean, { videoId: 'abc', videoLabel: 'Elgato HD60 X', audioId: 'none', audioLabel: '', displayId: 42, quality: '1080p60' });
  assert.equal(sanitizeSwitchConfig({ videoLabel: 'x'.repeat(300) }).videoLabel, '', 'oversized values are dropped');
  assert.equal(isConfigured(clean), true);
  assert.equal(isConfigured(sanitizeSwitchConfig({})), false);
  assert.deepEqual(Object.keys(QUALITIES), ['1080p60', '720p60', '1080p30']);
});

test('the Switch window opens on the chosen monitor, else the second, else the main one', () => {
  const displays = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(pickSwitchDisplay(displays, 1, 3).id, 3);
  assert.equal(pickSwitchDisplay(displays, 1, 99).id, 2, 'an unplugged monitor falls back to the second one');
  assert.equal(pickSwitchDisplay([{ id: 1 }], 1, null).id, 1);
});

test('permissions are denied unless our own local pages need them', () => {
  const file = 'file:///C:/PRGLauncher/src/renderer/index.html';
  assert.equal(allowPermission({ permission: 'media', url: file, role: 'main' }), true, 'settings list capture devices');
  assert.equal(allowPermission({ permission: 'media', url: file, role: 'switch' }), true);
  assert.equal(allowPermission({ permission: 'media', url: file, role: 'mini' }), false);
  assert.equal(allowPermission({ permission: 'media', url: 'https://evil.example/', role: 'main' }), false);
  assert.equal(allowPermission({ permission: 'media', url: file, role: null }), false, 'popups and other windows get nothing');
  assert.equal(allowPermission({ permission: 'clipboard-sanitized-write', url: file, role: 'main' }), true);
  for (const permission of ['geolocation', 'notifications', 'display-capture', 'openExternal', 'hid', 'serial']) {
    assert.equal(allowPermission({ permission, url: file, role: 'main' }), false, permission);
  }
});

test('main process wires the Switch window without giving it the launcher bridge', () => {
  const open = main.slice(main.indexOf('function openSwitchWindow()'), main.indexOf("handleFromMain('switch:open'"));
  assert.match(open, /webPreferences: \{ contextIsolation: true, nodeIntegration: false, sandbox: true \}/);
  assert.doesNotMatch(open, /preload/, 'the Switch page has no IPC bridge');
  assert.match(open, /input\.key === 'Escape'/);
  assert.match(open, /attachNavigationGuard\(switchWindow\.webContents, file\)/);
  assert.match(open, /miniBar\.hide\(\)/, 'the mini-tab steps off the Switch picture');
  assert.match(main, /session\.defaultSession\.setPermissionRequestHandler\(/);
  assert.match(main, /session\.defaultSession\.setPermissionCheckHandler\(/);
  for (const channel of ['switch:open', 'switch:getConfig', 'switch:saveConfig']) assert.match(main, new RegExp(`handleFromMain\\('${channel}'`));
  const renderer = rendererSource();
  assert.match(renderer, /id="switch-video"/);
  assert.match(renderer, /function loadSwitchSettings\(probe=false\)/);
  assert.match(fs.readFileSync('src/renderer/mini-bar.js', 'utf8'), /\$\('switch'\)\.onclick = \(\) => window\.launcher\?\.openSwitchView\?\.\(\)/);
});

async function openSwitchPage(query) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  await page.goto(`${pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'switch-view.html')).href}?${new URLSearchParams(query)}`);
  return { browser, page, errors };
}

test('the Switch page plays the chosen capture device full screen', { skip: !executablePath }, async () => {
  const { browser, page, errors } = await openSwitchPage({ video: 'stale-id', videoLabel: 'fake_device_0', audio: 'none', quality: '720p60', lang: 'uk' });
  try {
    await page.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 15000 });
    const state = await page.evaluate(() => ({ width: document.getElementById('video').videoWidth, hud: document.getElementById('hud').textContent, muted: document.getElementById('video').muted }));
    assert.ok(state.width >= 640, 'video frames arrive');
    assert.match(state.hud, /fake_device_0/, 'found by label when the saved id changed');
    assert.match(state.hud, /без звуку/);
    assert.equal(state.muted, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('the Switch page explains a missing capture card', { skip: !executablePath }, async () => {
  const { browser, page, errors } = await openSwitchPage({ video: 'gone', videoLabel: 'Elgato HD60 X', lang: 'en' });
  try {
    await page.waitForFunction(() => document.getElementById('hud').classList.contains('error'), null, { timeout: 15000 });
    assert.match(await page.textContent('#hud'), /Capture card not found/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
