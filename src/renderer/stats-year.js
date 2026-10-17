// Pure annual statistics used by the desktop overview.
(function exposeYearStats(global) {
  function buildYearStats(games, year) {
    const sessions = (games || []).flatMap(game => (game.sessions || [])
      .filter(session => new Date(session.start).getFullYear() === year)
      .map(session => ({ ...session, game })));
    const byGame = new Map();
    const sessionCounts = new Map();
    const months = Array.from({ length: 12 }, () => 0);
    const monthSessions = Array.from({ length: 12 }, () => 0);
    const activeDays = new Set();
    let longest = null;
    let yearMs = 0;

    sessions.forEach(session => {
      const duration = Math.max(0, Number(session.dur) || 0);
      const id = session.game.id;
      byGame.set(id, (byGame.get(id) || 0) + duration);
      sessionCounts.set(id, (sessionCounts.get(id) || 0) + 1);
      yearMs += duration;
      const date = new Date(session.start);
      months[date.getMonth()] += duration;
      monthSessions[date.getMonth()] += 1;
      activeDays.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
      if (!longest || duration > Math.max(0, Number(longest.dur) || 0)) longest = session;
    });

    const yearGames = (games || []).filter(game => byGame.has(game.id))
      .map(game => ({ game, ms: byGame.get(game.id), count: sessionCounts.get(game.id) }))
      .sort((a, b) => b.ms - a.ms);
    const recurring = [...yearGames].sort((a, b) => b.count - a.count || b.ms - a.ms)[0] || null;
    return { sessions, yearGames, yearMs, activeDays, months, monthSessions, longest, recurring };
  }

  global.createYearStats = () => ({ buildYearStats });
})(typeof window === 'undefined' ? globalThis : window);
