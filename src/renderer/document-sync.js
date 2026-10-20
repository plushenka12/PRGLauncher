// Per-game Firestore storage. The legacy library document is retained as a
// migration source and profile metadata, but is no longer rewritten for game
// edits once document storage is active.
(function exposeDocumentSync(global) {
  const MODE = 'games-v1';
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function gameDocumentId(id) {
    const value = String(id ?? '');
    if (!value || value.length > 600) throw new Error('Invalid game ID for document storage.');
    return `g_${encodeURIComponent(value)}`;
  }

  function indexGames(games) {
    if (!Array.isArray(games)) throw new Error('Library is not a game array.');
    const indexed = new Map();
    for (const game of games) {
      const id = String(game?.id ?? '');
      gameDocumentId(id);
      if (indexed.has(id)) throw new Error('Duplicate game ID in library.');
      indexed.set(id, game);
    }
    return indexed;
  }

  function changedGames(baseGames, localGames) {
    const base = indexGames(baseGames), local = indexGames(localGames);
    const ids = new Set([...base.keys(), ...local.keys()]);
    return [...ids].filter(id => !equal(base.get(id), local.get(id)))
      .map(id => ({ id, base: clone(base.get(id)), local: clone(local.get(id)) }));
  }

  function gamesFromDocuments(docs, generation, orderIds = []) {
    const games = [], seen = new Set();
    for (const document of docs) {
      const data = typeof document.data === 'function' ? document.data() : document;
      if (data?.generation !== generation || data.deleted) continue;
      const game = data.game;
      const id = String(game?.id ?? '');
      if (!id || seen.has(id) || gameDocumentId(id) !== document.id) throw new Error('Invalid game document in cloud library.');
      seen.add(id);games.push(clone(game));
    }
    const order = new Map(orderIds.map((id, index) => [String(id), index]));
    return games.sort((a, b) => (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER) || String(a.id).localeCompare(String(b.id)));
  }

  async function migrateSnapshot({ runTransaction, db, rootRef, doc, writeBatch, uid, root, games }) {
    if (root?.storageMode === MODE && root.documentGeneration) return root.documentGeneration;
    const sourceTs = Number(root?.ts || 0);
    const sourceGames = clone(games);
    indexGames(sourceGames);
    const generation = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(rootRef);
      const data = fresh.exists() ? fresh.data() : null;
      if (data?.storageMode === MODE) return;
      if (!data || Number(data.ts || 0) !== sourceTs) throw new Error('Library changed during migration.');
      if (data.migrationLease?.until > now) {
        const error = new Error('Another device is migrating the library.');
        error.code = 'migration-in-progress';throw error;
      }
      transaction.set(rootRef, { migrationLease: { generation, sourceTs, until: now + 120000 } }, { merge: true });
    });
    // A competing device may have completed migration while the transaction
    // above was retried. Never write documents under an unowned generation.
    const leased = await runTransaction(db, async transaction => {
      const fresh = await transaction.get(rootRef);
      return fresh.data()?.migrationLease?.generation === generation && fresh.data()?.storageMode !== MODE;
    });
    if (!leased) {
      const error = new Error('Library migration was completed by another device.');
      error.code = 'migration-in-progress';throw error;
    }
    for (let offset = 0; offset < sourceGames.length; offset += 300) {
      const batch = writeBatch(db);
      sourceGames.slice(offset, offset + 300).forEach(game => {
        batch.set(doc(db, 'users', uid, 'games', gameDocumentId(game.id)),
          { game, generation, deleted: false, ts: now });
      });
      await batch.commit();
    }
    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(rootRef);
      const data = fresh.data();
      if (data?.migrationLease?.generation !== generation || Number(data.ts || 0) !== sourceTs) {
        throw new Error('Library changed during migration; legacy snapshot remains authoritative.');
      }
      transaction.set(rootRef, { storageMode: MODE, documentGeneration: generation,
        orderIds: sourceGames.map(game => String(game.id)), documentCount: sourceGames.length,
        migrationLease: null }, { merge: true });
    });
    return generation;
  }

  async function commitGameChanges({ runTransaction, db, doc, uid, generation, baseGames, localGames, reconcileLibraries }) {
    const changes = changedGames(baseGames, localGames);
    for (const change of changes) {
      const ref = doc(db, 'users', uid, 'games', gameDocumentId(change.id));
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists() ? snapshot.data() : null;
        // An interrupted older migration may have left a document behind.
        // Only the generation committed in the root library is authoritative.
        const remote = data?.generation === generation && !data.deleted ? data.game : undefined;
        const merged = reconcileLibraries(change.base ? [change.base] : [], change.local ? [change.local] : [], remote ? [remote] : []);
        if (merged.conflict) {
          const error = new Error('Game sync needs user resolution.');
          error.code = 'sync-conflict';error.gameId = change.id;throw error;
        }
        const game = merged.games[0];
        if (equal(game, remote)) return;
        transaction.set(ref, { game: game ? clone(game) : null, deleted: !game, generation, ts: Date.now() });
      });
    }
    return changes.length;
  }

  global.createDocumentSyncTools = () => ({ MODE, gameDocumentId, changedGames, gamesFromDocuments, migrateSnapshot, commitGameChanges });
})(window);
