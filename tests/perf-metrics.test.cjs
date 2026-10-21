const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/perf-metrics.js', 'utf8'), context);

test('diagnostic timings contain only bounded numeric summaries', () => {
  let now = 10;
  const metrics = context.window.createPerfMetrics({ now: () => now });
  const finish = metrics.start('gridRender');
  now = 27.25;
  finish(138);
  metrics.record('gridRender', 8.04, 12);
  metrics.record('game title or email', 5, 1);
  metrics.record('cloudLibraryRead', Infinity, 20);
  const report = JSON.parse(JSON.stringify(metrics.snapshot()));
  assert.deepEqual(Object.keys(report.measures), ['gridRender']);
  assert.deepEqual(report.measures.gridRender,
    { count: 2, lastMs: 8, averageMs: 12.6, maxMs: 17.3, lastItems: 12 });
});

test('renderer includes numeric timings in opt-in diagnostics export', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.match(html, /<script src="\.\/perf-metrics\.js"><\/script>/);
  assert.match(html, /performance:perfMetrics\.snapshot\(\)/);
  assert.match(html, /perfMetrics\.record\('initialReady'/);
  assert.match(html, /perfMetrics\.start\('gridRender'\)/);
  assert.match(html, /perfMetrics\.start\('cloudLibraryRead'\)/);
});
