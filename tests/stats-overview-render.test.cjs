const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('year overview keeps yearly details without repeating library-wide status panels', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const start = source.indexOf('function renderStatsOverview(){');
  const end = source.indexOf('function addMostReturnedStatsCard(', start);
  assert.ok(start >= 0 && end > start);

  const year = new Date().getFullYear();
  const monthNodes = [0, 4].map(index => ({ dataset: { statsMonth: String(index) }, classList: { toggle() {} }, setAttribute() {}, addEventListener(event, handler) { if (event === 'click') this.click = handler; } }));
  const root = { innerHTML: '', querySelectorAll: selector => selector === '[data-stats-month]' ? monthNodes : [] };
  const select = { addEventListener() {} };
  const monthDetail = { textContent: '' };
  const sandbox = {
    games: [{ id: 'zelda', title: 'The Legend of Zelda', platform: 'Nintendo Switch', cover: 'https://example.test/zelda.jpg', status: 'Playing', sessions: [
      { start: new Date(year, 4, 12).getTime(), dur: 7200000 },
      { start: new Date(year, 4, 13).getTime(), dur: 3600000 },
    ] }],
    document: { getElementById: id => id === 'year-recap' ? root : id === 'stats-year-select' ? select : id === 'stats-month-detail' ? monthDetail : null },
    localStorage: { getItem: () => String(year), setItem() {} },
    currentLanguage: 'uk',
    t: value => value,
    fmtHours: ms => `${(ms / 3600000).toFixed(1)}h`,
    escapeHltbHtml: value => String(value),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'stats-year.js'), 'utf8'), sandbox);
  sandbox.yearStats = sandbox.createYearStats();
  vm.runInContext(`${source.slice(start, end)}; renderStatsOverview();`, sandbox);

  assert.match(root.innerHTML, /stats-month-panel/);
  assert.match(root.innerHTML, /Середня сесія/);
  assert.match(root.innerHTML, /Найактивніший місяць: Тра/);
  assert.match(root.innerHTML, /Тра: 3\.0h · 2 сесій/);
  assert.match(root.innerHTML, /stats-details-grid/);
  assert.match(root.innerHTML, /stats-games/);
  assert.doesNotMatch(root.innerHTML, /Статуси бібліотеки|Персональні факти/);
  monthNodes[1].click();
  assert.match(monthDetail.textContent, /Тра: 3\.0h · 2 сесій/);
  assert.match(monthDetail.textContent, /The Legend of Zelda/);
});
