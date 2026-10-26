// Library export for the owner's own use (a spreadsheet or another tool).
// Only what the library shows is exported: no notes, launch paths, companion
// programs or account IDs. Unlike the backup it is not meant to be imported.
(function exposeLibraryExport(global) {
  const STATUSES = new Set(['Backlog', 'Playing', 'Completed', 'QuickPlay']);
  const isoDate = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : '');
  const hours = ms => Math.round((Number(ms) || 0) / 36000) / 100;

  function exportGames(games = []) {
    return (Array.isArray(games) ? games : []).filter(game => game && String(game.title || '').trim()).map(game => {
      const sessions = (Array.isArray(game.sessions) ? game.sessions : [])
        .filter(session => Number.isFinite(Number(session?.start)) && Number(session.dur) > 0)
        .map(session => ({ start: isoDate(session.start), end: isoDate(session.end), minutes: Math.round(Number(session.dur) / 60000), source: String(session.source || 'manual') }));
      const hltbMain = game.hltb && !game.hltb.hidden && Number(game.hltb.mainStoryMinutes) > 0 ? Math.round(Number(game.hltb.mainStoryMinutes) / 6) / 10 : null;
      return {
        title: String(game.title).trim(),
        platform: String(game.platform || ''),
        status: STATUSES.has(game.status) ? game.status : 'Backlog',
        rating: Number.isFinite(Number(game.rating)) && game.rating ? Number(game.rating) : null,
        playtimeHours: hours(game.playtime),
        sessionCount: sessions.length,
        firstPlayed: sessions.length ? sessions.map(session => session.start).sort()[0] : '',
        lastPlayed: isoDate(game.lastPlayed),
        added: isoDate(game.added),
        hltbMainStoryHours: hltbMain,
        steamAppId: game.steamAppId ? String(game.steamAppId) : '',
        sessions,
      };
    });
  }

  // Semicolons and a BOM, so Excel with a Ukrainian locale opens it as a
  // table with Cyrillic intact. Cells that a spreadsheet would run as a
  // formula are prefixed with an apostrophe.
  const COLUMNS = ['title', 'platform', 'status', 'rating', 'playtimeHours', 'sessionCount', 'firstPlayed', 'lastPlayed', 'added', 'hltbMainStoryHours', 'steamAppId'];
  function cell(value) {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  function toCsv(rows) {
    return '﻿' + [COLUMNS.join(';'), ...rows.map(row => COLUMNS.map(column => cell(row[column])).join(';'))].join('\r\n') + '\r\n';
  }
  function toJson(rows, now = Date.now()) {
    return JSON.stringify({ format: 'prglauncher-library-export', version: 1, exportedAt: new Date(now).toISOString(), games: rows }, null, 2);
  }

  global.createLibraryExport = () => ({ exportGames, toCsv, toJson, COLUMNS });
})(typeof window !== 'undefined' ? window : globalThis);
