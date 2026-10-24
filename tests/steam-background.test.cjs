const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSteamInstallScanner, readVdfNumber } = require('../src/main/steam-install-scan.js');
const { createActivityScheduler, isGameProcessLog } = require('../src/main/steam-activity-scheduler.js');

const source = fs.readFileSync('src/main/index.js', 'utf8');

function manifest(appId, flags, downloaded, total) {
  return `"AppState"\n{\n\t"appid"\t\t"${appId}"\n\t"StateFlags"\t\t"${flags}"\n` +
    (downloaded === undefined ? '' : `\t"BytesDownloaded"\t\t"${downloaded}"\n\t"BytesToDownload"\t\t"${total}"\n`) + '}\n';
}

function makeLibraries() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-steam-'));
  const libA = path.join(root, 'Steam');
  const libB = path.join(root, 'SteamLibrary');
  for (const lib of [libA, libB]) fs.mkdirSync(path.join(lib, 'steamapps', 'downloading'), { recursive: true });
  const write = (lib, appId, text) => fs.writeFileSync(path.join(lib, 'steamapps', `appmanifest_${appId}.acf`), text);
  write(libA, 10, manifest(10, 4));
  write(libB, 20, manifest(20, 4));
  write(libA, 30, manifest(30, 1026, 250, 1000));
  fs.mkdirSync(path.join(libA, 'steamapps', 'downloading', '30'));
  write(libA, 40, manifest(40, 1026, 900, 1000)); // stale counters, download cancelled
  fs.mkdirSync(path.join(libB, 'steamapps', 'downloading', '50')); // no manifest yet
  return { libraries: [libA, libB], write, libA };
}

// The pre-scanner implementation, kept here as the reference behaviour.
function referenceStatus(appId, libraries, hasSteam) {
  const installed = libraries.some(library => {
    try { const flags = readVdfNumber(fs.readFileSync(path.join(library, 'steamapps', `appmanifest_${appId}.acf`), 'utf8'), 'StateFlags'); return flags !== null && (flags & 4) === 4; } catch { return false; }
  });
  if (installed) return { state: 'ready', progress: 100, downloaded: null, total: null };
  for (const library of libraries) {
    const steamApps = path.join(library, 'steamapps');
    let downloaded = null; let total = null;
    try { const data = fs.readFileSync(path.join(steamApps, `appmanifest_${appId}.acf`), 'utf8'); downloaded = readVdfNumber(data, 'BytesDownloaded'); total = readVdfNumber(data, 'BytesToDownload'); } catch {}
    if (fs.existsSync(path.join(steamApps, 'downloading', String(appId)))) {
      const progress = total && downloaded !== null ? Math.min(99, Math.floor(downloaded / total * 100)) : null;
      return { state: 'downloading', progress, downloaded, total };
    }
  }
  return { state: hasSteam ? 'waiting' : 'steam_not_found', progress: null, downloaded: null, total: null };
}

test('directory scan reports the same status as per-app probing', () => {
  const { libraries } = makeLibraries();
  const scanner = createSteamInstallScanner({ fs });
  const snapshot = scanner.scan(libraries);
  for (const appId of ['10', '20', '30', '40', '50', '60']) {
    for (const hasSteam of [true, false]) {
      assert.deepEqual(scanner.statusFor(appId, snapshot, hasSteam), referenceStatus(appId, libraries, hasSteam), `${appId} ${hasSteam}`);
    }
  }
  assert.deepEqual(scanner.statusFor('30', snapshot, true), { state: 'downloading', progress: 25, downloaded: 250, total: 1000 });
  assert.equal(scanner.statusFor('40', snapshot, true).state, 'waiting');
  assert.deepEqual(scanner.scan([path.join(os.tmpdir(), 'prg-missing-steam')]), [{ steamApps: path.join(os.tmpdir(), 'prg-missing-steam', 'steamapps'), manifests: new Set(), downloading: new Set() }]);
});

test('an unchanged manifest is not read again, a changed one is', () => {
  const { libraries, write, libA } = makeLibraries();
  let reads = 0;
  const countingFs = { ...fs, readFileSync: (...args) => { reads += 1; return fs.readFileSync(...args); } };
  const scanner = createSteamInstallScanner({ fs: countingFs });
  scanner.statusFor('30', scanner.scan(libraries), true);
  assert.equal(reads, 1);
  scanner.statusFor('30', scanner.scan(libraries), true);
  assert.equal(reads, 1, 'cached by size and mtime');
  write(libA, 30, manifest(30, 4));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(libA, 'steamapps', 'appmanifest_30.acf'), later, later);
  assert.equal(scanner.statusFor('30', scanner.scan(libraries), true).state, 'ready');
  assert.equal(reads, 2);
});

function fakeClock() {
  let time = 0;
  let next = null;
  return {
    now: () => time,
    setTimer: (fn, ms) => { next = { fn, at: time + ms }; return next; },
    clearTimer: handle => { if (next === handle) next = null; },
    pending: () => next && next.at - time,
    async advance() { const job = next; next = null; time = job.at; await job.fn(); },
  };
}

test('activity checks are rare while idle, moderate while playing and fast after a hint', async () => {
  const clock = fakeClock();
  let running = false;
  let polls = 0;
  const scheduler = createActivityScheduler({ poll: async () => { polls += 1; return running; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  scheduler.start();
  assert.equal(clock.pending(), 0);
  await clock.advance();
  assert.equal(clock.pending(), 15000, 'idle');
  running = true;
  scheduler.notify();
  assert.equal(clock.pending(), 0, 'a hint checks immediately');
  await clock.advance();
  assert.equal(clock.pending(), 1500, 'burst after a hint');
  while (clock.now() < 45000) await clock.advance();
  assert.equal(clock.pending(), 5000, 'running after the burst');
  running = false;
  await clock.advance();
  assert.equal(clock.pending(), 15000);
  scheduler.stop();
  assert.equal(clock.pending(), null);
  assert.ok(polls > 2);
});

test('a failed check keeps the last known state and a hint during a check is not lost', async () => {
  const clock = fakeClock();
  const results = [true, undefined];
  let release;
  const scheduler = createActivityScheduler({ poll: async () => results.shift(), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  scheduler.start();
  await clock.advance();
  await clock.advance();
  assert.equal(scheduler.stats().running, true, 'undefined result keeps running');
  assert.equal(clock.pending(), 5000);

  let polls = 0;
  const slow = createActivityScheduler({ poll: () => { polls += 1; return new Promise(resolve => { release = resolve; }); }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  slow.start();
  const first = clock.advance();
  slow.notify();
  release(false);
  await first;
  assert.equal(clock.pending(), 0, 'the hint re-runs the check right after');
  assert.equal(polls, 1);
  slow.stop();
});

test('only the game-process log triggers a check', () => {
  assert.equal(isGameProcessLog('gameprocess_log.txt'), true);
  assert.equal(isGameProcessLog('gameprocess_log.previous.txt'), true);
  for (const name of ['content_log.txt', 'cef_log.txt', null, undefined]) assert.equal(isGameProcessLog(name), false);
});

test('main process uses the scanner and the adaptive scheduler', () => {
  assert.doesNotMatch(source, /setInterval\(pollSteamActivity/);
  assert.doesNotMatch(source, /steamActivityTimer/);
  assert.match(source, /const steamActivity = createActivityScheduler\(\{ poll: pollSteamActivity \}\)/);
  assert.match(source, /readSteamStatuses\(appIds\)/);
  const launch = source.slice(source.indexOf("handleFromMain('steam:launchGame'"), source.indexOf('\n})', source.indexOf("handleFromMain('steam:launchGame'")));
  assert.match(launch, /steamActivity\.notify\(\)/);
  for (const exit of ["app.on('before-quit'", 'updateInstallInProgress = true']) {
    const start = source.indexOf(exit);
    assert.match(source.slice(start, start + 600), /stopSteamActivity\(\)/, exit);
  }
});
