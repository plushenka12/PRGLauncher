const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('active Firebase CDN imports match the tested npm SDK version', () => {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const installedVersion = lock.packages['node_modules/firebase'].version;
  for (const file of ['src/renderer/index.html', 'web-dashboard/index.html']) {
    const source = fs.readFileSync(file, 'utf8');
    const versions = [...source.matchAll(/https:\/\/www\.gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-[\w-]+\.js/g)]
      .map(match => match[1]);
    assert.ok(versions.length > 0, `${file} must import the Firebase SDK`);
    assert.ok(versions.every(version => version === installedVersion), `${file} loads Firebase ${versions.join(', ')} instead of tested ${installedVersion}`);
  }
});
