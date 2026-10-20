const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { URL, window: {} };
vm.runInNewContext(fs.readFileSync('web-dashboard/review-markdown.js', 'utf8'), context);
const render = context.window.PRGReviewMarkdown.render;

test('renders the review formatting used by launcher and guest site', () => {
  const html = render('### Враження\n\n**Сильна** історія і *гарна* музика.\n\n- Персонажі\n- Світ\n\n[HLTB](https://howlongtobeat.com/game/42)');
  assert.match(html, /<h5>Враження<\/h5>/);
  assert.match(html, /<strong>Сильна<\/strong>/);
  assert.match(html, /<em>гарна<\/em>/);
  assert.match(html, /<ul><li>Персонажі<\/li><li>Світ<\/li><\/ul>/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('never executes raw HTML or unsafe image/link syntax', () => {
  const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[insecure](http://example.com)');
  assert.doesNotMatch(html, /<img|<script|href="javascript:/);
  assert.doesNotMatch(html, /href="http:/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
});
