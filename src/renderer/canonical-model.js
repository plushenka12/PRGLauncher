// Canonical cloud/profile model. Legacy root fields remain intentionally
// present so older PRGLauncher builds can still read the same document.
(function exposeCanonicalModel(global) {
  function clone(value) {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function splitSessions(games) {
    const sessions = {};
    (Array.isArray(games) ? games : []).forEach(game => {
      sessions[String(game.id)] = clone(Array.isArray(game.sessions) ? game.sessions : []);
    });
    return sessions;
  }

  function buildCanonicalSnapshot({ games, profile = {}, integrations = {}, statsDashboard, ownerUid, ts, schemaVersion = 3 }) {
    const normalizedGames = clone(Array.isArray(games) ? games : []);
    return {
      schemaVersion,
      ownerUid,
      ts,
      profile: clone(profile),
      integrations: clone(integrations),
      games: normalizedGames,
      sessions: splitSessions(normalizedGames),
      statsDashboard
    };
  }

  function extractGames(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const games = clone(Array.isArray(source.games) ? source.games : []);
    const sessions = source.sessions && typeof source.sessions === 'object' ? source.sessions : {};
    return games.map(game => {
      const ownSessions = sessions[String(game.id)];
      return Array.isArray(ownSessions) ? { ...game, sessions: clone(ownSessions) } : game;
    });
  }

  // Merge append-only session events from a local/offline snapshot into a
  // newer remote snapshot without duplicating the same event.
  function mergeSessionDelta(localGames, remoteGames) {
    const localById = new Map((Array.isArray(localGames) ? localGames : []).map(game => [String(game.id), game]));
    return (Array.isArray(remoteGames) ? remoteGames : []).map(remote => {
      const local = localById.get(String(remote.id));
      if (!local) return clone(remote);
      const sessions = [...(Array.isArray(remote.sessions) ? remote.sessions : []), ...(Array.isArray(local.sessions) ? local.sessions : [])];
      const seen = new Set();
      const merged = sessions.filter(session => {
        const key = `${session?.start || 0}:${session?.end || 0}:${session?.source || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => Number(a?.start || 0) - Number(b?.start || 0));
      return { ...clone(remote), sessions: merged };
    });
  }

  global.createCanonicalModel = () => ({ clone, splitSessions, buildCanonicalSnapshot, extractGames, mergeSessionDelta });
})(window);
