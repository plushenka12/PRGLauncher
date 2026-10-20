const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/renderer/index.html', 'utf8');

test('library covers decode lazily and card nodes are appended in one batch', () => {
  const start = html.indexOf('function coverEl(game)');
  const end = html.indexOf('function fallbackEl(game)', start);
  const cover = html.slice(start, end);
  assert.match(cover, /img\.loading='lazy'/);
  assert.match(cover, /img\.decoding='async'/);

  const gridStart = html.indexOf('function renderGrid()');
  const gridEnd = html.indexOf('function resetLibraryFilters()', gridStart);
  const grid = html.slice(gridStart, gridEnd);
  assert.match(grid, /document\.createDocumentFragment\(\)/);
  assert.match(grid, /grid\.appendChild\(fragment\)/);
});
