// Firebase-independent sync primitives. Network orchestration stays in the
// renderer for now; these functions make snapshot decisions deterministic and
// easy to test before the full service is extracted.
(function exposeFirebaseSyncTools(global) {
  function orderedValue(value) {
    if (Array.isArray(value)) return value.map(orderedValue);
    if (value && typeof value === 'object') {
      if (typeof value.toJSON === 'function') return orderedValue(value.toJSON());
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedValue(value[key])]));
    }
    return value;
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
      || JSON.stringify(orderedValue(a)) === JSON.stringify(orderedValue(b));
  }

  function cloneLibrarySnapshot(games) {
    return (Array.isArray(games) ? games : []).map(game => ({
      ...game,
      sessions: Array.isArray(game.sessions)
        ? game.sessions.map(session => ({ ...session }))
        : []
    }));
  }

  function chooseRemoteLibrary(remoteGames, remoteTs, localGames, localTs) {
    const remoteAvailable = Array.isArray(remoteGames);
    const remote = remoteAvailable ? remoteGames : [];
    const local = Array.isArray(localGames) ? localGames : [];
    return remoteAvailable && (Number(remoteTs || 0) >= Number(localTs || 0) || !local.length)
      ? remote
      : local;
  }

  function shouldPromptForPendingConflict(pending, localGames, remoteGames) {
    return Boolean(pending) && Array.isArray(localGames) && Array.isArray(remoteGames)
      && !sameValue(localGames, remoteGames);
  }

  // Three-way merge against the last acknowledged cloud snapshot. A missing
  // baseline is intentionally not treated as an empty library: doing so could
  // turn a lost cache into a destructive overwrite.
  function reconcileLibraries(baseGames, localGames, remoteGames) {
    const equal = sameValue;
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    if (!Array.isArray(localGames) || !Array.isArray(remoteGames)) return { conflict: true };
    if (equal(localGames, remoteGames)) return { conflict: false, games: clone(remoteGames) };
    if (!Array.isArray(baseGames)) return { conflict: true };
    const toMap = list => {
      const map = new Map();
      for (const game of list) {
        const id = game && game.id != null ? String(game.id) : '';
        if (!id || map.has(id)) return null;
        map.set(id, game);
      }
      return map;
    };
    const base = toMap(baseGames), local = toMap(localGames), remote = toMap(remoteGames);
    if (!base || !local || !remote) return { conflict: true };
    const result = [];
    const ids = new Set([...remote.keys(), ...local.keys(), ...base.keys()]);
    for (const id of ids) {
      const b = base.get(id), l = local.get(id), r = remote.get(id);
      let merged;
      if (equal(l, r)) merged = l;
      else if (equal(l, b)) merged = r;
      else if (equal(r, b)) merged = l;
      else if (!b || !l || !r) return { conflict: true, gameId: id };
      else {
        merged = mergeGame(b, l, r, equal, clone);
        if (!merged) return { conflict: true, gameId: id };
      }
      if (merged) result.push(clone(merged));
    }
    return { conflict: false, games: result };
  }

  function mergeGame(base, local, remote, equal, clone) {
    const sessionId = session => `${session?.start ?? ''}:${session?.end ?? ''}:${session?.source ?? ''}`;
    const indexSessions = sessions => {
      if (!Array.isArray(sessions)) return null;
      const map = new Map();
      for (const session of sessions) {
        const key = sessionId(session);
        if (map.has(key)) return null;
        map.set(key, session);
      }
      return map;
    };
    const bs = indexSessions(base.sessions), ls = indexSessions(local.sessions), rs = indexSessions(remote.sessions);
    if (!bs || !ls || !rs) return null;
    for (const [key, session] of bs) {
      if (!equal(ls.get(key), session) || !equal(rs.get(key), session)) return null;
    }
    const sessions = new Map(rs);
    for (const [key, session] of ls) {
      if (sessions.has(key) && !equal(sessions.get(key), session)) return null;
      sessions.set(key, session);
    }
    const merged = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      if (key === 'sessions') continue;
      const b = base[key], l = local[key], r = remote[key];
      let value;
      if (equal(l, r)) value = l;
      else if (equal(l, b)) value = r;
      else if (equal(r, b)) value = l;
      else if (key === 'playtime') {
        const baseTime = Number(b), localTime = Number(l), remoteTime = Number(r);
        const localDelta = [...ls].filter(([id]) => !bs.has(id)).reduce((sum, [, session]) => sum + Number(session?.dur || 0), 0);
        const remoteDelta = [...rs].filter(([id]) => !bs.has(id)).reduce((sum, [, session]) => sum + Number(session?.dur || 0), 0);
        if (![baseTime, localTime, remoteTime].every(Number.isFinite)
          || localTime - baseTime !== localDelta || remoteTime - baseTime !== remoteDelta) return null;
        value = baseTime + [...sessions].filter(([id]) => !bs.has(id)).reduce((sum, [, session]) => sum + Number(session?.dur || 0), 0);
      } else if (key === 'lastPlayed' && ls.size > bs.size && rs.size > bs.size
        && Number.isFinite(Number(l)) && Number.isFinite(Number(r))) value = Math.max(Number(l), Number(r));
      else return null;
      if (value !== undefined) merged[key] = clone(value);
    }
    merged.sessions = [...sessions.values()].map(clone).sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    return merged;
  }

  async function writeLibrarySnapshot({ setDoc, ref, uid, games, ts, statsDashboard, schemaVersion = 1, canonicalPayload }) {
    if (typeof setDoc !== 'function' || !ref || !uid) throw new Error('Firebase sync writer is missing required context.');
    await setDoc(ref, canonicalPayload || {
      games: cloneLibrarySnapshot(games), schemaVersion, ts, ownerUid: uid, statsDashboard
    }, { merge: true });
  }

  async function commitLibraryTransaction({ runTransaction, db, ref, baseGames, localGames, extractGames, buildPayload, forceLocalAgainst }) {
    if (typeof runTransaction !== 'function' || !db || !ref || typeof extractGames !== 'function' || typeof buildPayload !== 'function') {
      throw new Error('Firebase transaction is missing required context.');
    }
    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      const remote = snapshot.exists() ? snapshot.data() : null;
      const remoteGames = remote ? extractGames(remote) : [];
      const merged = forceLocalAgainst
        ? sameValue(forceLocalAgainst, remoteGames)
          ? { conflict: false, games: cloneLibrarySnapshot(localGames) }
          : { conflict: true }
        : !remote && (localGames.length || baseGames?.length)
          ? { conflict: true }
          : reconcileLibraries(baseGames, localGames, remoteGames);
      if (merged.conflict) {
        const error = new Error('Library sync needs user resolution.');
        error.code = 'sync-conflict';
        error.remoteGames = remoteGames;
        error.remoteTs = Number(remote?.ts || 0);
        throw error;
      }
      const ts = Math.max(Date.now(), Number(remote?.ts || 0) + 1);
      transaction.set(ref, buildPayload(merged.games, ts), { merge: true });
      return { games: merged.games, ts };
    });
  }

  function createFirebaseSyncQueue({ isCurrentUser, isBusy, isOffline, onStatus, onRetry, minDelay = 5000, maxDelay = 60000, timerApi = global }) {
    let timer = null;
    let delay = minDelay;
    const clear = () => {
      if (timer !== null) timerApi.clearTimeout(timer);
      timer = null;
      delay = minDelay;
    };
    const schedule = (user, reason = 'network') => {
      if (!isCurrentUser(user) || timer !== null) return;
      const wait = isOffline() ? Math.max(delay, 10000) : delay;
      onStatus(isOffline() ? 'off' : 'err', reason, wait);
      timer = timerApi.setTimeout(() => {
        timer = null;
        Promise.resolve(onRetry(user)).catch(() => {});
      }, wait);
      delay = Math.min(Math.max(delay * 2, 10000), maxDelay);
    };
    const retryNow = user => {
      if (!isCurrentUser(user) || isBusy()) return;
      clear();
      Promise.resolve(onRetry(user)).catch(() => {});
    };
    return { clear, schedule, retryNow, getState: () => ({ pending: timer !== null, delay }) };
  }

  global.createFirebaseSyncTools = () => ({ sameValue, cloneLibrarySnapshot, chooseRemoteLibrary, shouldPromptForPendingConflict, reconcileLibraries, writeLibrarySnapshot, commitLibraryTransaction, createFirebaseSyncQueue });
})(window);
