const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/stats-year.js', 'utf8'), context);
const { buildYearStats } = context.window.createYearStats();

test('annual overview excludes sessions from other years', () => {
  const games = [
    { id: 'old', sessions: [{ start: '2025-03-01T10:00:00', dur: 8 * 3600000 }] },
    { id: 'new', sessions: [{ start: '2026-04-01T10:00:00', dur: 2 * 3600000 }, { start: '2026-04-02T10:00:00', dur: 3600000 }] },
  ];
  const stats = buildYearStats(games, 2026);
  assert.equal(stats.sessions.length, 2);
  assert.equal(stats.yearMs, 3 * 3600000);
  assert.equal(stats.longest.game.id, 'new');
  assert.equal(stats.recurring.game.id, 'new');
  assert.equal(stats.recurring.count, 2);
  assert.equal(stats.months[3], 3 * 3600000);
  assert.equal(stats.activeDays.size, 2);
});

test('empty year has no invented favorite or longest session', () => {
  const stats = buildYearStats([{ id: 'old', sessions: [{ start: '2025-01-01T10:00:00', dur: 1000 }] }], 2026);
  assert.equal(stats.yearGames.length, 0);
  assert.equal(stats.longest, null);
  assert.equal(stats.recurring, null);
});
