const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { parseLine, createFullscreenWatch, FULLSCREEN_SCRIPT } = require('../src/main/fullscreen-watch.js');

test('watcher lines become the front window or nothing', () => {
  assert.deepEqual(parseLine('full 4242 -1920 0 0 1080'), { pid: 4242, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } });
  for (const line of ['none', '', 'full x 0 0 1 1', 'full 1 0 0 0 0', 'full 1 0 0 10 10; rm -rf']) assert.equal(parseLine(line), null, line);
  assert.match(FULLSCREEN_SCRIPT, /SHQueryUserNotificationState/);
  assert.match(FULLSCREEN_SCRIPT, /\$state -eq 2 -or \$state -eq 3 -or \$state -eq 7/, 'busy, Direct3D full screen and full-screen apps');
  assert.match(FULLSCREEN_SCRIPT, /Start-Sleep -Seconds 2/);
});

test('the watcher reads split output, restarts a few times and stops for good', () => {
  const children = [];
  const timers = [];
  const changes = [];
  const watch = createFullscreenWatch({
    spawn: (file, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.kill = () => { child.killed = true; };
      children.push({ file, args, options, child });
      return child;
    },
    onChange: value => changes.push(value),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
  });
  watch.start();
  assert.equal(children[0].file, 'powershell.exe');
  assert.ok(children[0].args.includes('-EncodedCommand'));
  assert.equal(Buffer.from(children[0].args.at(-1), 'base64').toString('utf16le'), FULLSCREEN_SCRIPT);
  assert.equal(children[0].options.windowsHide, true);
  children[0].child.stdout.emit('data', 'full 7 0 0 1920 10');
  children[0].child.stdout.emit('data', '80\r\nnone\r\n');
  assert.deepEqual(changes, [{ pid: 7, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, null]);
  for (let round = 0; round < 4; round += 1) {
    children.at(-1).child.emit('exit');
    if (timers[round]) timers[round].callback();
  }
  assert.equal(children.length, 4, 'three restarts, then it stays off');
  assert.deepEqual(timers.map(timer => timer.ms), [5000, 10000, 15000]);
  watch.stop();
});

test('the mini-tab steps aside only for another program covering its monitor', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  const handler = main.slice(main.indexOf('function onFullscreenChange(front)'), main.indexOf('const fullscreenWatch ='));
  assert.match(handler, /front\.pid !== process\.pid/, 'our own Switch window does not count');
  assert.match(handler, /screen\.getDisplayMatching\(front\.bounds\)\.id === screen\.getDisplayMatching\(miniBar\.getBounds\(\)\)\.id/);
  assert.match(handler, /if \(!miniHiddenForSwitch\) miniBar\.showInactive\(\)/);
  assert.match(main, /if \(process\.platform === 'win32'\) fullscreenWatch\.start\(\)/);
  assert.match(main, /isQuitting = true\r?\n  fullscreenWatch\.stop\(\)/);
  assert.match(fs.readFileSync('src/renderer/mini-bar.js', 'utf8'), /onMiniQuiet\?\.\(value => \{ quiet = value; \$\('wrapped'\)\.classList\.toggle\('paused', value\); \}\)/);
});
