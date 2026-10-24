const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/main/index.js', 'utf8');
const start = source.indexOf("ipcMain.handle('review:openLink'");
const end = source.indexOf('\n})', start) + 3;
assert.ok(start >= 0 && end > start);

test('review link IPC opens only HTTPS from the launcher window', async () => {
  const opened = [];
  let handler;
  const mainFrame = {};
  const sender = { mainFrame };
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (_name, callback) => { handler = callback; } },
    mainWindow: { webContents: sender },
    shell: { openExternal: async url => { opened.push(url); } },
    URL
  });
  assert.equal((await handler({ sender, senderFrame: mainFrame }, 'https://example.com/review')).ok, true);
  for (const bad of ['http://example.com', 'file:///C:/secret', 'https://user:pass@example.com', 'https://127.0.0.1/private', 'https://[::1]/private', 'https://localhost/private', 'x'.repeat(2049)]) {
    assert.equal((await handler({ sender, senderFrame: mainFrame }, bad)).ok, false, bad);
  }
  assert.equal((await handler({ sender: {} }, 'https://example.com')).ok, false);
  assert.equal((await handler({ sender, senderFrame: {} }, 'https://example.com')).ok, false);
  assert.deepEqual(opened, ['https://example.com/review']);
});
