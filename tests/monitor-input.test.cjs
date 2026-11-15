const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createMonitorInput, parseInputOptions, cleanMonitor, sanitizeConfig, inputName, parseId, DDC_TYPES } = require('../src/main/monitor-input.js');

const DELL = { device: '\\\\.\\DISPLAY2', index: 0, bounds: [-1920, 0, 1920, 1080], primary: false, description: 'Generic PnP Monitor', ddc: true, input: 15,
  caps: '(prot(monitor)type(LCD)model(DEMO27)cmds(01 02 03 07 0C E3 F3)vcp(02 04 05 10 12 14(05 08 0B) 60(0F 11 12) 62 AC AE B2 B6 C6 C8 D6(01 04 05) DC(00 02 03 05) DF)mccs_ver(2.1))' };

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
  assert.equal(monitor.id, '\\\\.\\DISPLAY2#0');
  assert.equal(monitor.name, 'DEMO27');
  assert.equal(monitor.inputName, 'DisplayPort 1');
  assert.deepEqual(monitor.options.map(option => option.name), ['DisplayPort 1', 'HDMI 1', 'HDMI 2']);
  assert.equal(cleanMonitor({ ...DELL, caps: '', description: 'Generic PnP Monitor' }).name, 'Generic PnP Monitor');
  for (const bad of [{ ...DELL, device: 'C:\\Windows' }, { ...DELL, device: "\\\\.\\DISPLAY1'; calc" }, { ...DELL, index: -1 }, { ...DELL, index: 1.5 }, null]) assert.equal(cleanMonitor(bad), null);
});

test('switching sends only a known monitor and a byte-sized input', async () => {
  const scripts = [];
  const monitor = createMonitorInput({ run: async script => { scripts.push(script); return script.includes('::List()') ? JSON.stringify([DELL]) : 'ok'; } });
  assert.deepEqual((await monitor.list()).map(item => item.id), ['\\\\.\\DISPLAY2#0']);
  assert.deepEqual(await monitor.setInput('\\\\.\\DISPLAY2#0', 0x11), { ok: true });
  assert.match(scripts.at(-1), /\[PrgDdc\]::Set\('\\\\\.\\DISPLAY2', 0, 17\)\)$/);
  for (const [id, value] of [["\\\\.\\DISPLAY2#0'); calc; ('", 17], ['\\\\.\\DISPLAY2#0', 0], ['\\\\.\\DISPLAY2#0', 256], ['\\\\.\\DISPLAY2#0', '17'], ['DISPLAY2#0', 17]]) {
    assert.deepEqual(await monitor.setInput(id, value), { ok: false, code: 'invalid' }, String(id));
  }
  assert.equal(scripts.length, 2, 'refused requests run nothing');
  const refused = createMonitorInput({ run: async () => 'refused' });
  assert.deepEqual(await refused.setInput('\\\\.\\DISPLAY2#0', 0x11), { ok: false, code: 'refused' });
  const broken = createMonitorInput({ run: async () => 'not json' });
  assert.deepEqual(await broken.list(), []);
});

test('the saved choice is sanitized and defaults to the capture card', () => {
  assert.deepEqual(sanitizeConfig(null), { monitorId: null, monitorName: '', consoleInput: 0x11, pcInput: null, onConsole: false, method: 'card', replay: false });
  const config = sanitizeConfig({ monitorId: '\\\\.\\DISPLAY2#0', monitorName: 'DEMO27', consoleInput: 0x12, pcInput: 0x0F, onConsole: true, method: 'hdmi', replay: true });
  assert.deepEqual(config, { monitorId: '\\\\.\\DISPLAY2#0', monitorName: 'DEMO27', consoleInput: 0x12, pcInput: 0x0F, onConsole: true, method: 'hdmi', replay: true });
  assert.equal(sanitizeConfig({ replay: 'yes' }).replay, false);
  assert.equal(sanitizeConfig({ monitorId: 'evil', consoleInput: 999, method: 'other' }).monitorId, null);
  assert.equal(sanitizeConfig({ consoleInput: 999 }).consoleInput, 0x11);
  assert.equal(parseId('\\\\.\\DISPLAY12#3').index, 3);
  assert.equal(parseId('\\\\.\\DISPLAY1#10'), null);
});

test('the PowerShell helper only reads and sets VCP 0x60', () => {
  const calls = [...DDC_TYPES.matchAll(/(SetVCPFeature|GetVCPFeatureAndVCPFeatureReply)\(handle, (0x[0-9A-F]+)/g)].map(match => match[2]);
  assert.deepEqual([...new Set(calls)], ['0x60']);
});

test('the Switch button, jump list and tray switch the monitor in HDMI mode', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  assert.match(main, /if \(monitor\.method === 'hdmi' && monitor\.monitorId\) return switchMonitor\(!monitor\.onConsole\)/);
  assert.match(main, /if \(monitor\.method === 'hdmi' && monitor\.monitorId\) \{ switchMonitor\(!monitor\.onConsole\); return true \}/);
  assert.match(main, /label: 'Monitor → PC', click: \(\) => switchMonitor\(false\)/);
  for (const channel of ['monitor:list', 'monitor:saveConfig', 'monitor:switch']) assert.match(main, new RegExp(`handleFromMain\\('${channel}'`));
  assert.match(main, /const MINI_BAR_CHANNELS = new Set\(\['mini:restore', 'mini:launch', 'switch:open', 'switch:saveClip'\]\)/, 'the mini-tab may only toggle the monitor and save a clip');
  const mini = fs.readFileSync('src/renderer/mini-bar.js', 'utf8');
  assert.match(mini, /state\.monitorMode === 'console' \? x\.monitorToPc/);
});
