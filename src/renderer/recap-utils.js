// Pure Recap/statistics aggregation. Rendering stays in index.html; this
// module owns only deterministic data shaping so it can be tested in Node.
(function exposeRecapUtils(global) {
  function buildPublicReviews(games = []) {
    return (Array.isArray(games) ? games : []).filter(game => game?.review?.public === true && String(game.review.markdown || '').trim() && String(game.review.markdown).length <= 3000).map(game => ({
      gameId: String(game.id || ''),
      title: String(game.title || ''),
      cover: typeof game.cover === 'string' ? game.cover : null,
      rating: game.rating != null && Number.isFinite(Number(game.rating)) ? Number(game.rating) : null,
      markdown: String(game.review.markdown).trim().slice(0, 3000),
      updatedAt: Number(game.review.updatedAt) || null
    }));
  }
  // A separate, deliberately small guest-facing projection. Never spread a
  // game object here: records may contain notes, launch paths and account IDs.
  function buildPublicLibrary(games = []) {
    const safeText = (value, limit) => String(value || '').trim().slice(0, limit);
    const safeCover = value => {
      if (typeof value !== 'string') return null;
      try { const url = new URL(value); return url.protocol === 'https:' && value.length <= 2048 ? value : null; }
      catch { return null; }
    };
    const positive = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const statuses = new Set(['Playing', 'Backlog', 'Completed', 'QuickPlay']);
    return (Array.isArray(games) ? games : []).filter(game => game && safeText(game.title, 200)).map(game => ({
      gameId: safeText(game.id, 100),
      title: safeText(game.title, 200),
      cover: safeCover(game.cover),
      status: statuses.has(game.status) ? game.status : 'Backlog',
      platform: safeText(game.platform, 60) || null,
      platforms: [...new Set((Array.isArray(game.platforms) ? game.platforms : [game.platform]).map(value => safeText(value, 60)).filter(Boolean))].slice(0, 8),
      rating: game.rating != null && Number.isFinite(Number(game.rating)) ? Math.min(10, Math.max(0, Number(game.rating))) : null,
      playtime: positive(game.playtime),
      sessions: Array.isArray(game.sessions) ? game.sessions.length : 0,
      hltbMainMinutes: game.hltb?.hidden ? null : positive(game.hltb?.mainStoryMinutes) || null
    }));
  }
  function choosePublicLibraryConsent(remoteEnabled, localChoice, forceLocal = false) {
    return forceLocal ? localChoice === '1' : remoteEnabled === true;
  }
  function buildStatsDashboard({ games = [], now = Date.now() } = {}) {
    const list = Array.isArray(games) ? games : [];
    const allSessions = list.flatMap(game => (Array.isArray(game.sessions) ? game.sessions : []).map(session => ({ ...session, title: game.title, cover: game.cover || null })));
    const totalPlaytime = list.reduce((sum, game) => sum + Number(game.playtime || 0), 0);
    const status = { Playing: 0, Backlog: 0, Completed: 0, QuickPlay: 0 };
    const platforms = {};
    const genres = {};
    const activity = {};
    list.forEach(game => {
      if (Object.prototype.hasOwnProperty.call(status, game.status)) status[game.status]++;
      if (game.platform) platforms[game.platform] = (platforms[game.platform] || 0) + 1;
      (Array.isArray(game.genres) ? game.genres : []).forEach(genre => { genres[genre] = (genres[genre] || 0) + 1; });
    });
    allSessions.forEach(session => {
      const key = new Date(session.start).toISOString().slice(0, 10);
      activity[key] = (activity[key] || 0) + Number(session.dur || 0);
    });
    const recentSessions = [...allSessions].sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0)).slice(0, 8).map(session => ({ title: session.title, cover: session.cover, start: session.start, duration: session.dur || 0 }));
    const topGames = [...list].sort((a, b) => Number(b.playtime || 0) - Number(a.playtime || 0)).slice(0, 6).map(game => ({ title: game.title, cover: game.cover || null, playtime: game.playtime || 0, sessions: (game.sessions || []).length, status: game.status || 'Backlog', platform: game.platform || null }));
    const activityDays = Object.entries(activity).sort(([a], [b]) => a.localeCompare(b)).slice(-365).map(([date, playtime]) => ({ date, playtime }));
    const yearlyMap = new Map();
    const ensureYear = year => {
      if (!yearlyMap.has(year)) yearlyMap.set(year, { games: new Map(), sessions: 0, playtime: 0, activeDays: new Set(), monthly: Array.from({ length: 12 }, () => 0), firstPlayedAt: null, lastPlayedAt: null });
      return yearlyMap.get(year);
    };
    const undatedPlaytime = list.filter(game => !(game.sessions || []).length && Number(game.playtime) > 0).reduce((sum, game) => sum + Number(game.playtime || 0), 0);
    list.forEach(game => {
      (Array.isArray(game.sessions) ? game.sessions : []).forEach(session => {
        const start = Number(session.start) || 0;
        if (!start) return;
        const date = new Date(start);
        const year = date.getFullYear();
        const bucket = ensureYear(year);
        const current = bucket.games.get(game.id) || { playtime: 0, sessions: 0, longestSession: 0, firstPlayedAt: null, lastPlayedAt: null };
        current.playtime += Number(session.dur || 0);
        current.sessions++;
        current.longestSession = Math.max(current.longestSession, Number(session.dur || 0));
        current.firstPlayedAt = current.firstPlayedAt ? Math.min(current.firstPlayedAt, start) : start;
        current.lastPlayedAt = current.lastPlayedAt ? Math.max(current.lastPlayedAt, start) : start;
        bucket.games.set(game.id, current);
        bucket.sessions++;
        bucket.playtime += Number(session.dur || 0);
        bucket.firstPlayedAt = bucket.firstPlayedAt ? Math.min(bucket.firstPlayedAt, start) : start;
        bucket.lastPlayedAt = bucket.lastPlayedAt ? Math.max(bucket.lastPlayedAt, start) : start;
        bucket.activeDays.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
        bucket.monthly[date.getMonth()] += Number(session.dur || 0);
      });
    });
    const yearly = Object.fromEntries([...yearlyMap.entries()].map(([year, bucket]) => {
      const yearGames = [...bucket.games.entries()].map(([id, stats]) => {
        const game = list.find(item => item.id === id);
        return game ? { gameId: String(game.id), title: game.title, cover: game.cover || null, playtime: stats.playtime, sessions: stats.sessions, longestSession: stats.longestSession, firstPlayedAt: stats.firstPlayedAt, lastPlayedAt: stats.lastPlayedAt, status: game.status || 'Backlog', platform: game.platform || null } : null;
      }).filter(Boolean).sort((a, b) => b.playtime - a.playtime);
      const days = [...bucket.activeDays].sort();
      let longestStreak = 0; let currentStreak = 0; let previous = null;
      days.forEach(day => {
        const stamp = Date.parse(`${day}T00:00:00`);
        currentStreak = previous !== null && stamp - previous === 86400000 ? currentStreak + 1 : 1;
        longestStreak = Math.max(longestStreak, currentStreak);
        previous = stamp;
      });
      return [year, { year, playtime: bucket.playtime, sessions: bucket.sessions, averageSession: bucket.sessions ? Math.round(bucket.playtime / bucket.sessions) : 0, activeDays: bucket.activeDays.size, longestStreak, firstPlayedAt: bucket.firstPlayedAt, lastPlayedAt: bucket.lastPlayedAt, monthly: bucket.monthly, games: yearGames }];
    }));
    return {
      version: 2,
      updatedAt: now,
      yearly,
      totals: { games: list.length, playtime: totalPlaytime, undatedPlaytime, steamPlaytime: list.filter(game => game.steamAppId || game.platform === 'PC').reduce((sum, game) => sum + Number(game.playtime || 0), 0), nintendoPlaytime: list.filter(game => game.tags?.includes('Nintendo Sync') || game.platform?.startsWith('Nintendo')).reduce((sum, game) => sum + Number(game.playtime || 0), 0), sessions: allSessions.length, completed: status.Completed, backlog: status.Backlog, playing: status.Playing, completionRate: list.length ? Math.round(status.Completed / list.length * 100) : 0 },
      topGames,
      recentSessions,
      status,
      platforms,
      genres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
      activity: activityDays
    };
  }

  // The mini-tab's daily "Wrapped": the last seven days ending now. Nintendo
  // Sync stores one record per played day, so those count towards time and
  // active days but never as the "longest session".
  function buildWeeklyWrapped({ games = [], now = Date.now() } = {}) {
    const day = 86400000;
    const from = now - 7 * day;
    const previousFrom = from - 7 * day;
    const dateKey = stamp => { const d = new Date(stamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const stamp = startOfToday - (6 - index) * day;
      return { date: dateKey(stamp), weekday: new Date(stamp).getDay(), playtime: 0 };
    });
    const byDate = new Map(days.map(entry => [entry.date, entry]));
    const perGame = new Map();
    let playtime = 0;
    let previousPlaytime = 0;
    let sessions = 0;
    let longest = null;
    (Array.isArray(games) ? games : []).forEach(game => {
      (Array.isArray(game.sessions) ? game.sessions : []).forEach(session => {
        const start = Number(session.start) || 0;
        const dur = Math.max(0, Number(session.dur) || 0);
        if (!start || !dur || start > now) return;
        if (start >= previousFrom && start < from) { previousPlaytime += dur; return; }
        if (start < from) return;
        playtime += dur;
        const bucket = byDate.get(dateKey(start));
        if (bucket) bucket.playtime += dur;
        const stats = perGame.get(game.id) || { playtime: 0, sessions: 0 };
        stats.playtime += dur;
        if (session.source !== 'nintendo-sync') {
          stats.sessions++;
          sessions++;
          if (!longest || dur > longest.dur) longest = { gameId: String(game.id), title: game.title, dur, start };
        }
        perGame.set(game.id, stats);
      });
    });
    if (!playtime) return null;
    const ranked = [...perGame.entries()].sort((a, b) => b[1].playtime - a[1].playtime);
    const [topId, topStats] = ranked[0];
    const topGame = (Array.isArray(games) ? games : []).find(game => game.id === topId) || {};
    return {
      id: dateKey(now),
      from,
      to: now,
      playtime,
      previousPlaytime,
      sessions,
      games: ranked.length,
      activeDays: days.filter(entry => entry.playtime > 0).length,
      days,
      top: {
        gameId: String(topId),
        title: topGame.title || '',
        appId: topGame.steamAppId ? String(topGame.steamAppId) : null,
        cover: topGame.cover || null,
        playtime: topStats.playtime,
        share: Math.round(topStats.playtime / playtime * 100),
      },
      longest,
    };
  }

  global.createRecapUtils = () => ({ buildStatsDashboard, buildPublicReviews, buildPublicLibrary, choosePublicLibraryConsent, buildWeeklyWrapped });
})(window);
