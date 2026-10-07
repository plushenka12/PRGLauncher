// Game-card view factory. It receives behavior callbacks from the renderer so
// this module owns DOM composition only, not application state or persistence.
(function exposeGameCardUi(global) {
  function createGameCard(game, options) {
    const {
      activeGameId, activeStart, coverEl, createStatusButton, fmtTime,
      platformIcons, sessionCountText, translate, isGuest, stopTimer,
      launchAndTrack, openDetail
    } = options;
    const isActive = activeGameId === game.id;
    const elapsed = isActive ? Date.now() - activeStart : 0;
    const totalMs = (game.playtime || 0) + elapsed;
    const card = document.createElement('div');
    card.className = `game-card${isActive ? ' is-playing' : ''}`;
    card.dataset.id = game.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', game.title || 'Game');
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
        event.preventDefault();
        openDetail(game.id);
      }
    });

    const coverDiv = document.createElement('div');
    coverDiv.className = 'card-cover';
    coverDiv.appendChild(coverEl(game));
    coverDiv.appendChild(createStatusButton(game));
    if (totalMs > 0 || isActive) {
      const timer = document.createElement('span');
      timer.className = 'card-timer-badge';
      timer.textContent = fmtTime(totalMs);
      coverDiv.appendChild(timer);
    }
    if (game.platform) {
      const platform = document.createElement('span');
      platform.className = 'card-platform-badge';
      platform.textContent = (platformIcons[game.platform] || '') + ' ' + game.platform;
      platform.title = translate('Платформа гри: ') + game.platform;
      platform.dataset.tooltip = translate('Платформа гри: ') + game.platform;
      coverDiv.appendChild(platform);
    }
    const sessionBadge = document.createElement('span');
    sessionBadge.className = 'card-session-badge';
    sessionBadge.textContent = sessionCountText((game.sessions || []).length);
    if (game.rating) sessionBadge.classList.add('has-rating');
    coverDiv.appendChild(sessionBadge);
    if (game.rating) {
      const rating = document.createElement('span');
      rating.className = 'card-rating';
      rating.innerHTML = '★ ' + game.rating + '/10';
      coverDiv.appendChild(rating);
    }
    card.appendChild(coverDiv);

    const body = document.createElement('div');
    body.className = 'card-body';
    const titleRow = document.createElement('div');
    titleRow.className = 'card-title-row';
    titleRow.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.style.cssText = 'margin-bottom:0;flex:1;min-width:0';
    title.textContent = game.title;
    titleRow.appendChild(title);
    body.appendChild(titleRow);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const primary = document.createElement('button');
    primary.className = `card-btn ${isActive ? 'card-btn-pause' : 'card-btn-play'}`;
    primary.textContent = translate(isActive ? 'Pause' : game.steamAppId ? 'Play in Steam' : game.gogGameId ? 'Play in GOG' : 'Start timer');
    primary.onclick = event => {
      event.stopPropagation();
      if (isActive) stopTimer(false);
      else if (!isGuest()) launchAndTrack(game.id);
    };
    actions.appendChild(primary);
    const info = document.createElement('button');
    info.className = 'card-btn';
    info.textContent = translate('Info');
    info.onclick = event => { event.stopPropagation(); openDetail(game.id); };
    actions.appendChild(info);
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  global.createRendererUiTools = () => ({ createGameCard });
})(window);
