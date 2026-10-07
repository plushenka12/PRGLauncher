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

  global.normalizeRawgSearchTitle = normalizeRawgSearchTitle;
  global.normalizeBackloggdTitle = normalizeBackloggdTitle;
})(window);
