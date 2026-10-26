const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source.cjs');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('src/renderer/progress-utils.js', 'utf8'), context, { filename: 'progress-utils.js' });
const progress = context.window.createProgressUtils();
const plain = value => JSON.parse(JSON.stringify(value));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-10-26T12:00:00Z');
const hltb = (hours, id = 7) => ({ id, mainStoryMinutes: hours * 60 });

test('a game played past HLTB Main Story is suggested as completed', () => {
  const game = { id: 'hk', status: 'Playing', playtime: 28 * HOUR, lastPlayed: now - DAY, hltb: hltb(27) };
  assert.deepEqual(plain(progress.suggestStatus(game, { now })), { kind: 'done', to: 'Completed', percent: 104 });
  assert.equal(progress.suggestStatus({ ...game, playtime: 20 * HOUR }, { now }), null);
  assert.equal(progress.suggestStatus({ ...game, hltb: { ...game.hltb, hidden: true } }, { now }), null, 'hidden HLTB is ignored');
  assert.equal(progress.suggestStatus({ ...game, status: 'Backlog' }, { now }), null, 'only Playing games get suggestions');
  assert.equal(progress.suggestStatus(game, { now, activeGameId: 'hk' }), null, 'never while the game runs');
});

test('a Playing game untouched for 30 days is suggested back to the backlog', () => {
  const game = { id: 'p5', status: 'Playing', playtime: 3 * HOUR, lastPlayed: now - 34 * DAY };
  assert.deepEqual(plain(progress.suggestStatus(game, { now })), { kind: 'stale', to: 'Backlog', days: 34 });
  assert.equal(progress.suggestStatus({ ...game, lastPlayed: now - 29 * DAY }, { now }), null);
  assert.equal(progress.suggestStatus({ ...game, lastPlayed: null }, { now }), null);
});

test('a dismissed suggestion stays hidden until something changes', () => {
  const stale = { id: 'p5', status: 'Playing', lastPlayed: now - 40 * DAY };
  stale.statusHints = progress.dismissHint(stale, 'stale');
  assert.equal(progress.suggestStatus(stale, { now }), null);
  assert.equal(progress.suggestStatus({ ...stale, lastPlayed: now - 35 * DAY }, { now })?.kind, 'stale', 'played again, then idle again');

  const done = { id: 'hk', status: 'Playing', playtime: 30 * HOUR, lastPlayed: now, hltb: hltb(27, 101) };
  done.statusHints = progress.dismissHint(done, 'done');
  assert.equal(progress.suggestStatus(done, { now }), null);
  assert.equal(progress.suggestStatus({ ...done, hltb: hltb(27, 202) }, { now })?.kind, 'done', 'a new HLTB match asks again');
  assert.deepEqual(plain(progress.dismissHint({ statusHints: { stale: 5 }, hltb: hltb(1, 9) }, 'done')), { stale: 5, done: '9' }, 'other hints are kept');
});

test('pace is the median playtime against HLTB over completed games', () => {
  const completed = [[8, 10], [9, 10], [12, 10], [100, 10]].map(([played, main], index) => ({ id: `c${index}`, status: 'Completed', playtime: played * HOUR, hltb: hltb(main) }));
  const result = progress.buildPace(completed, { now });
  assert.equal(result.samples, 3, 'a 10× outlier is left out');
  assert.equal(result.measured, true);
  assert.equal(result.pace, 0.9);
  const few = progress.buildPace(completed.slice(0, 2), { now });
  assert.equal(few.measured, false);
  assert.equal(few.pace, 1, 'HLTB as is with fewer than three samples');
});

test('the backlog forecast uses the pace and the last 90 days of play', () => {
  const completed = [8, 8, 8].map((played, index) => ({ id: `c${index}`, status: 'Completed', playtime: played * HOUR, hltb: hltb(10) }));
  const sessions = Array.from({ length: 13 }, (_, week) => ({ start: now - (week * 7 + 1) * DAY, dur: 5 * HOUR }));
  const games = [
    ...completed,
    { id: 'b1', status: 'Backlog', playtime: 0, hltb: hltb(50) },
    { id: 'p1', status: 'Playing', playtime: 6 * HOUR, hltb: hltb(10), sessions },
    { id: 'p2', status: 'Playing', playtime: 1 * HOUR, hltb: hltb(30) },
    { id: 'b2', status: 'Backlog', playtime: 0 },
    { id: 'q', status: 'QuickPlay', playtime: 0, hltb: hltb(99) },
    { id: 'old', status: 'Completed', playtime: 0, sessions: [{ start: now - 200 * DAY, dur: 100 * HOUR }] },
  ];
  const result = progress.buildPace(games, { now });
  assert.equal(result.pace, 0.8);
  assert.equal(result.withHltb, 3);
  assert.equal(result.missing, 1);
  // 50×0.8 + (8−6) + (24−1) = 65 hours left.
  assert.equal(Math.round(result.remainingMs / HOUR), 65);
  assert.equal(Math.round(result.weeklyMs / HOUR * 100) / 100, 5.06);
  assert.equal(Math.round(result.weeks), 13);
  assert.deepEqual(plain(result.closest.map(item => item.game.id)), ['p1', 'p2']);
  assert.equal(progress.buildPace([{ id: 'b', status: 'Backlog', hltb: hltb(5) }], { now }).weeks, null, 'no recent play, no forecast');
});

test('the renderer shows suggestions on the card and the game page and the pace panel on stats', () => {
  const renderer = rendererSource();
  assert.match(renderer, /<script src="\.\/progress-utils\.js"><\/script>/);
  assert.match(renderer, /id="d-status-hint"/);
  assert.match(renderer, /progressUtils\.suggestStatus\(game,\{activeGameId\}\)\?\.kind/, 'the card is rebuilt when a suggestion appears');
  const hint = renderer.slice(renderer.indexOf('function renderStatusHint(game){'), renderer.indexOf('function closeDetail('));
  assert.doesNotMatch(hint, /innerHTML/, 'titles and text are set as text');
  assert.match(hint, /setGameStatus\(game\.id,hint\.to\)/);
  assert.match(hint, /game\.statusHints=progressUtils\.dismissHint\(game,hint\.kind\);save\(\);pushToFb\(\)/);
  const pace = renderer.slice(renderer.indexOf('function addPaceStatsPanel(){'), renderer.indexOf('function renderStatsPage(){'));
  assert.doesNotMatch(pace, /innerHTML/);
  assert.match(renderer, /if\(stats\)addPaceStatsPanel\(\);/);
  for (const phrase of ['Темп і беклог', 'Найближче до фінішу', 'Сховати підказку']) assert.match(renderer, new RegExp(`\\['${phrase}','[^']+'\\]`), phrase);
});
