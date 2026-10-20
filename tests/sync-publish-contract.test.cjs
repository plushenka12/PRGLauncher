const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('public recap is published on changes rather than a 30-second loop', () => {
  const source = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.doesNotMatch(source, /setInterval\(\(\)=>publishStatsDashboard\(/);
  const start = source.indexOf('async function pushToFb(');
  const end = source.indexOf('function setSyncBadge(', start);
  const writer = source.slice(start, end);
  assert.match(writer, /clearTimeout\(syncDebounceTimer\)/);
  assert.match(writer, /commitLibraryTransaction\(/);
  assert.match(writer, /publishStatsDashboard\(committed\.ts,committed\.games\)/);
});
