// Game-detail view adapter. It updates the existing modal through callbacks
// supplied by the renderer and keeps detail DOM composition out of app state.
(function exposeGameDetailUi(global) {
  function renderGameDetail(game, options) {
    const {
      activeGameId, activeStart, createStatusButton, platformIcons,
      renderGameSources, setRatingUI, renderHltbPanel, renderGameHistory,
      fmtTime, fmtDate, translate
    } = options;
    const isActive = activeGameId === game.id;
    const elapsed = isActive ? Date.now() - activeStart : 0;
    const total = (game.playtime || 0) + elapsed;
    const sessions = game.sessions || [];
    const banner = document.getElementById('d-cover-banner');
    [...banner.children].forEach(element => {
      if (!element.classList.contains('detail-cover-overlay') && !element.classList.contains('detail-cover-info')) element.remove();
    });
    const addFallback = () => {
      const fallback = document.createElement('div');
      fallback.className = 'detail-cover-banner-fallback';
      fallback.textContent = game.title.slice(0, 2).toUpperCase();
      banner.insertBefore(fallback, banner.firstChild);
    };
    if (game.cover) {
      const image = document.createElement('img');
      image.src = game.cover;
      image.alt = game.title;
      image.onerror = () => { image.remove(); addFallback(); };
      banner.insertBefore(image, banner.firstChild);
    } else addFallback();

    document.getElementById('d-title').textContent = game.title;
    document.getElementById('d-badge').replaceChildren(createStatusButton(game, true));
    document.getElementById('d-platform').textContent = game.platform ? (platformIcons[game.platform] || '') + ' ' + game.platform : '';
    renderGameSources(game);
    setRatingUI(game.rating || 0);
    document.getElementById('d-notes-input').value = game.notes || '';
    document.getElementById('d-playtime').textContent = fmtTime(total);
    document.getElementById('d-sessions').textContent = sessions.length;
    const average = sessions.length ? sessions.reduce((sum, session) => sum + session.dur, 0) / sessions.length : 0;
    document.getElementById('d-avg').textContent = average ? fmtTime(average) : '—';
    document.getElementById('d-last').textContent = fmtDate(game.lastPlayed);
    const log = document.getElementById('d-log');
    log.innerHTML = !sessions.length
      ? `<div style="color:var(--text3);font-size:13px;padding:8px 0">${translate('No sessions yet')}</div>`
      : [...sessions].reverse().map(session => `<div class="session-row"><span class="session-date">${fmtDate(session.start)}</span><span class="session-dur">${fmtTime(session.dur)}</span></div>`).join('');
    renderHltbPanel(game);
    renderGameHistory(game);
  }

  global.createGameDetailUi = () => ({ renderGameDetail });
})(window);
