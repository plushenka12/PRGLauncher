const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('backups and diagnostics default outside the repository and generated names are ignored', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(main, /title: 'Export PRGLauncher backup', defaultPath: path\.join\(app\.getPath\('documents'\), `PRGLauncher-backup-/);
  assert.match(ignore, /^PRGLauncher-backup-\*\.json$/m);
  assert.match(main, /title: 'Export PRGLauncher diagnostics', defaultPath: path\.join\(app\.getPath\('documents'\), `PRGLauncher-diagnostics-/);
  assert.match(ignore, /^PRGLauncher-diagnostics-\*\.json$/m);
});
