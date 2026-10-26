const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { sanitizeSwitchConfig, isConfigured, pickSwitchDisplay, allowPermission, clipSavePath, QUALITIES } = require('../src/main/switch-view.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const main = fs.readFileSync('src/main/index.js', 'utf8');
const executablePath = process.env.PRG_TEST_BROWSER;

test('Switch settings are sanitized and default to 1080p60 with the card sound', () => {
  assert.deepEqual(sanitizeSwitchConfig(null), { videoId: '', videoLabel: '', audioId: 'auto', audioLabel: '', displayId: null, quality: '1080p60', replay: 0 });
  const clean = sanitizeSwitchConfig({ videoId: 'abc', videoLabel: 'Elgato HD60 X', audioId: 'none', displayId: '42', quality: '4k120', extra: 'x' });
  assert.deepEqual(clean, { videoId: 'abc', videoLabel: 'Elgato HD60 X', audioId: 'none', audioLabel: '', displayId: 42, quality: '1080p60', replay: 0 });
  assert.equal(sanitizeSwitchConfig({ replay: 60 }).replay, 60);
  assert.equal(sanitizeSwitchConfig({ replay: '30' }).replay, 30);
  assert.equal(sanitizeSwitchConfig({ replay: 600 }).replay, 0, 'only the offered lengths');
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

test('replay clips get our own name in the clip folder and never overwrite a file', () => {
  const folder = 'C:\\Users\\me\\Videos\\PRGLauncher Switch';
  const existing = new Set([path.win32.join(folder, 'PRG Switch 2026-10-26 21-30-05.mp4')]);
  const pick = filename => clipSavePath({ folder, filename, exists: file => existing.has(file), join: path.win32.join, now: new Date('2026-10-26T20:00:00Z') });
  assert.equal(pick('PRG Switch 2026-10-26 21-30-05.mp4'), path.win32.join(folder, 'PRG Switch 2026-10-26 21-30-05 (2).mp4'));
  assert.equal(pick('PRG Switch 2026-10-26 21-31-00.webm'), path.win32.join(folder, 'PRG Switch 2026-10-26 21-31-00.webm'));
  for (const bad of ['..\\..\\evil.exe', 'C:\\Windows\\x.mp4', 'clip.bat', '']) {
    assert.equal(pick(bad), path.win32.join(folder, 'PRG Switch 2026-10-26 20-00-00.mp4'), JSON.stringify(bad));
  }
});

test('main process saves only blob clips from the Switch window, without a dialog', () => {
  const handler = main.slice(main.indexOf("session.defaultSession.on('will-download'"), main.indexOf('\n  })', main.indexOf("session.defaultSession.on('will-download'")));
  assert.match(handler, /if \(!contents \|\| contents !== switchWindow\?\.webContents\) return/, 'other windows keep the default');
  assert.match(handler, /if \(!item\.getURL\(\)\.startsWith\('blob:file:\/\/'\)\) \{ event\.preventDefault\(\); return \}/);
  assert.match(handler, /app\.getPath\('videos'\), 'PRGLauncher Switch'/);
  assert.match(handler, /item\.setSavePath\(clipSavePath\(/);
  assert.match(main, /replay: String\(config\.replay\)/);
  const page = fs.readFileSync('src/renderer/switch-view.html', 'utf8');
  assert.ok(page.indexOf('switch-replay.js') < page.indexOf('switch-view.js'), 'the buffer loads before the page script');
  const renderer = rendererSource();
  assert.match(renderer, /id="switch-replay"/);
  assert.match(renderer, /replay:Number\(pick\('switch-replay'\)\.value\)/);
});

test('the replay buffer prefers H.264 and drops the audio codec without sound', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync('src/renderer/switch-replay.js', 'utf8'), context);
  const { pickType } = context.PRGSwitchReplay;
  const supported = new Set(['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus']);
  assert.deepEqual({ ...pickType(true, type => supported.has(type)) }, { type: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' });
  assert.deepEqual({ ...pickType(false, type => supported.has(type)) }, { type: 'video/mp4;codecs=avc1.640028', extension: 'mp4' });
  assert.deepEqual({ ...pickType(true, type => type === 'video/webm;codecs=vp9,opus') }, { type: 'video/webm;codecs=vp9,opus', extension: 'webm' });
  assert.equal(pickType(true, () => false), null);
});

test('the Switch page offers the replay buffer and a saved clip plays', { skip: !executablePath }, async () => {
  const { browser, page, errors } = await openSwitchPage({ video: 'stale-id', videoLabel: 'fake_device_0', audio: 'none', quality: '720p60', replay: '30', lang: 'uk' });
  try {
    await page.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 15000 });
    assert.match(await page.textContent('#hud'), /S — зберегти останні 30 с/);
    assert.equal(await page.getAttribute('#clip', 'hidden'), null, 'the save button is there for the mouse');
    // A two-second buffer on the same stream, so the test does not wait 30 s.
    // After 4.5 s the first recorder has restarted once and the older one
    // holds 2.5 s.
    const clip = await page.evaluate(async () => {
      const replay = window.PRGSwitchReplay.create(document.getElementById('video').srcObject, { seconds: 2, bitrate: 2_000_000 });
      await new Promise(resolve => setTimeout(resolve, 4500));
      const saved = await replay.save();
      const afterSave = await replay.save();
      replay.stop();
      const player = document.createElement('video');
      player.muted = true;
      player.src = URL.createObjectURL(saved.blob);
      await new Promise((resolve, reject) => { player.onloadeddata = resolve; player.onerror = () => reject(new Error('clip does not decode')); });
      return { size: saved.blob.size, type: saved.blob.type, extension: saved.extension, durationMs: saved.durationMs, width: player.videoWidth, still: afterSave.blob.size >= saved.blob.size };
    });
    assert.ok(clip.size > 10000, `clip has data (${clip.size} bytes)`);
    assert.ok(clip.durationMs >= 2000, 'the clip holds at least the buffer length');
    assert.ok(clip.width >= 640, 'the clip decodes to frames');
    assert.equal(clip.still, true, 'saving does not reset the buffer');
    assert.match(clip.type, clip.extension === 'mp4' ? /^video\/mp4$/ : /^video\/webm$/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
