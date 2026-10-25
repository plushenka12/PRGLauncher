const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('src/renderer/styles.css', 'utf8');

test('renderer motion follows the review rules', () => {
  assert.doesNotMatch(css, /transition:\s*all\b/, 'transitions name their properties');
  assert.match(css, /--ease-out:cubic-bezier\(\.23,1,\.32,1\)/);
  assert.match(css, /\.btn:active,[^{]*\.card-btn:active[^{]*\{transform:scale\(\.97\)\}/, 'buttons respond to a press');
  assert.match(css, /@media\(hover:hover\) and \(pointer:fine\)\{\.download-card:hover/, 'hover lifts only with a mouse');
  assert.match(css, /@keyframes pageIn\{from\{opacity:0\}to\{opacity:1\}\}/, 'tab switches fade without travel');
  assert.doesNotMatch(css, /\.pulse\{[^}]*box-shadow:0 0 8px/, 'the live dot has no glow');
  const durations = [...css.matchAll(/transition:[^;}]*?(\d?\.\d+)s/g)].map(match => Number(match[1]));
  assert.ok(durations.every(seconds => seconds <= 0.3), `UI transitions stay under 300 ms: ${durations.filter(s => s > 0.3)}`);
});
