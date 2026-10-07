// Pure RAWG matching helpers. Fetching and cover updates stay in renderer.
(function exposeRawgUtils(global) {
  function titleKey(value) {
    return typeof global.normalizeBackloggdTitle === 'function'
      ? global.normalizeBackloggdTitle(value)
      : String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function rawgMatchScore(title, item) {
    const key = titleKey(title);
    const itemKey = titleKey(item?.name);
    if (!key || !itemKey) return 0;
    if (key === itemKey) return 1000;
    const words = new Set(key.split(' ').filter(word => word.length > 1));
    const itemWords = new Set(itemKey.split(' ').filter(Boolean));
    const overlap = [...words].filter(word => itemWords.has(word)).length;
    return Math.round(overlap / Math.max(words.size, 1) * 100) - (itemWords.size - overlap) * 3;
  }

  function bestRawgMatch(title, results) {
    return [...(Array.isArray(results) ? results : [])].sort((a, b) => rawgMatchScore(title, b) - rawgMatchScore(title, a) || String(a?.name || '').localeCompare(String(b?.name || '')))[0] || null;
  }

  global.createRawgUtils = () => ({ titleKey, rawgMatchScore, bestRawgMatch });
})(window);
