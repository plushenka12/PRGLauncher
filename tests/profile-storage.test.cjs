const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/profile-storage.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'profile-storage.js' });

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test('scopes profile data by the active UID and preserves anonymous keys', () => {
  const storage = memoryStorage();
  let user = null;
  const profile = context.window.createProfileStorage(storage, () => user);

  profile.writeJSON('gv-games', [{ title: 'Local' }]);
  assert.equal(JSON.stringify(profile.readJSON('gv-games', [])), JSON.stringify([{ title: 'Local' }]));

  user = { uid: 'user-a' };
  assert.equal(JSON.stringify(profile.readJSON('gv-games', [])), JSON.stringify([]));
  profile.writeJSON('gv-games', [{ title: 'A' }]);
  user = { uid: 'user-b' };
  profile.writeJSON('gv-games', [{ title: 'B' }]);
  assert.equal(JSON.stringify(profile.readJSON('gv-games', [])), JSON.stringify([{ title: 'B' }]));
  user = { uid: 'user-a' };
  assert.equal(JSON.stringify(profile.readJSON('gv-games', [])), JSON.stringify([{ title: 'A' }]));
});
