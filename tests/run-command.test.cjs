const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runCommand } = require('../src/main/run-command.js');

const source = fs.readFileSync('src/main/index.js', 'utf8');

test('runCommand resolves output, failures and timeouts without throwing', async () => {
  const ok = await runCommand(process.execPath, ['-e', 'process.stdout.write("SteamPath    REG_SZ    C:/Steam")']);
  assert.deepEqual(ok, { ok: true, stdout: 'SteamPath    REG_SZ    C:/Steam' });
  assert.equal((await runCommand(process.execPath, ['-e', 'process.exit(1)'])).ok, false);
  const started = Date.now();
  assert.equal((await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 200 })).ok, false);
  assert.ok(Date.now() - started < 3000, 'timeout stops the command');
  assert.equal((await runCommand('prg-launcher-missing-tool', [])).ok, false);
});

test('runCommand passes arguments without a shell', async () => {
  const calls = [];
  await runCommand('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\Apps\\1" & calc & "'], {
    exec: (file, args, options, callback) => { calls.push({ file, args, options }); callback(null, ''); },
  });
  assert.equal(calls[0].file, 'reg');
  assert.equal(calls[0].args.length, 2, 'the value stays one argument');
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.windowsHide, true);
});

test('main process no longer blocks on synchronous child processes', () => {
  assert.doesNotMatch(source, /\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/);
});

test('Steam ownership lookup rejects a non-numeric App ID before running reg', async () => {
  const start = source.indexOf('async function isGameInLibrary');
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  const calls = [];
  const context = {
    process: { platform: 'win32' }, steamPath: 'C:\\Steam', String,
    runCommand: async (file, args) => { calls.push([file, ...args]); return { ok: true, stdout: '' }; },
  };
  vm.runInNewContext(`${body}\nthis.isGameInLibrary = isGameInLibrary`, context);
  assert.equal(await context.isGameInLibrary('570" & calc & "'), false);
  assert.deepEqual(calls, []);
  assert.equal(await context.isGameInLibrary('570'), true);
  assert.deepEqual(calls, [['reg', 'query', 'HKCU\\Software\\Valve\\Steam\\Apps\\570']]);
});
