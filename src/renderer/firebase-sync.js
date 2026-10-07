// Firebase-independent sync primitives. Network orchestration stays in the
// renderer for now; these functions make snapshot decisions deterministic and
// easy to test before the full service is extracted.
(function exposeFirebaseSyncTools(global) {
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

  async function writeLibrarySnapshot({ setDoc, ref, uid, games, ts, statsDashboard, schemaVersion = 1, canonicalPayload }) {
    if (typeof setDoc !== 'function' || !ref || !uid) throw new Error('Firebase sync writer is missing required context.');
    await setDoc(ref, canonicalPayload || {
      games: cloneLibrarySnapshot(games), schemaVersion, ts, ownerUid: uid, statsDashboard
    }, { merge: true });
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

  global.createFirebaseSyncTools = () => ({ cloneLibrarySnapshot, chooseRemoteLibrary, writeLibrarySnapshot, createFirebaseSyncQueue });
})(window);
