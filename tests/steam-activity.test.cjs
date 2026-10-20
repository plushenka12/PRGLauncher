const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { parseRunningSteamAppId } = require('../src/main/steam-activity');

test('finds only a running Steam App ID in registry output', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\100',
    '    Running    REG_DWORD    0x0',
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\200',
    '    Running    REG_DWORD    0x1'
  ].join('\r\n');
  assert.equal(parseRunningSteamAppId(output), '200');
  assert.equal(parseRunningSteamAppId('HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\100\n    Running    REG_DWORD    0x0'), null);
});

test('Steam activity does not run a synchronous recursive registry query', () => {
  const source = fs.readFileSync('src/main/index.js', 'utf8');
  assert.doesNotMatch(source, /execSync\('reg query "HKCU\\\\Software\\\\Valve\\\\Steam\\\\Apps" \/s \/v Running'/);
  assert.match(source, /execFile\('reg', \['query', 'HKCU\\\\Software\\\\Valve\\\\Steam\\\\Apps', '\/s', '\/v', 'Running'\]/);
});
