const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FIREBASE_AUTH_ORIGIN, isAllowedAppNavigation, isFirebaseAuthPopup, attachNavigationGuard } = require('../src/main/navigation-guard.js');

const source = fs.readFileSync('src/main/index.js', 'utf8');
const appFile = path.resolve('src/renderer/index.html');

// Channels that check their sender inline and return a result object instead
// of throwing, so the renderer can show a friendly message.
const INLINE_CHECKED = ['local:chooseExecutable', 'local:launchGame', 'gog:launchGame', 'review:openLink'];

test('every IPC channel either uses the sender guard or checks its sender inline', () => {
  const direct = [...source.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(direct.sort(), [...INLINE_CHECKED].sort());
  for (const channel of INLINE_CHECKED) {
    const start = source.indexOf(`ipcMain.handle('${channel}'`);
    const body = source.slice(start, source.indexOf('\n})', start));
    assert.match(body, /isMainSender\(event\)|event\.senderFrame !== mainWindow\.webContents\.mainFrame/, channel);
  }
  const guarded = [...source.matchAll(/handleFromMain\('([^']+)'/g)].map(match => match[1]);
  for (const channel of ['app:exportBackup', 'app:importBackup', 'app:exportDiagnostics', 'app:installUpdate', 'nintendo:fetchHistory', 'nintendo:completeAuth', 'steam:profileLibrary', 'backloggd:importProfile']) {
    assert.ok(guarded.includes(channel), `${channel} is guarded`);
  }
  assert.match(source, /ipcMain\.on\('mini:pause', \(event\) => \{\n {2}if \(!isMiniBarSender\(event\)\) return/);
});

test('guarded channels answer only the main window top frame', async () => {
  const main = { mainFrame: {} };
  const mini = { mainFrame: {} };
  const handlers = {};
  const start = source.indexOf('const MINI_BAR_CHANNELS');
  const end = source.indexOf('\n}', source.indexOf('function handleFromMain')) + 2;
  vm.runInNewContext(`${source.slice(start, end)}\nhandleFromMain('app:exportBackup', () => 'saved')\nhandleFromMain('mini:restore', () => 'restored')`, {
    ipcMain: { handle: (name, callback) => { handlers[name] = callback; } },
    mainWindow: { webContents: main },
    miniBar: { webContents: mini },
    Set, Boolean, Error,
  });
  assert.equal(await handlers['app:exportBackup']({ sender: main, senderFrame: main.mainFrame }), 'saved');
  assert.equal(await handlers['mini:restore']({ sender: mini, senderFrame: mini.mainFrame }), 'restored');
  assert.equal(await handlers['mini:restore']({ sender: main, senderFrame: main.mainFrame }), 'restored');
  assert.throws(() => handlers['app:exportBackup']({ sender: mini, senderFrame: mini.mainFrame }), /not available/);
  assert.throws(() => handlers['app:exportBackup']({ sender: main, senderFrame: {} }), /not available/, 'subframe');
  assert.throws(() => handlers['app:exportBackup']({ sender: {}, senderFrame: {} }), /not available/);
  assert.throws(() => handlers['mini:restore']({ sender: mini, senderFrame: {} }), /not available/);
});

test('launcher windows may only reload their own file', () => {
  const href = require('node:url').pathToFileURL(appFile).href;
  assert.equal(isAllowedAppNavigation(href, appFile), true);
  assert.equal(isAllowedAppNavigation(`${href}#library`, appFile), true);
  assert.equal(isAllowedAppNavigation(href.toUpperCase().replace('FILE:', 'file:'), appFile, 'win32'), true);
  for (const bad of ['https://evil.example/', 'file:///C:/Windows/win.ini', href.replace('index.html', 'mini-bar.html'), 'javascript:alert(1)', 'not a url']) {
    assert.equal(isAllowedAppNavigation(bad, appFile), false, bad);
  }
});

test('only the Firebase auth handler may open a popup', () => {
  assert.equal(isFirebaseAuthPopup(`${FIREBASE_AUTH_ORIGIN}/__/auth/handler?apiKey=x&providerId=google.com`), true);
  for (const bad of [`${FIREBASE_AUTH_ORIGIN}/other`, 'https://gametracker-30c93.firebaseapp.com.evil.example/__/auth/handler', 'http://gametracker-30c93.firebaseapp.com/__/auth/handler', 'https://prgtracker.netlify.app/', 'about:blank']) {
    assert.equal(isFirebaseAuthPopup(bad), false, bad);
  }
  const renderer = fs.readFileSync('src/renderer/index.html', 'utf8');
  const authDomain = renderer.match(/authDomain:\s*'([^']+)'/)?.[1];
  assert.equal(`https://${authDomain}`, FIREBASE_AUTH_ORIGIN, 'navigation guard matches the Firebase config');
});

test('navigation guard blocks navigation and popups on a window', () => {
  const listeners = {};
  let openHandler;
  attachNavigationGuard({ on: (name, fn) => { listeners[name] = fn; }, setWindowOpenHandler: fn => { openHandler = fn; } }, appFile, { allowAuthPopup: true });
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    listeners['will-navigate'](event, 'https://evil.example/');
    listeners['will-navigate'](event, require('node:url').pathToFileURL(appFile).href);
    assert.equal(prevented, 1);
    assert.equal(openHandler({ url: 'https://evil.example/' }).action, 'deny');
    const allowed = openHandler({ url: `${FIREBASE_AUTH_ORIGIN}/__/auth/handler?x=1` });
    assert.equal(allowed.action, 'allow');
    assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.preload, undefined);
    assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  } finally {
    console.warn = warn;
  }

  let miniOpen;
  attachNavigationGuard({ on() {}, setWindowOpenHandler: fn => { miniOpen = fn; } }, appFile);
  console.warn = () => {};
  try { assert.equal(miniOpen({ url: `${FIREBASE_AUTH_ORIGIN}/__/auth/handler` }).action, 'deny'); } finally { console.warn = warn; }
});

test('main process refuses webview attachment', () => {
  assert.match(source, /contents\.on\('will-attach-webview', event => event\.preventDefault\(\)\)/);
});
