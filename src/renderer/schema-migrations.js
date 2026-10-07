// Versioned library/profile migrations. Every migration is pure and
// idempotent, so local cache, cloud snapshots and backups use the same rules.
(function exposeSchemaMigrations(global) {
  const CURRENT_SCHEMA_VERSION = 3;

  function normalizeSession(session) {
    const value = session && typeof session === 'object' ? session : {};
    const start = Number(value.start) || 0;
    const end = Number(value.end) || (start ? start + (Number(value.dur) || 0) : 0);
    const dur = Math.max(0, Number(value.dur) || (end && start ? end - start : 0));
    return { ...value, start, end, dur, source: value.source || 'manual' };
  }

  function normalizeGame(game, index) {
    const value = game && typeof game === 'object' ? game : {};
    const title = String(value.title || '').trim() || `Untitled game ${index + 1}`;
    const sessions = Array.isArray(value.sessions) ? value.sessions.map(normalizeSession) : [];
    return {
      ...value,
      id: String(value.id || `migrated-${index + 1}`),
      title,
      status: ['Playing', 'Backlog', 'Completed', 'QuickPlay'].includes(value.status) ? value.status : 'Backlog',
      platform: value.platform || 'PC',
      platforms: Array.isArray(value.platforms) ? [...new Set(value.platforms.filter(Boolean))] : (value.platform ? [value.platform] : ['PC']),
      genres: Array.isArray(value.genres) ? value.genres : [],
      tags: Array.isArray(value.tags) ? value.tags : [],
      sources: Array.isArray(value.sources) ? value.sources : [],
      sessions,
      playtime: Math.max(0, Number(value.playtime) || sessions.reduce((sum, session) => sum + session.dur, 0)),
      lastPlayed: Number(value.lastPlayed) || (sessions.length ? Math.max(...sessions.map(session => session.end || session.start || 0)) : null),
      added: Number(value.added) || Date.now()
    };
  }

  function migrateGames(games) {
    const input = Array.isArray(games) ? games : [];
    return input.map(normalizeGame);
  }

  function migrateProfileSnapshot(snapshot) {
    const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const version = Number(value.schemaVersion) || 1;
    return {
      ...value,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      games: migrateGames(value.games)
    };
  }

  global.createSchemaMigrations = () => ({ CURRENT_SCHEMA_VERSION, normalizeSession, normalizeGame, migrateGames, migrateProfileSnapshot });
})(window);
