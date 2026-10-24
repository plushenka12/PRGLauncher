// Keyed library grid. Cards are cached by game id and rebuilt only when what
// they display changes, so a status change, a filter or a sync re-render does
// not recreate hundreds of cards (and replay their entrance animation).
(function exposeLibraryGrid(global) {
  function createLibraryGrid({ createCard, signature, prepareCard = () => {} }) {
    const cache = new Map();

    function resolveCard(game, placed, stats) {
      const sig = signature(game);
      const entry = cache.get(game.id);
      if (entry && entry.sig === sig && !placed.has(entry.card)) {
        stats.reused += 1;
        return entry.card;
      }
      const card = createCard(game);
      card.classList.add('is-entering');
      card.addEventListener('animationend', () => card.classList.remove('is-entering'), { once: true });
      prepareCard(card);
      // A duplicated id keeps the first card cached; extras render uncached.
      if (!entry || !placed.has(entry.card)) cache.set(game.id, { card, sig });
      stats.created += 1;
      return card;
    }

    function render(grid, list, validIds) {
      const stats = { created: 0, reused: 0, moved: 0, removed: 0 };
      const placed = new Set();
      const cards = list.map(game => {
        const card = resolveCard(game, placed, stats);
        placed.add(card);
        return card;
      });
      // Drop stale cards and empty-state markup first, so cards that stay keep
      // their relative order and are not moved needlessly.
      for (let node = grid.firstChild; node;) {
        const next = node.nextSibling;
        if (!placed.has(node)) { node.remove(); stats.removed += 1; }
        node = next;
      }
      let cursor = grid.firstChild;
      for (const card of cards) {
        if (cursor === card) { cursor = cursor.nextSibling; continue; }
        if (card.parentNode === grid) stats.moved += 1;
        grid.insertBefore(card, cursor);
      }
      if (validIds) for (const id of cache.keys()) if (!validIds.has(id)) cache.delete(id);
      return stats;
    }

    return { render, clear: () => cache.clear(), size: () => cache.size };
  }

  global.createLibraryGrid = createLibraryGrid;
})(typeof window !== 'undefined' ? window : globalThis);
