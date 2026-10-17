// Pure renderer helpers. Keep this file dependency-free so it can be tested
// without starting Electron or Firebase.
(function exposeGameUtils(global) {
  function normalizeRawgSearchTitle(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[®™©]/gu, ' ')
      .replace(/[’‘`´']/gu, '')
      .replace(/[+&]/gu, ' ')
      .replace(/[-–—_:/.]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeBackloggdTitle(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9а-яёіїєґ]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+(nintendo switch 2 edition|nintendo switch edition|switch 2 edition|switch edition|complete edition|game of the year edition|goty edition|definitive edition|deluxe edition|ultimate edition|gold edition|enhanced edition|director s cut|remastered edition)\s*$/, '')
      .trim();
  }

  function findExistingDuplicateGames(games, addedId) {
    const added = (games || []).find(game => game.id === addedId);
    const key = normalizeBackloggdTitle(added?.title);
    if (!key) return [];
    return games.filter(game => game.id !== addedId && normalizeBackloggdTitle(game.title) === key);
  }

  function preserveManualMergeFields(primary, duplicate) {
    if (!primary?.localExecutable && duplicate?.localExecutable) {
      primary.localExecutable = duplicate.localExecutable;
      primary.workingDirectory = duplicate.workingDirectory || null;
      primary.launchArguments = duplicate.launchArguments || null;
    }
    if (duplicate?.notes && duplicate.notes !== primary.notes) {
      primary.notes = primary.notes ? `${primary.notes}\n\n${duplicate.notes}` : duplicate.notes;
    }
    for (const field of ['genres', 'tags']) {
      primary[field] = [...new Set([...(primary[field] || []), ...(duplicate?.[field] || [])])];
    }
    return primary;
  }

  global.normalizeRawgSearchTitle = normalizeRawgSearchTitle;
  global.normalizeBackloggdTitle = normalizeBackloggdTitle;
  global.findExistingDuplicateGames = findExistingDuplicateGames;
  global.preserveManualMergeFields = preserveManualMergeFields;
})(window);
