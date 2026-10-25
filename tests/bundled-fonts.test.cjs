const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join('src', 'renderer', 'fonts');

test('launcher pages use bundled fonts, not a font CDN', () => {
  for (const page of ['index.html', 'mini-bar.html']) {
    const html = fs.readFileSync(path.join('src', 'renderer', page), 'utf8');
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, page);
    assert.match(html, /<link href="\.\/fonts\/fonts\.css" rel="stylesheet">/, page);
    assert.match(html, /font-src 'self'/, page);
  }
});

test('every bundled font file exists and Manrope covers Cyrillic', () => {
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  const files = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map(match => match[1]);
  assert.ok(files.length >= 8);
  for (const file of files) assert.ok(fs.statSync(path.join(dir, file)).size > 1000, file);
  assert.match(css, /font-family:'Manrope'[^}]*cyrillic\.woff2[^}]*U\+0400-045F/);
  for (const family of ['Manrope', 'DM-Mono', 'Space-Grotesk']) assert.ok(fs.existsSync(path.join(dir, `OFL-${family}.txt`)), family);
});
