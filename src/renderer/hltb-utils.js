// Pure HLTB title/link matching helpers. Network access and UI stay outside.
(function exposeHltbUtils(global) {
  function hltbLinkInfo(value) {
    const raw = String(value || '').trim();
    try {
      const url = new URL(raw);
      if (!/(^|\.)howlongtobeat\.com$/iu.test(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      const gameIndex = parts.findIndex(part => part.toLowerCase() === 'game');
      if (gameIndex < 0) return null;
      const id = Number(parts[gameIndex + 1]);
      const slug = parts.slice(gameIndex + 2).join(' ');
      return Number.isInteger(id) && id > 0 ? { id, slug: slug ? decodeURIComponent(slug).replace(/[-_]+/g, ' ') : '' } : null;
    } catch { return null; }
  }

  function hltbInputTitle(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const link = hltbLinkInfo(raw);
    return link?.slug || raw;
  }

  function hltbSearchTitle(title) {
    const original = hltbInputTitle(title);
    const normalized = original.normalize('NFKC').replace(/[®™©]/gu, ' ').replace(/[’‘`´']/gu, '').replace(/\s+/g, ' ').trim();
    const bundle = normalized.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
    if (bundle && /\b(?:nintendo\s+switch|switch\s*2?|playstation|ps\s*[45]|xbox|pc|steam|edition)\b/iu.test(bundle[2])) return bundle[1].trim() || normalized;
    const clean = normalized.replace(/\s*(?:[-–—:]\s*)?(?:nintendo\s+switch\s*2?\s+edition|switch\s*2?\s+edition|playstation\s*[45]\s+edition|ps\s*[45]\s+edition|xbox\s+(?:one|series\s+[xs](?:\|s)?)\s+edition|pc\s+edition|steam\s+edition)\s*$/iu, '').trim();
    return clean || normalized;
  }

  function hltbTitleKey(title) {
    return hltbSearchTitle(title).toLocaleLowerCase().normalize('NFKD').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[®™©]/gu, ' ').replace(/[’‘`´']/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\b(edition|deluxe|complete|remastered|remake|game of the year|goty)\b/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function hltbMatchScore(game, candidate) {
    const gameWords = new Set(hltbTitleKey(game.title).split(' ').filter(Boolean));
    const candidateWords = new Set(hltbTitleKey(candidate.title).split(' ').filter(Boolean));
    if (!gameWords.size || !candidateWords.size) return 0;
    if ([...gameWords].every(word => candidateWords.has(word)) && gameWords.size === candidateWords.size) return 1000;
    const overlap = [...gameWords].filter(word => candidateWords.has(word)).length;
    return Math.round(overlap / gameWords.size * 100) - (candidateWords.size - overlap) * 3;
  }

  function rankHltbCandidates(game, candidates) {
    return [...candidates].sort((a, b) => hltbMatchScore(game, b) - hltbMatchScore(game, a) || a.title.localeCompare(b.title));
  }

  global.hltbLinkInfo = hltbLinkInfo;
  global.hltbInputTitle = hltbInputTitle;
  global.hltbSearchTitle = hltbSearchTitle;
  global.hltbTitleKey = hltbTitleKey;
  global.hltbMatchScore = hltbMatchScore;
  global.rankHltbCandidates = rankHltbCandidates;
  global.createHltbUtils = () => ({ hltbLinkInfo, hltbInputTitle, hltbSearchTitle, hltbTitleKey, hltbMatchScore, rankHltbCandidates });
})(window);
