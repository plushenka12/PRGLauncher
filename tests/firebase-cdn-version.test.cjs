const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('launcher uses a local Firebase bundle while the public site keeps the tested CDN SDK', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(manifest.scripts.predev, 'npm run build:renderer');
  assert.equal(manifest.scripts.prebuild, 'npm run build:renderer');
  assert.ok(manifest.build.files.includes('src/**/*'), 'the installer must include the generated renderer bundle');
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const installedVersion = lock.packages['node_modules/firebase'].version;
  const launcher = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.match(launcher, /<script src="\.\/firebase-bundle\.js"><\/script>/);
  assert.doesNotMatch(launcher, /https:\/\/www\.gstatic\.com\/firebasejs\//);
  const site = fs.readFileSync('web-dashboard/index.html', 'utf8');
  const versions = [...site.matchAll(/https:\/\/www\.gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-[\w-]+\.js/g)]
    .map(match => match[1]);
  assert.ok(versions.length > 0, 'public site must import the Firebase SDK');
  assert.ok(versions.every(version => version === installedVersion), `public site loads Firebase ${versions.join(', ')} instead of tested ${installedVersion}`);
});
