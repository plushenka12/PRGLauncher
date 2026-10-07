const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/nintendo-utils.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'nintendo-utils.js' });
const nintendo = context.window.createNintendoUtils();

test('normalizes Nintendo activity titles, minutes and platform', () => {
  const rows = nintendo.normalizeNintendoHistory({ playActivity: [{ titleId: '1', titleName: 'Zelda', totalPlayedHours: 2.5, platform: 'Switch 2' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Zelda');
  assert.equal(rows[0].minutes, 150);
  assert.equal(rows[0].platform, 'Nintendo Switch 2');
});

test('extracts unique daily Nintendo sessions', () => {
  const rows = nintendo.extractNintendoDaily({ history: [{ date: '2026-01-02', minutes: 30 }, { date: '2026-01-02', minutes: 30 }, { date: '2026-01-03', minutes: 15 }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows.map(row => row.minutes)), [30, 15]);
});
