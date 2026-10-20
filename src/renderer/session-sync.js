// Generation-scoped game metadata and independent session documents. The
// previous cloud representation is kept until every new document is written.
(function exposeSessionSync(global) {
  const MODE = 'games-sessions-v1';
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sumTime = sessions => (sessions || []).reduce((total, session) => total + Number(session.dur || 0), 0);

  function safeId(prefix, value) {
    const encoded = encodeURIComponent(String(value ?? ''));
    if (!encoded || encoded.length > 1400) throw new Error('Invalid cloud document ID.');
    return `${prefix}${encoded}`;
  }

  // IDs include the generation so two overlapping migrations cannot overwrite
  // each other's documents even if an old lease expires mid-copy.
  function gameDocumentId(id, generation) { return safeId('g_', generation ? `${generation}:${id}` : id); }
  function sessionKey(session) {
    return `${session?.start ?? ''}:${session?.end ?? ''}:${session?.source ?? ''}`;
  }
  function sessionIndex(sessions) {
    if (!Array.isArray(sessions)) throw new Error('Game sessions are not an array.');
    const occurrences = new Map(), result = new Map();
    for (const session of sessions) {
      const identity = sessionKey(session);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      result.set(`${identity}#${occurrence}`, session);
    }
    return result;
  }
  function sessionDocumentId(gameId, key, generation) {
    const encodedGame = encodeURIComponent(String(gameId));
    return safeId('s_', `${generation || ''}:${encodedGame.length}:${encodedGame}:${key}`);
  }
  function indexGames(games) {
    if (!Array.isArray(games)) throw new Error('Library is not a game array.');
    const result = new Map();
    for (const game of games) {
      const id = String(game?.id ?? '');
      gameDocumentId(id);
      if (result.has(id)) throw new Error('Duplicate game ID in library.');
      result.set(id, game);
    }
    return result;
  }
  function splitGame(game) {
    if (!game) return undefined;
    const { sessions, playtime, _syncSessionRevision, ...metadata } = clone(game);
    return { game: metadata, playtimeOffset: Number(playtime || 0) - sumTime(sessions),
      sessionRevision: Number(_syncSessionRevision || 0) };
  }
  function joinGame(record, sessions) {
    const ordered = [...sessions].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    return { ...clone(record.game), sessions: ordered.map(clone),
      playtime: Math.max(0, Number(record.playtimeOffset || 0) + sumTime(ordered)),
      _syncSessionRevision: Number(record.sessionRevision || 0) };
  }

  function gamesFromDocuments(gameDocs, sessionDocs, generation, orderIds = []) {
    const records = new Map(), sessions = new Map();
    for (const document of gameDocs) {
      const data = typeof document.data === 'function' ? document.data() : document;
      if (data?.generation !== generation || data.deleted) continue;
      const id = String(data.game?.id ?? '');
      if (!id || records.has(id) || document.id !== gameDocumentId(id, generation)) throw new Error('Invalid cloud game record.');
      records.set(id, data);
    }
    for (const document of sessionDocs) {
      const data = typeof document.data === 'function' ? document.data() : document;
      if (data?.generation !== generation || data.deleted) continue;
      const id = String(data.gameId ?? '');
      if (!records.has(id) || document.id !== sessionDocumentId(id, data.key, generation)) {
        throw new Error('Orphaned or invalid cloud session.');
      }
      if (!sessions.has(id)) sessions.set(id, new Map());
      if (sessions.get(id).has(data.key)) throw new Error('Duplicate cloud session.');
      sessions.get(id).set(data.key, clone(data.session));
    }
    const order = new Map(orderIds.map((id, index) => [String(id), index]));
    return [...records.entries()].map(([id, record]) => joinGame(record, sessions.get(id)?.values() || []))
      .sort((a, b) => (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER) || String(a.id).localeCompare(String(b.id)));
  }

  function mergedHistory(base, local, remote) {
    base = base || [];local = local || [];remote = remote || [];
    if (![base, local, remote].every(Array.isArray)) return null;
    const toMap = events => new Map(events.map(event => [String(event?.id || `${event?.kind}:${event?.at}:${event?.source || ''}`), event]));
    const b = toMap(base), l = toMap(local), r = toMap(remote);
    if (b.size !== base.length || l.size !== local.length || r.size !== remote.length) return null;
    for (const [id, event] of b) if (!equal(l.get(id), event) || !equal(r.get(id), event)) return null;
    for (const [id, event] of l) if (r.has(id) && !equal(r.get(id), event)) return null;
    return [...new Map([...r, ...l]).values()].map(clone).sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  }
  function mergeMetadata(base, local, remote) {
    if (equal(local, remote)) return clone(remote);
    if (equal(local, base)) return clone(remote);
    if (equal(remote, base)) return clone(local);
    if (!base || !local || !remote) return null;
    const merged = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const b = base[key], l = local[key], r = remote[key];
      let value;
      if (equal(l, r)) value = l;
      else if (equal(l, b)) value = r;
      else if (equal(r, b)) value = l;
      else if (key === 'lastPlayed' && Number.isFinite(Number(l)) && Number.isFinite(Number(r))) value = Math.max(Number(l), Number(r));
      else if (key === 'history') value = mergedHistory(b, l, r);
      else return null;
      if (value === null && key === 'history') return null;
      if (value !== undefined) merged[key] = clone(value);
    }
    return merged;
  }
  function conflict(gameId) {
    const error = new Error('Session sync needs user resolution.');
    error.code = 'sync-conflict';error.gameId = gameId;
    return error;
  }

  async function migrateSnapshot({ runTransaction, db, rootRef, doc, writeBatch, uid, root, games }) {
    if (root?.storageMode === MODE && root.documentGeneration) return root.documentGeneration;
    const sourceGames = clone(games), sourceTs = Number(root?.ts || 0);
    indexGames(sourceGames);
    const generation = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(rootRef);
      const fresh = snapshot.exists() ? snapshot.data() : null;
      if (fresh?.storageMode === MODE) return;
      if (!fresh || Number(fresh.ts || 0) !== sourceTs || fresh.storageMode !== root.storageMode) {
        throw new Error('Library changed during session migration.');
      }
      if (fresh.migrationLease?.until > now) throw new Error('Another device is migrating the library.');
      transaction.set(rootRef, { migrationLease: { generation, sourceTs, until: now + 120000 } }, { merge: true });
    });
    const leased = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(rootRef);
      return snapshot.data()?.migrationLease?.generation === generation;
    });
    if (!leased) throw new Error('Another device completed session migration.');
    const writes = [];
    for (const game of sourceGames) {
      writes.push({ path: ['users', uid, 'game-records', gameDocumentId(game.id, generation)],
        data: { ...splitGame(game), generation, deleted: false, ts: now } });
      for (const [key, session] of sessionIndex(game.sessions || [])) {
        writes.push({ path: ['users', uid, 'session-records', sessionDocumentId(game.id, key, generation)],
          data: { gameId: String(game.id), key, session: clone(session), generation, deleted: false, ts: now } });
      }
    }
    for (let offset = 0; offset < writes.length; offset += 300) {
      const batch = writeBatch(db);
      for (const item of writes.slice(offset, offset + 300)) batch.set(doc(db, ...item.path), item.data);
      await batch.commit();
    }
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(rootRef);
      const fresh = snapshot.data();
      if (fresh?.migrationLease?.generation !== generation || Number(fresh.ts || 0) !== sourceTs) {
        throw new Error('Library changed during session migration; old data remains authoritative.');
      }
      transaction.set(rootRef, { storageMode: MODE, documentGeneration: generation,
        orderIds: sourceGames.map(game => String(game.id)), documentCount: sourceGames.length,
        sessionDocumentCount: writes.length - sourceGames.length, migrationLease: null }, { merge: true });
    });
    return generation;
  }

  async function commitChanges({ runTransaction, db, doc, uid, generation, baseGames, localGames }) {
    const base = indexGames(baseGames), local = indexGames(localGames);
    let count = 0;
    for (const id of new Set([...base.keys(), ...local.keys()])) {
      const original = base.get(id), desired = local.get(id);
      if (equal(original, desired)) continue;
      const before = original ? sessionIndex(original.sessions || []) : new Map();
      const after = desired ? sessionIndex(desired.sessions || []) : new Map();
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(key => !equal(before.get(key), after.get(key)));
      const gameRef = doc(db, 'users', uid, 'game-records', gameDocumentId(id, generation));
      const sessionRefs = changed.map(key => ({ key, ref: doc(db, 'users', uid, 'session-records', sessionDocumentId(id, key, generation)) }));
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(gameRef);
        const data = snapshot.exists() ? snapshot.data() : null;
        const remote = data?.generation === generation && !data.deleted ? data : undefined;
        const remoteSessions = new Map();
        for (const item of sessionRefs) {
          const sessionSnapshot = await transaction.get(item.ref);
          const sessionData = sessionSnapshot.exists() ? sessionSnapshot.data() : null;
          remoteSessions.set(item.key, sessionData?.generation === generation && !sessionData.deleted ? sessionData.session : undefined);
        }
        const baseline = splitGame(original), target = splitGame(desired);
        if (original && !desired && Number(remote?.sessionRevision || 0) !== Number(baseline.sessionRevision || 0)) throw conflict(id);
        const baseMeta = baseline ? { ...baseline.game, playtimeOffset: baseline.playtimeOffset } : undefined;
        const localMeta = target ? { ...target.game, playtimeOffset: target.playtimeOffset } : undefined;
        const remoteMeta = remote ? { ...remote.game, playtimeOffset: remote.playtimeOffset } : undefined;
        const merged = mergeMetadata(baseMeta, localMeta, remoteMeta);
        if (!merged && desired) throw conflict(id);
        if (!desired && remoteMeta && !equal(remoteMeta, baseMeta)) throw conflict(id);
        const writes = [];
        for (const item of sessionRefs) {
          const b = before.get(item.key), l = after.get(item.key), r = remoteSessions.get(item.key);
          const resolved = equal(l, r) ? l : equal(l, b) ? r : equal(r, b) ? l : null;
          if (resolved === null) throw conflict(id);
          if (!equal(resolved, r)) writes.push({ ref: item.ref, key: item.key, session: resolved });
        }
        const nextRevision = Number(remote?.sessionRevision || 0) + (writes.length ? 1 : 0);
        for (const item of writes) transaction.set(item.ref, { gameId: id, key: item.key,
          session: item.session ? clone(item.session) : null, generation, deleted: !item.session, ts: Date.now() });
        if (!desired) {
          if (remote) transaction.set(gameRef, { game: null, playtimeOffset: 0, sessionRevision: nextRevision,
            generation, deleted: true, ts: Date.now() });
        } else if (!remote || !equal(merged, remoteMeta) || nextRevision !== Number(remote.sessionRevision || 0)) {
          const { playtimeOffset, ...game } = merged;
          transaction.set(gameRef, { game, playtimeOffset, sessionRevision: nextRevision,
            generation, deleted: false, ts: Date.now() });
        }
      });
      count++;
    }
    return count;
  }

  global.createSessionSyncTools = () => ({ MODE, gameDocumentId, sessionDocumentId, sessionIndex,
    splitGame, gamesFromDocuments, migrateSnapshot, commitChanges });
})(window);
