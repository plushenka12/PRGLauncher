// Guest library: read-only rendering of the explicit publicLibrary projection.
(function exposeGuestLibrary(global) {
  const labels = { all: 'Усі ігри', Playing: 'Проходжу', Backlog: 'Беклог', Completed: 'Пройдено', QuickPlay: 'Короткі забіги' };
  const order = ['all', 'Playing', 'Backlog', 'Completed', 'QuickPlay'];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const coverUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
  const hours = ms => `${(Math.max(0, Number(ms) || 0) / 3600000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} год`;
  const number = value => (Number(value) || 0).toLocaleString('uk-UA');
  const state = { dashboard: null, games: [], status: 'all', platform: 'all', layout: 'grid', sort: 'title', selected: null, trigger: null };
  let wired = false;

  function cover(game, className = 'library-cover') {
    const url = coverUrl(game.cover);
    return url ? `<img class="${className}" src="${esc(url)}" alt="" loading="lazy">` : `<div class="${className} library-cover-placeholder" aria-hidden="true">${esc(game.title || 'Гра')}</div>`;
  }
  function normalizedGame(game) {
    if (!game || typeof game.title !== 'string' || !game.title.trim()) return null;
    return {
      gameId: String(game.gameId || '').slice(0, 100), title: game.title.slice(0, 200), cover: coverUrl(game.cover),
      status: Object.hasOwn(labels, game.status) ? game.status : 'Backlog',
      platform: typeof game.platform === 'string' ? game.platform.slice(0, 60) : null,
      platforms: Array.isArray(game.platforms) ? game.platforms.filter(item => typeof item === 'string').slice(0, 8) : [],
      rating: game.rating == null || !Number.isFinite(Number(game.rating)) ? null : Math.min(10, Math.max(0, Number(game.rating))),
      playtime: Math.max(0, Number(game.playtime) || 0), sessions: Math.max(0, Math.floor(Number(game.sessions) || 0)),
      hltbMainMinutes: game.hltbMainMinutes == null ? null : Math.max(0, Number(game.hltbMainMinutes) || 0)
    };
  }
  function filteredGames() {
    const query = $('library-search').value.trim().toLocaleLowerCase('uk');
    const games = state.games.filter(game => (state.status === 'all' || game.status === state.status) &&
      (state.platform === 'all' || game.platform === state.platform || game.platforms.includes(state.platform)) &&
      game.title.toLocaleLowerCase('uk').includes(query));
    if (state.sort === 'time') games.sort((a, b) => b.playtime - a.playtime || a.title.localeCompare(b.title, 'uk'));
    else if (state.sort === 'rating') games.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title, 'uk'));
    else if (state.sort === 'status') games.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.title.localeCompare(b.title, 'uk'));
    else games.sort((a, b) => a.title.localeCompare(b.title, 'uk'));
    return games;
  }
  function renderNav() {
    $('library-status-nav').innerHTML = order.map(status => `<button type="button" data-status="${status}" class="${state.status === status ? 'active' : ''}"><span>${labels[status]}</span><b>${number(status === 'all' ? state.games.length : state.games.filter(game => game.status === status).length)}</b></button>`).join('');
    const platforms = [...new Set(state.games.flatMap(game => [game.platform, ...game.platforms]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
    $('library-platform-nav').innerHTML = `<button type="button" data-platform="all" class="${state.platform === 'all' ? 'active' : ''}">Усі платформи</button>` + platforms.map(platform => `<button type="button" data-platform="${esc(platform)}" class="${state.platform === platform ? 'active' : ''}">${esc(platform)}</button>`).join('');
    $('library-mobile-filter-list').innerHTML = order.map(status => `<button type="button" data-status="${status}" class="${state.status === status ? 'active' : ''}">${labels[status]}</button>`).join('') + `<button type="button" data-platform="all" class="${state.platform === 'all' ? 'active' : ''}">Усі платформи</button>` + platforms.map(platform => `<button type="button" data-platform="${esc(platform)}" class="${state.platform === platform ? 'active' : ''}">${esc(platform)}</button>`).join('');
  }
  function renderGames() {
    const games = filteredGames();
    $('library-count').textContent = `Показано ${number(games.length)} із ${number(state.games.length)}`;
    $('library-games').classList.toggle('list', state.layout === 'list');
    $('library-games').innerHTML = games.length ? games.map(game => {
      const index = state.games.indexOf(game);
      const rating = game.rating == null ? '—' : `${number(game.rating)} / 10`;
      return `<button class="library-card" type="button" data-game="${index}" aria-label="Деталі гри ${esc(game.title)}">${cover(game)}<h3>${esc(game.title)}</h3><div class="library-meta"><span>${esc(game.platform || 'Платформа не вказана')} · ${number(game.sessions)} сесій</span><strong>${rating}</strong></div><div class="library-bottom"><span>${labels[game.status]}</span><span>${hours(game.playtime)}</span></div></button>`;
    }).join('') : `<div class="library-empty">${state.games.length ? 'За цими фільтрами ігор немає. Спробуй інший пошук або статус.' : state.dashboard?.publicLibraryEnabled ? 'Бібліотека поки порожня.' : 'Власник ще не увімкнув публікацію бібліотеки в налаштуваннях PRGLauncher.'}</div>`;
    renderNav();
  }
  function renderSummary() {
    const metrics = [
      [state.games.length, 'ігор'], [state.games.filter(game => game.status === 'Completed').length, 'пройдено'],
      [state.games.filter(game => game.status === 'Playing').length, 'граю зараз'],
      [hours(state.games.reduce((sum, game) => sum + game.playtime, 0)), 'загальний час']
    ];
    $('library-overview').innerHTML = metrics.map(([value, label]) => `<div><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
    $('library-updated').textContent = state.dashboard?.updatedAt ? `Оновлено ${new Date(state.dashboard.updatedAt).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Публічний гостьовий перегляд';
  }
  function reviewFor(game) {
    const reviews = Array.isArray(state.dashboard?.publicReviews) ? state.dashboard.publicReviews : [];
    return reviews.find(review => review?.gameId && review.gameId === game.gameId && typeof review.markdown === 'string' && review.markdown.trim() && review.markdown.length <= 3000);
  }
  function renderDetailOverview(game) {
    const ownMinutes = game.playtime / 60000, hltb = game.hltbMainMinutes;
    const yearly = Object.entries(state.dashboard?.yearly || {}).map(([year, item]) => {
      const match = (Array.isArray(item?.games) ? item.games : []).find(entry => entry?.gameId === game.gameId);
      return match ? { year, playtime: Number(match.playtime) || 0, sessions: Number(match.sessions) || 0 } : null;
    }).filter(Boolean).sort((a, b) => Number(b.year) - Number(a.year));
    $('library-detail-overview').innerHTML = `<div class="library-values"><div><small>Награно</small><strong>${hours(game.playtime)}</strong></div><div><small>Сесій</small><strong>${number(game.sessions)}</strong></div><div><small>Моя оцінка</small><strong>${game.rating == null ? '—' : `${number(game.rating)} / 10`}</strong></div></div><section><h3>Мій час і HLTB</h3><div class="library-compare"><span>Мій час</span><strong>${hours(game.playtime)}</strong></div><div class="library-compare"><span>HLTB · сюжет</span><strong>${hltb ? hours(hltb * 60000) : 'Немає даних'}</strong></div><p class="library-private-note">HLTB — орієнтир проходження, не ціль для таймера.</p></section><section><h3>Активність за роками</h3>${yearly.length ? yearly.map(item => `<div class="library-year-row"><span>${esc(item.year)} · ${number(item.sessions)} сесій</span><strong>${hours(item.playtime)}</strong></div>`).join('') : '<p class="library-private-note">Ігрових сесій поки немає.</p>'}</section><section><h3>Платформи</h3><p>${esc([...new Set([game.platform, ...game.platforms].filter(Boolean))].join(' · ') || 'Не вказано')}</p></section>`;
  }
  function detailTab(tab) {
    const review = tab === 'review';
    $('library-detail-overview').hidden = review;
    $('library-detail-review').hidden = !review;
    for (const [id, active] of [['library-tab-overview', !review], ['library-tab-review', review]]) {
      $(id).classList.toggle('active', active); $(id).setAttribute('aria-selected', String(active));
    }
  }
  function openDetail(index, trigger) {
    const game = state.games[index]; if (!game) return;
    state.selected = index; state.trigger = trigger;
    $('library-detail-art').innerHTML = cover(game, 'library-detail-cover');
    $('library-detail-title').textContent = game.title;
    $('library-detail-sub').textContent = `${game.platform || 'Платформа не вказана'} · ${labels[game.status]}`;
    renderDetailOverview(game);
    const review = reviewFor(game); $('library-tab-review').hidden = !review;
    $('library-detail-review').innerHTML = review ? global.PRGReviewMarkdown.render(review.markdown) : '';
    detailTab('overview'); $('library-detail').hidden = false; document.body.style.overflow = 'hidden'; $('library-close').focus();
  }
  function closeDetail() { $('library-detail').hidden = true; document.body.style.overflow = ''; state.trigger?.focus(); state.trigger = null; }
  function setLayout(layout) {
    state.layout = layout; renderGames();
    document.querySelectorAll('#library [data-layout]').forEach(button => { const active = button.dataset.layout === layout; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('library-mobile-layout').textContent = layout === 'grid' ? 'Список' : 'Сітка';
  }
  function wire() {
    if (wired) return; wired = true;
    $('library-search').addEventListener('input', renderGames);
    $('library-sort').addEventListener('change', event => { state.sort = event.target.value; renderGames(); });
    for (const id of ['library-status-nav', 'library-platform-nav', 'library-mobile-filter-list']) $(id).addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.status) state.status = button.dataset.status;
      if (button.dataset.platform) state.platform = button.dataset.platform;
      renderGames();
    });
    $('library-games').addEventListener('click', event => { const button = event.target.closest('[data-game]'); if (button) openDetail(Number(button.dataset.game), button); });
    $('library').addEventListener('click', event => { const button = event.target.closest('[data-layout]'); if (button) setLayout(button.dataset.layout); });
    $('library-mobile-layout').addEventListener('click', () => setLayout(state.layout === 'grid' ? 'list' : 'grid'));
    $('library-mobile-sort').addEventListener('click', () => { const sorts = ['title', 'time', 'rating', 'status']; state.sort = sorts[(sorts.indexOf(state.sort) + 1) % sorts.length]; $('library-sort').value = state.sort; $('library-mobile-sort').textContent = { title: 'За назвою', time: 'За часом', rating: 'За оцінкою', status: 'За статусом' }[state.sort]; renderGames(); });
    $('library-mobile-filters').addEventListener('click', () => { const node = $('library-mobile-filter-list'); node.hidden = !node.hidden; $('library-mobile-filters').setAttribute('aria-expanded', String(!node.hidden)); });
    $('library-close').addEventListener('click', closeDetail);
    $('library-detail').addEventListener('click', event => { if (event.target === $('library-detail')) closeDetail(); });
    $('library-tab-overview').addEventListener('click', () => detailTab('overview'));
    $('library-tab-review').addEventListener('click', () => detailTab('review'));
    document.addEventListener('keydown', event => { if ($('library-detail').hidden) return; if (event.key === 'Escape') closeDetail(); if (event.key === 'Tab') { const controls = [...$('library-detail').querySelectorAll('button:not([hidden]),a:not([hidden])')]; const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
  }
  function render(dashboard) {
    state.dashboard = dashboard || null;
    state.games = dashboard?.publicLibraryEnabled === true && Array.isArray(dashboard.publicLibrary) ? dashboard.publicLibrary.map(normalizedGame).filter(Boolean) : [];
    wire(); renderSummary(); renderGames();
    if (state.selected != null && !$('library-detail').hidden) openDetail(state.selected, state.trigger);
  }
  function fail() { wire(); $('library-games').innerHTML = '<div class="library-empty">Бібліотека зараз недоступна. Перевір посилання або спробуй пізніше.</div>'; $('library-updated').textContent = 'Немає доступного публічного знімка'; }
  global.PRGLibrary = { render, fail, normalizedGame };
})(window);
