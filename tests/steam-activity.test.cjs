const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { parseRunningSteamAppId } = require('../src/main/steam-activity');

test('finds only a running Steam App ID in registry output', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\100',
    '    Running    REG_DWORD    0x0',
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\200',
    '    Running    REG_DWORD    0x1'
  ].join('\r\n');
  assert.equal(parseRunningSteamAppId(output), '200');
  assert.equal(parseRunningSteamAppId('HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\100\n    Running    REG_DWORD    0x0'), null);
});

test('Steam activity does not run a synchronous recursive registry query', () => {
  const source = fs.readFileSync('src/main/index.js', 'utf8');
  assert.doesNotMatch(source, /execSync\('reg query "HKCU\\\\Software\\\\Valve\\\\Steam\\\\Apps" \/s \/v Running'/);
  assert.match(source, /execFile\('reg', \['query', 'HKCU\\\\Software\\\\Valve\\\\Steam\\\\Apps', '\/s', '\/v', 'Running'\]/);
});

test('a Steam app can be set never to be offered again, and offered again later', () => {
  const vm = require('node:vm');
  const app = fs.readFileSync('src/renderer/app.js', 'utf8');
  const block = app.slice(app.indexOf('const STEAM_IGNORED_KEY'), app.indexOf('async function promptUnknownSteamGame'));
  const store = new Map();
  const context = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }, document: { getElementById: () => null }, steamPromptedAppIds: new Set(['431960']), t: value => value };
  vm.runInNewContext(`${block}; this.api = { isSteamAppIgnored, ignoreSteamApp, unignoreSteamApp, loadIgnoredSteamApps };`, context);
  const { isSteamAppIgnored, ignoreSteamApp, unignoreSteamApp, loadIgnoredSteamApps } = context.api;
  assert.equal(isSteamAppIgnored('431960'), false);
  ignoreSteamApp(431960, 'Wallpaper Engine');
  ignoreSteamApp('431960', 'Wallpaper Engine');
  assert.equal(isSteamAppIgnored('431960'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(loadIgnoredSteamApps())), [{ id: '431960', title: 'Wallpaper Engine' }], 'kept once');
  unignoreSteamApp('431960');
  assert.equal(isSteamAppIgnored('431960'), false);
  assert.equal(context.steamPromptedAppIds.has('431960'), false, 'it may be offered again in this session');
  store.set('gv-steam-ignored-v1', '[{"id":"evil<script>"},{"id":"10","title":"Ok"},"junk"]');
  assert.deepEqual(JSON.parse(JSON.stringify(loadIgnoredSteamApps())), [{ id: '10', title: 'Ok' }], 'junk is dropped');
  store.set('gv-steam-ignored-v1', 'not json');
  assert.deepEqual(JSON.parse(JSON.stringify(loadIgnoredSteamApps())), []);
  assert.match(app, /if\(!id\|\|steamPromptedAppIds\.has\(id\)\|\|isSteamAppIgnored\(id\)\|\|guestBlock\(\)\)return;/, 'ignored apps are not even looked up');
  assert.match(app, /document\.getElementById\('steam-discovered-ignore'\)\.onclick=\(\)=>\{ignoreSteamApp\(id,info\.title\);close\(\);\}/);
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.match(html, /id="steam-discovered-ignore"/);
  assert.match(html, /id="steam-ignored-list"/);
});
