// Merges a 3DS upload (games with sessions, already parsed and checked by
// the main process) into the library. Every upload carries the console's
// whole history, so merging is idempotent: a session already imported for
// that game (same source and start) is skipped.
(function exposeN3dsUtils(global) {
  const PLATFORM = 'Nintendo 3DS';
  const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
  const cleanTitle = value => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  function findGame(games, item) {
    const key = cleanTitle(item.title);
    return games.find(game => game.n3dsTitleId === item.titleId)
      || games.find(game => !game.n3dsTitleId && game.platform === PLATFORM && key && cleanTitle(game.title) === key)
      || null;
  }

  function mergeUpload(games, upload, { now = Date.now(), makeId }) {
    const result = { added: [], updated: [], sessions: 0 };
    for (const item of Array.isArray(upload?.games) ? upload.games : []) {
      const incoming = (Array.isArray(item.sessions) ? item.sessions : [])
        .filter(session => Number.isFinite(session.start) && Number.isFinite(session.dur) && session.dur > 0 && session.start <= now);
      if (!item.titleId || !item.title || !incoming.length) continue;
      let game = findGame(games, item);
      const created = !game;
      if (created) {
        const last = Math.max(...incoming.map(session => session.end || session.start));
        // Old cartridges become session-only cards rather than filling "Playing".
        game = { id: makeId(), title: item.title, status: now - last <= RECENT_MS ? 'Playing' : 'QuickPlay', platform: PLATFORM, cover: null, notes: null, genres: [], tags: ['3DS Sync'], rating: null, steamAppId: null, playtime: 0, sessions: [], lastPlayed: null, added: now };
        games.unshift(game);
      }
      game.n3dsTitleId = item.titleId;
      game.sessions = Array.isArray(game.sessions) ? game.sessions : [];
      const linked = game.sessions.filter(session => session.source === '3ds');
      const known = new Set(linked.map(session => session.start));
      let added = 0, addedMs = 0;
      for (const session of incoming) {
        if (known.has(session.start)) continue;
        known.add(session.start);
        game.sessions.push({ start: session.start, end: session.end, dur: session.dur, source: '3ds' });
        game.lastPlayed = Math.max(Number(game.lastPlayed || 0), session.end || session.start);
        addedMs += session.dur;
        added += 1;
      }
      // The console log goes back years, so on the first link it already
      // covers time the owner may have typed in by hand: the total becomes the
      // larger of the two instead of their sum. Later uploads add only new play.
      if (!linked.length && !created) {
        const other = game.sessions.filter(session => session.source !== '3ds').reduce((sum, session) => sum + (Number(session.dur) || 0), 0);
        game.playtime = Math.max(Number(game.playtime || 0), other + addedMs);
      } else game.playtime = Math.max(0, Number(game.playtime || 0) + addedMs);
      if (added) game.sessions.sort((a, b) => a.start - b.start);
      result.sessions += added;
      if (created) result.added.push(game);
      else if (added) result.updated.push(game);
    }
    return result;
  }

  global.createN3dsUtils = () => ({ mergeUpload, PLATFORM });
})(typeof window !== 'undefined' ? window : globalThis);
