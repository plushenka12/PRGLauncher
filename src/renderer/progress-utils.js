// Pure progress helpers: status suggestions for a game and the owner's pace
// against HowLongToBeat with a backlog forecast. Rendering stays in app.js;
// nothing here changes a game, so it can be tested in Node.
(function exposeProgressUtils(global) {
  const DAY = 24 * 60 * 60 * 1000;
  const STALE_DAYS = 30;
  const RECENT_DAYS = 90;
  const MIN_PACE_SAMPLES = 3;

  function mainStoryMs(game) {
    const hltb = game && game.hltb;
    if (!hltb || hltb.hidden) return 0;
    const minutes = Number(hltb.mainStoryMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60000 : 0;
  }

  // A suggestion only: the owner accepts it or dismisses it. "Done" is kept
  // dismissed for the HLTB match it was about; "stale" until the game is
  // played again.
  function suggestStatus(game, { now = Date.now(), activeGameId = null, staleDays = STALE_DAYS } = {}) {
    if (!game || game.status !== 'Playing' || game.id === activeGameId) return null;
    const hints = game.statusHints && typeof game.statusHints === 'object' ? game.statusHints : {};
    const main = mainStoryMs(game);
    const played = Math.max(0, Number(game.playtime) || 0);
    if (main && played >= main && hints.done !== String(game.hltb.id ?? 'hltb')) {
      return { kind: 'done', to: 'Completed', percent: Math.round(played / main * 100) };
    }
    const last = Number(game.lastPlayed) || 0;
    const days = last ? Math.floor((now - last) / DAY) : 0;
    if (last && days >= staleDays && hints.stale !== last) return { kind: 'stale', to: 'Backlog', days };
    return null;
  }

  // What dismissing a suggestion stores on the game.
  function dismissHint(game, kind) {
    const hints = { ...(game.statusHints && typeof game.statusHints === 'object' ? game.statusHints : {}) };
    if (kind === 'done') hints.done = String(game.hltb?.id ?? 'hltb');
    if (kind === 'stale') hints.stale = Number(game.lastPlayed) || 0;
    return hints;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Pace is the median of playtime / HLTB Main Story over completed games.
  // Ratios outside 0.2–5 are mostly wrong matches or imported totals, so they
  // are left out. With fewer than three samples HLTB is taken as is.
  function buildPace(games = [], { now = Date.now() } = {}) {
    const list = Array.isArray(games) ? games : [];
    const ratios = [];
    for (const game of list) {
      const main = mainStoryMs(game);
      const played = Number(game?.playtime) || 0;
      if (game?.status !== 'Completed' || !main || played <= 0) continue;
      const ratio = played / main;
      if (ratio >= 0.2 && ratio <= 5) ratios.push(ratio);
    }
    const measured = ratios.length >= MIN_PACE_SAMPLES;
    const pace = measured ? median(ratios) : 1;

    let remainingMs = 0, withHltb = 0, missing = 0;
    const closest = [];
    for (const game of list) {
      if (game?.status !== 'Backlog' && game?.status !== 'Playing') continue;
      const main = mainStoryMs(game);
      if (!main) { missing += 1; continue; }
      withHltb += 1;
      const left = Math.max(0, main * pace - (Number(game.playtime) || 0));
      remainingMs += left;
      if (game.status === 'Playing' && left > 0) closest.push({ game, leftMs: left });
    }
    closest.sort((a, b) => a.leftMs - b.leftMs);

    const since = now - RECENT_DAYS * DAY;
    let recentMs = 0;
    for (const game of list) {
      for (const session of Array.isArray(game?.sessions) ? game.sessions : []) {
        if (Number(session?.start) >= since && Number(session.start) <= now) recentMs += Math.max(0, Number(session.dur) || 0);
      }
    }
    const weeklyMs = recentMs / (RECENT_DAYS / 7);
    const weeks = weeklyMs > 0 && remainingMs > 0 ? remainingMs / weeklyMs : null;
    return {
      pace, measured, samples: ratios.length,
      remainingMs, withHltb, missing,
      weeklyMs, weeks, finishAt: weeks == null ? null : now + weeks * 7 * DAY,
      closest: closest.slice(0, 3),
    };
  }

  global.createProgressUtils = () => ({ suggestStatus, dismissHint, buildPace, STALE_DAYS });
})(typeof window !== 'undefined' ? window : globalThis);
