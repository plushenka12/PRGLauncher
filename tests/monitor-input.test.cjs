const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createMonitorInput, parseInputOptions, cleanMonitor, sanitizeConfig, inputName, parseId, pcInputFor, DDC_TYPES } = require('../src/main/monitor-input.js');
const { allowPermission } = require('../src/main/permissions.js');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const DELL = { device: '\\\\.\\DISPLAY2', index: 0, bounds: [-1920, 0, 1920, 1080], primary: false, description: 'Generic PnP Monitor', ddc: true, input: 15,
  caps: '(prot(monitor)type(LCD)model(DEMO27)cmds(01 02 03 07 0C E3 F3)vcp(02 04 05 10 12 14(05 08 0B) 60(0F 11 12) 62 AC AE B2 B6 C6 C8 D6(01 04 05) DC(00 02 03 05) DF)mccs_ver(2.1))' };
const ID = '\\\\.\\DISPLAY2#0';
const main = fs.readFileSync('src/main/index.js', 'utf8');

test('the input sources come from the monitor capability string', () => {
  assert.deepEqual(parseInputOptions(DELL.caps), [0x0F, 0x11, 0x12]);
  assert.deepEqual(parseInputOptions('vcp(10 12 60 ( 01 03 0f ) 62)'), [1, 3, 15], 'spaces and lower case');
  assert.deepEqual(parseInputOptions('vcp(10 12 62)'), [], 'no input list');
  assert.deepEqual(parseInputOptions('vcp(160(01) 60(11))'), [0x11], '160 is not 60');
  assert.deepEqual(parseInputOptions(null), []);
  assert.equal(inputName(0x11), 'HDMI 1');
  assert.equal(inputName(0x0F), 'DisplayPort 1');
  assert.equal(inputName(0x2A), '0x2A');
});

test('a monitor record is checked and named by its model', () => {
  const monitor = cleanMonitor(DELL);
  assert.equal(monitor.id, ID);
  assert.equal(monitor.name, 'DEMO27');
  assert.equal(monitor.inputName, 'DisplayPort 1');
  assert.deepEqual(monitor.options.map(option => option.name), ['DisplayPort 1', 'HDMI 1', 'HDMI 2']);
  assert.equal(cleanMonitor({ ...DELL, caps: '', description: 'Generic PnP Monitor' }).name, 'Generic PnP Monitor');
  for (const bad of [{ ...DELL, device: 'C:\\Windows' }, { ...DELL, device: "\\\\.\\DISPLAY1'; calc" }, { ...DELL, index: -1 }, { ...DELL, index: 1.5 }, null]) assert.equal(cleanMonitor(bad), null);
});

test('switching sends only a known monitor and a byte-sized input', async () => {
  const scripts = [];
  const monitor = createMonitorInput({ run: async script => { scripts.push(script); return script.includes('::List()') ? JSON.stringify([DELL]) : 'ok'; } });
  assert.deepEqual((await monitor.list()).map(item => item.id), [ID]);
  assert.deepEqual(await monitor.setInput(ID, 0x11), { ok: true });
  assert.match(scripts.at(-1), /\[PrgDdc\]::Set\('\\\\\.\\DISPLAY2', 0, 17\)\)$/);
  for (const [id, value] of [["\\\\.\\DISPLAY2#0'); calc; ('", 17], [ID, 0], [ID, 256], [ID, '17'], ['DISPLAY2#0', 17]]) {
    assert.deepEqual(await monitor.setInput(id, value), { ok: false, code: 'invalid' }, String(id));
  }
  assert.equal(scripts.length, 2, 'refused requests run nothing');
  const refused = createMonitorInput({ run: async () => 'refused' });
  assert.deepEqual(await refused.setInput(ID, 0x11), { ok: false, code: 'refused' });
  const broken = createMonitorInput({ run: async () => 'not json' });
  assert.deepEqual(await broken.list(), []);
});

test('the current input is one quick read of the chosen monitor', async () => {
  const scripts = [];
  const reply = value => createMonitorInput({ run: async script => { scripts.push(script); return value; } });
  assert.deepEqual(await reply('17').getInput(ID), { ok: true, input: 0x11 });
  assert.match(scripts.at(-1), /\[PrgDdc\]::Input\('\\\\\.\\DISPLAY2', 0\)\)$/);
  assert.doesNotMatch(scripts.at(-1), /::List\(\)/, 'no slow capability scan');
  assert.deepEqual(await reply('none').getInput(ID), { ok: false, code: 'no-answer' }, 'a monitor showing the console may not answer');
  assert.deepEqual(await reply('not-found').getInput(ID), { ok: false, code: 'not-found' });
  assert.deepEqual(await reply('0').getInput(ID), { ok: false, code: 'no-answer' });
  assert.deepEqual(await reply('17').getInput('evil'), { ok: false, code: 'invalid' });
});

test('"back to the PC" goes to the recorded input, else DisplayPort 1, else another input', () => {
  const options = [0x0F, 0x11, 0x12].map(value => ({ value }));
  assert.equal(pcInputFor({ pcInput: 0x10, consoleInput: 0x11, options }), 0x10);
  assert.equal(pcInputFor({ pcInput: null, consoleInput: 0x11, options }), 0x0F, 'never recorded: DisplayPort 1');
  assert.equal(pcInputFor({ pcInput: 0x11, consoleInput: 0x11, options }), 0x0F, 'the console input is never the PC');
  assert.equal(pcInputFor({ pcInput: null, consoleInput: 0x11, options: [{ value: 0x11 }, { value: 0x12 }] }), 0x12);
  assert.equal(pcInputFor({ pcInput: null, consoleInput: 0x11 }), 0x0F, 'no list: DisplayPort 1');
  assert.equal(pcInputFor({ pcInput: null, consoleInput: 0x0F }), null);
});

test('the saved choice is sanitized; old capture card and sound fields are dropped', () => {
  assert.deepEqual(sanitizeConfig(null), { monitorId: null, monitorName: '', consoleInput: 0x11, pcInput: null, onConsole: false });
  const config = sanitizeConfig({ monitorId: ID, monitorName: 'DEMO27', consoleInput: 0x12, pcInput: 0x0F, onConsole: true, hasAudio: false, method: 'card', replay: true });
  assert.deepEqual(config, { monitorId: ID, monitorName: 'DEMO27', consoleInput: 0x12, pcInput: 0x0F, onConsole: true });
  assert.equal(sanitizeConfig({ monitorId: 'evil' }).monitorId, null);
  assert.equal(sanitizeConfig({ consoleInput: 999 }).consoleInput, 0x11);
  assert.equal(parseId('\\\\.\\DISPLAY12#3').index, 3);
  assert.equal(parseId('\\\\.\\DISPLAY1#10'), null);
});

test('the PowerShell helper only reads and sets VCP 0x60', () => {
  const calls = [...DDC_TYPES.matchAll(/(SetVCPFeature|GetVCPFeatureAndVCPFeatureReply)\(handle, (0x[0-9A-F]+)/g)].map(match => match[2]);
  assert.deepEqual([...new Set(calls)], ['0x60']);
  assert.doesNotMatch(DDC_TYPES, /0x62|0x8D/, 'no sound codes any more');
});

test('one button flips the monitor both ways, reading where it is first', () => {
  const toggle = main.slice(main.indexOf('async function switchMonitor(toConsole)'), main.indexOf('function toggleMonitor()'));
  assert.match(toggle, /const now = await monitorInput\.getInput\(config\.monitorId\)/);
  assert.match(toggle, /const onConsoleNow = now\.ok \? now\.input === config\.consoleInput : config\.onConsole/, 'the real input wins over the saved side');
  assert.match(toggle, /const goConsole = toConsole == null \? !onConsoleNow : toConsole/);
  assert.match(toggle, /pcInputFor\(\{ pcInput, consoleInput: config\.consoleInput, options \}\)/);
  assert.match(main, /if \(loadMonitorConfig\(\)\.monitorId\) return switchMonitor\(null\)/);
  assert.match(main, /handleFromMain\('switch:open', \(\) => toggleMonitor\(\)\)/);
  assert.match(main, /if \(argv\.includes\('--prg-switch'\)\) \{\r?\n\s+toggleMonitor\(\)/);
  assert.match(main, /label: 'Monitor → PC', click: \(\) => switchMonitor\(false\)/);
  for (const channel of ['monitor:list', 'monitor:saveConfig', 'monitor:switch', 'monitor:getState']) assert.match(main, new RegExp(`handleFromMain\\('${channel}'`));
  assert.match(main, /mainWindow\.webContents\.send\('monitor:state', state\)/, 'the launcher button follows the monitor');
  assert.match(main, /const MINI_BAR_CHANNELS = new Set\(\['mini:restore', 'mini:launch', 'switch:open', 'mini:hide'\]\)/, 'the mini-tab may only open the launcher, launch, flip the monitor and hide itself');
  assert.doesNotMatch(main, /switchWindow|switch-view|startBackgroundCapture|saveBackgroundClip|will-download|monitor:getAudio|setVolume/, 'the capture card window and the sound control are gone');
  for (const removed of ['src/main/switch-view.js', 'src/renderer/switch-view.html', 'src/renderer/switch-view.js', 'src/renderer/switch-replay.js']) assert.equal(fs.existsSync(removed), false, removed);
});

test('the launcher header has the same Switch / PC button as the mini-tab', () => {
  const renderer = rendererSource();
  assert.match(renderer, /id="monitor-btn"/);
  assert.match(renderer, /document\.getElementById\('monitor-btn'\)\?\.addEventListener\('click',async\(\)=>\{/);
  assert.match(renderer, /const result=await window\.launcher\.openSwitchView\(\)/, 'it calls the same toggle as 🎮');
  assert.match(renderer, /window\.launcher\?\.onMonitorState\?\.\(/);
  assert.match(renderer, /const source=onConsole\?'Монітор → ПК'/);
  assert.match(renderer, /staticAttributeSources\.set\(button,\{title:source/, 'translateDom keeps the current label');
  const mini = fs.readFileSync('src/renderer/mini-bar.js', 'utf8');
  assert.match(mini, /state\.monitorMode === 'console' \? x\.monitorToPc/);
  assert.doesNotMatch(mini + fs.readFileSync('src/renderer/mini-bar.html', 'utf8'), /sound-panel|getMonitorAudio/, 'no sound panel in the mini-tab');
});

test('permissions: no window gets the camera or microphone any more', () => {
  const file = 'file:///C:/PRGLauncher/src/renderer/index.html';
  for (const role of ['main', 'mini', null]) assert.equal(allowPermission({ permission: 'media', url: file, role }), false, String(role));
  assert.equal(allowPermission({ permission: 'clipboard-sanitized-write', url: file, role: 'main' }), true);
  assert.equal(allowPermission({ permission: 'clipboard-sanitized-write', url: file, role: 'mini' }), false);
  assert.equal(allowPermission({ permission: 'clipboard-sanitized-write', url: 'https://evil.example/', role: 'main' }), false);
  for (const permission of ['geolocation', 'notifications', 'display-capture', 'openExternal', 'hid', 'serial']) {
    assert.equal(allowPermission({ permission, url: file, role: 'main' }), false, permission);
  }
});
