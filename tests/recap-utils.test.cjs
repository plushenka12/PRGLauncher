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

test('weekly wrapped sums the last seven days and compares with the week before', () => {
  const now = new Date(2026, 9, 25, 12, 0).getTime();
  const at = (daysAgo, hour) => new Date(2026, 9, 25 - daysAgo, hour, 0).getTime();
  const session = (daysAgo, hour, hours, source = 'steam') => ({ start: at(daysAgo, hour), end: at(daysAgo, hour) + hours * 3600000, dur: hours * 3600000, source });
  const games = [
    { id: 'hades', title: 'Hades II', steamAppId: 1145350, sessions: [session(0, 9, 2), session(2, 20, 3.5), session(9, 20, 4)] },
    { id: 'balatro', title: 'Balatro', sessions: [session(1, 22, 1)] },
    { id: 'mario', title: 'Mario Kart', sessions: [session(3, 0, 6, 'nintendo-sync')] },
    { id: 'old', title: 'Old', sessions: [session(20, 10, 9)] },
  ];
  const wrapped = recap.buildWeeklyWrapped({ games, now });
  assert.equal(wrapped.id, '2026-10-25');
  assert.equal(wrapped.playtime, (2 + 3.5 + 1 + 6) * 3600000);
  assert.equal(wrapped.previousPlaytime, 4 * 3600000, 'only the 7 days before the window');
  assert.equal(wrapped.sessions, 3, 'Nintendo daily records are not sessions');
  assert.equal(wrapped.games, 3);
  assert.equal(wrapped.activeDays, 4);
  assert.equal(wrapped.days.length, 7);
  assert.equal(wrapped.days[6].date, '2026-10-25');
  assert.equal(wrapped.days[6].playtime, 2 * 3600000);
  assert.equal(wrapped.top.gameId, 'mario');
  assert.equal(wrapped.top.share, Math.round(6 / 12.5 * 100));
  assert.deepEqual({ ...wrapped.longest }, { gameId: 'hades', title: 'Hades II', dur: 3.5 * 3600000, start: at(2, 20) }, 'a Nintendo day is never the longest session');
});

test('weekly wrapped is empty when nothing was played this week', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(recap.buildWeeklyWrapped({ games: [{ id: 'a', sessions: [{ start: now - 30 * 86400000, dur: 3600000 }] }], now }), null);
  assert.equal(recap.buildWeeklyWrapped({ games: [], now }), null);
});
