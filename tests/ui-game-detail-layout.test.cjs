const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('portrait cover cannot size the game-detail banner or consume the scroll area', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.detail-cover-banner\{[^}]*height:clamp\(180px,34vh,338px\)[^}]*overflow:hidden/);
  assert.match(css, /\.detail-cover-banner img\{[^}]*position:absolute;inset:0;[^}]*object-fit:cover/);
  assert.match(css, /\.detail-body\{[^}]*overflow-y:auto;[^}]*min-height:0/);
});
