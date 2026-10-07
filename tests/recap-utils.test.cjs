const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/recap-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'recap-utils.js' });
const recap = context.window.createRecapUtils();

test('builds deterministic yearly recap data from sessions', () => {
  const games = [{ id: 'g1', title: 'A', platform: 'PC', status: 'Completed', playtime: 5400000, sessions: [{ start: Date.parse('2026-01-02T10:00:00Z'), end: Date.parse('2026-01-02T11:00:00Z'), dur: 3600000, source: 'steam' }, { start: Date.parse('2026-01-03T10:00:00Z'), end: Date.parse('2026-01-03T10:30:00Z'), dur: 1800000, source: 'steam' }] }];
  const dashboard = recap.buildStatsDashboard({ games, now: 123 });
  assert.equal(dashboard.updatedAt, 123);
  assert.equal(dashboard.totals.sessions, 2);
  assert.equal(dashboard.totals.completed, 1);
  assert.equal(dashboard.yearly[2026].playtime, 5400000);
  assert.equal(dashboard.yearly[2026].activeDays, 2);
  assert.deepEqual(Array.from(dashboard.yearly[2026].monthly.slice(0, 2)), [5400000, 0]);
});
