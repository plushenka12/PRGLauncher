const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeExecutablePath, createLaunchAllowlist, MAX_ENTRIES } = require('../src/main/launch-allowlist.js');

const source = fs.readFileSync('src/main/index.js', 'utf8');
function slice(marker, terminator = '\n})') {
  const start = source.indexOf(marker);
  const end = source.indexOf(terminator, start) + terminator.length;
  assert.ok(start >= 0 && end > start, marker);
  return source.slice(start, end);
}
const handlerSource = [
  slice('function isMainSender', '\n}'),
  slice('function parseLaunchArguments', '\n}'),
  slice("ipcMain.handle('local:chooseExecutable'"),
  slice("ipcMain.handle('local:launchGame'"),
].join('\n');

// Values created inside the vm context have another realm's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prg-launch-'));
}

function loadHandlers({ confirm = false, picked = null } = {}) {
  const dir = tempDir();
  const handlers = {};
  const spawned = [];
  const prompts = [];
  const mainFrame = {};
  const sender = { mainFrame };
  const allowlist = createLaunchAllowlist({ filePath: path.join(dir, 'launch-allowlist.json'), fs });
  vm.runInNewContext(handlerSource, {
    ipcMain: { handle: (name, callback) => { handlers[name] = callback; } },
    mainWindow: { webContents: sender },
    getLaunchAllowlist: () => allowlist,
    confirmUnknownExecutable: async (executable, args) => { prompts.push({ executable, args }); return confirm; },
    dialog: { showOpenDialog: async () => (picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }) },
    spawn: (executable, args, options) => { spawned.push({ executable, args, cwd: options.cwd }); return { unref() {} }; },
    shell: { openPath: async () => '', openExternal: async () => {} },
    path, fs, process, String, Boolean,
  });
  return { handlers, spawned, prompts, allowlist, mainEvent: { sender, senderFrame: mainFrame }, dir };
}

function fakeExecutable(dir, name = 'Game.exe') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '');
  return file;
}

test('executable paths normalize to absolute, case-insensitive keys on Windows', () => {
  assert.equal(normalizeExecutablePath('C:\\Games\\..\\Games\\Hades.EXE', 'win32'), 'c:\\games\\hades.exe');
  assert.equal(normalizeExecutablePath('/Applications/Hades.app', 'darwin'), '/Applications/Hades.app');
  for (const bad of ['', 'Hades.exe', '.\\Hades.exe', 'C:\\Games\\a\0.exe', `C:\\${'a'.repeat(1100)}.exe`]) {
    assert.equal(normalizeExecutablePath(bad, 'win32'), null, JSON.stringify(bad.slice(0, 20)));
  }
});

test('allowlist persists approved executables and tolerates a corrupt file', () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'launch-allowlist.json');
  fs.writeFileSync(filePath, '{not json');
  const first = createLaunchAllowlist({ filePath, fs, platform: 'win32' });
  assert.equal(first.has('C:\\Games\\Hades.exe'), false);
  assert.equal(first.add('C:\\Games\\Hades.exe'), true);
  assert.equal(first.add('relative.exe'), false);
  const second = createLaunchAllowlist({ filePath, fs, platform: 'win32' });
  assert.equal(second.has('c:\\games\\HADES.exe'), true);
  assert.equal(second.has('C:\\Windows\\System32\\cmd.exe'), false);
});

test('allowlist keeps only the most recent entries', () => {
  const dir = tempDir();
  const allowlist = createLaunchAllowlist({ filePath: path.join(dir, 'list.json'), fs, platform: 'win32' });
  for (let i = 0; i <= MAX_ENTRIES; i += 1) allowlist.add(`C:\\Games\\game-${i}.exe`);
  assert.equal(allowlist.has('C:\\Games\\game-0.exe'), false);
  assert.equal(allowlist.has(`C:\\Games\\game-${MAX_ENTRIES}.exe`), true);
});

test('local launch rejects requests that do not come from the main window', async () => {
  const { handlers, spawned, prompts, dir, mainEvent } = loadHandlers({ confirm: true });
  const executable = fakeExecutable(dir);
  assert.equal((await handlers['local:launchGame']({ sender: {} }, { executable })).action, 'error');
  assert.equal((await handlers['local:launchGame']({ sender: mainEvent.sender, senderFrame: {} }, { executable })).action, 'error', 'a subframe of the main window is rejected');
  assert.deepEqual(spawned, []);
  assert.deepEqual(prompts, []);
  assert.equal((await handlers['local:chooseExecutable']({ sender: {} })).canceled, true);
});

test('an executable chosen with the file picker launches without a prompt', async () => {
  const dir = tempDir();
  const executable = fakeExecutable(dir);
  const { handlers, spawned, prompts, mainEvent } = loadHandlers({ picked: executable });
  assert.deepEqual(plain(await handlers['local:chooseExecutable'](mainEvent)), { canceled: false, path: executable });
  const result = await handlers['local:launchGame'](mainEvent, { executable, arguments: '-windowed "save slot"' });
  assert.equal(result.action, 'requested');
  assert.deepEqual(prompts, []);
  assert.deepEqual(plain(spawned), [{ executable, args: ['-windowed', 'save slot'], cwd: dir }]);
});

test('an unknown library executable runs only after native confirmation', async () => {
  const declined = loadHandlers({ confirm: false });
  const executable = fakeExecutable(declined.dir);
  assert.deepEqual(plain(await declined.handlers['local:launchGame'](declined.mainEvent, { executable, arguments: '/c calc' })), { action: 'cancelled' });
  assert.deepEqual(declined.spawned, []);
  assert.deepEqual(plain(declined.prompts), [{ executable, args: ['/c', 'calc'] }]);
  assert.equal(declined.allowlist.has(executable), false);

  const approved = loadHandlers({ confirm: true });
  const approvedExecutable = fakeExecutable(approved.dir);
  assert.equal((await approved.handlers['local:launchGame'](approved.mainEvent, { executable: approvedExecutable })).action, 'requested');
  assert.equal((await approved.handlers['local:launchGame'](approved.mainEvent, { executable: approvedExecutable })).action, 'requested');
  assert.equal(approved.prompts.length, 1, 'confirmation is remembered');
  assert.equal(approved.spawned.length, 2);
});

test('missing or relative executables never reach the prompt or spawn', async () => {
  const { handlers, spawned, prompts, mainEvent, dir } = loadHandlers({ confirm: true });
  for (const executable of ['Game.exe', path.join(dir, 'missing.exe'), '']) {
    assert.equal((await handlers['local:launchGame'](mainEvent, { executable })).action, 'error', executable);
  }
  assert.deepEqual(spawned, []);
  assert.deepEqual(prompts, []);
});

test('batch files are refused with a clear code instead of crashing spawn', { skip: process.platform !== 'win32' }, async () => {
  const { handlers, spawned, prompts, mainEvent, dir } = loadHandlers({ confirm: true });
  for (const name of ['setup.bat', 'Run.CMD']) {
    const executable = fakeExecutable(dir, name);
    const result = plain(await handlers['local:launchGame'](mainEvent, { executable }));
    assert.equal(result.code, 'unsupported-type', name);
  }
  assert.deepEqual(spawned, []);
  assert.deepEqual(prompts, [], 'no confirmation is asked for a file that cannot run');
  assert.match(source, /extensions: \['exe'\] \}\]/, 'the picker offers .exe only');
});
