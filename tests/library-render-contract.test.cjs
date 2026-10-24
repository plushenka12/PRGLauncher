const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Card reuse and DOM batching are covered by library-grid.test.cjs.
test('library covers decode lazily', () => {
  const start = html.indexOf('function coverEl(game)');
  const end = html.indexOf('function fallbackEl(game)', start);
  const cover = html.slice(start, end);
  assert.match(cover, /img\.loading='lazy'/);
  assert.match(cover, /img\.decoding='async'/);
});
