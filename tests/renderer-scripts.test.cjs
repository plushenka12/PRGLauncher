const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Both launcher pages run with script-src 'self': no inline scripts or handlers.
test('launcher pages load their scripts from files and forbid inline script', () => {
  for (const [page, script] of [['index.html', 'app.js'], ['mini-bar.html', 'mini-bar.js']]) {
    const html = fs.readFileSync(`src/renderer/${page}`, 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /script-src 'self'(;| https:\/\/www\.gstatic\.com;)/, page);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page} has no inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${page} has no inline handlers`);
    assert.ok(html.includes(`<script src="./${script}"></script>`), `${page} loads ${script}`);
    assert.doesNotMatch(fs.readFileSync(`src/renderer/${script}`, 'utf8'), /<[a-z][^>]*\son[a-z]+=["'\\]/, `${script} builds no markup with inline handlers`);
  }
});

test('extracted page scripts parse', () => {
  for (const script of ['app.js', 'mini-bar.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(`src/renderer/${script}`, 'utf8'), { filename: script }), script);
  }
});
