const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('portrait cover cannot size the game-detail banner or consume the scroll area', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /\.detail-cover-banner\{[^}]*height:clamp\(180px,34vh,338px\)[^}]*overflow:hidden/);
  assert.match(html, /\.detail-cover-banner img\{[^}]*position:absolute;inset:0;[^}]*object-fit:cover/);
  assert.match(html, /\.detail-body\{[^}]*overflow-y:auto;[^}]*min-height:0/);
});
