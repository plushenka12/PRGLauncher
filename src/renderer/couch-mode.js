// Gamepad mode: the library as a full-screen row of covers for the couch,
// driven by a controller (or the arrow keys). The gamepad is read only while
// this mode is open. The list and navigation logic is pure, for Node tests.
(function exposeCouchMode(global) {
  const TABS = ['recent', 'playing', 'backlog', 'all'];
  const LAUNCHABLE = game => Boolean(game.steamAppId || game.localExecutable);

  // What each tab lists. Recent: played games, newest first; Playing and
  // Backlog: by status; All: everything but QuickPlay, A–Z.
  function couchLists(games) {
    const list = (Array.isArray(games) ? games : []).filter(game => game && String(game.title || '').trim());
    const byRecent = (a, b) => (Number(b.lastPlayed) || 0) - (Number(a.lastPlayed) || 0);
    return {
      recent: list.filter(game => Number(game.lastPlayed) > 0).sort(byRecent).slice(0, 30),
      playing: list.filter(game => game.status === 'Playing').sort(byRecent),
      backlog: list.filter(game => game.status === 'Backlog').sort((a, b) => Number(LAUNCHABLE(b)) - Number(LAUNCHABLE(a)) || String(a.title).localeCompare(String(b.title))),
      all: list.filter(game => game.status !== 'QuickPlay').sort((a, b) => String(a.title).localeCompare(String(b.title))),
    };
  }

  // Selection after a move; tabs wrap around, the row stops at its ends.
  function move(state, action, lists) {
    const next = { ...state };
    if (action === 'tab-next' || action === 'tab-prev') {
      const index = TABS.indexOf(state.tab);
      next.tab = TABS[(index + (action === 'tab-next' ? 1 : TABS.length - 1)) % TABS.length];
      next.index = 0;
    } else if (action === 'left' || action === 'right') {
      const length = (lists[state.tab] || []).length;
      next.index = Math.max(0, Math.min(length - 1, state.index + (action === 'right' ? 1 : -1)));
    } else if (action === 'first') next.index = 0;
    else if (action === 'last') next.index = Math.max(0, (lists[state.tab] || []).length - 1);
    return next;
  }

  // Standard gamepad mapping: A 0, B 1, X 2, Y 3, LB 4, RB 5, Back 8, D-pad 12–15.
  const BUTTONS = { 0: 'launch', 1: 'exit', 2: 'switch', 3: 'details', 8: 'exit', 4: 'tab-prev', 5: 'tab-next', 14: 'left', 15: 'right', 12: 'tab-prev', 13: 'tab-next' };
  const REPEATS = new Set(['left', 'right']);

  // Turns the pad's state into actions: a press fires once, a held direction
  // repeats after a short delay, like a console menu.
  function createPadReader({ delay = 380, rate = 110 } = {}) {
    const held = new Map();
    return function read(pad, now) {
      const actions = [];
      const down = new Set();
      if (pad) {
        (pad.buttons || []).forEach((button, index) => { if (BUTTONS[index] && (button?.pressed || button?.value > 0.5)) down.add(BUTTONS[index]); });
        const x = Number(pad.axes?.[0]) || 0;
        if (x < -0.6) down.add('left');
        if (x > 0.6) down.add('right');
      }
      for (const action of down) {
        const since = held.get(action);
        if (since == null) { held.set(action, { at: now, last: now }); actions.push(action); }
        else if (REPEATS.has(action) && now - since.at >= delay && now - since.last >= rate) { since.last = now; actions.push(action); }
      }
      for (const action of [...held.keys()]) if (!down.has(action)) held.delete(action);
      return actions;
    };
  }

  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', Enter: 'launch', ' ': 'launch', Escape: 'exit', Backspace: 'exit', PageUp: 'tab-prev', PageDown: 'tab-next', ArrowUp: 'tab-prev', ArrowDown: 'tab-next', Home: 'first', End: 'last', q: 'tab-prev', e: 'tab-next', x: 'switch', y: 'details', i: 'details' };
  const STATUSES = ['Backlog', 'Playing', 'Completed', 'QuickPlay'];

  function createCouchMode(options) {
    const { getGames, launch, getActiveId, translate: t, fmtHours, setFullscreen, onClose, getArt = () => null, loadArt = () => {}, getAccent = () => null, openSwitch = () => {}, setStatus = () => {}, formatDate = ts => new Date(ts).toLocaleDateString() } = options;
    let root = null, frame = 0, state = { tab: 'recent', index: 0 }, lists = null;
    // The Y panel: details of the selected game; left/right pick a status.
    let panel = null;
    const readPad = createPadReader();
    const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
    const LABELS = { recent: 'Нещодавні', playing: 'Граю', backlog: 'Беклог', all: 'Усі ігри' };

    function hltbProgress(game) {
      const minutes = game.hltb && !game.hltb.hidden ? Number(game.hltb.mainStoryMinutes) : 0;
      return minutes > 0 ? Math.min(100, Math.round((Number(game.playtime) || 0) / (minutes * 60000) * 100)) : null;
    }

    // Portrait art first: Steam's cached capsule, then Steam's CDN capsule,
    // then the library cover. A landscape cover is shown whole on a blurred
    // copy of itself instead of being cut down to its middle.
    function coverSources(game) {
      const art = getArt(game);
      const appId = /^\d+$/.test(String(game.steamAppId || '')) ? String(game.steamAppId) : '';
      return [art?.capsule, appId && `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`, game.cover].filter(Boolean);
    }
    function cover(game, className) {
      const sources = coverSources(game);
      const box = el('div', className);
      const fallback = () => box.replaceChildren(el('div', 'couch-fallback', String(game.title).slice(0, 2).toUpperCase()));
      if (!sources.length) { fallback(); return box; }
      const image = el('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      let attempt = 0;
      image.onerror = () => { attempt += 1; if (attempt < sources.length) image.src = sources[attempt]; else fallback(); };
      image.onload = () => {
        if (image.naturalWidth <= image.naturalHeight) return;
        const blur = el('img', 'couch-cover-fill'); blur.alt = ''; blur.src = image.currentSrc || image.src;
        box.classList.add('wide');
        box.prepend(blur);
      };
      image.src = sources[0];
      box.append(image);
      return box;
    }

    // The backdrop is the game's wide hero art, sharp, faded into the dark on
    // the left and at the bottom. Only a game without hero art falls back to
    // its blurred cover. Two layers cross-fade when the selection moves.
    let backdropKey = '';
    function backdropSources(game) {
      const appId = /^\d+$/.test(String(game.steamAppId || '')) ? String(game.steamAppId) : '';
      return [
        getArt(game)?.hero && { src: getArt(game).hero, sharp: true },
        appId && { src: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`, sharp: true },
        game.cover && { src: game.cover, sharp: false },
      ].filter(Boolean);
    }
    function setBackdrop(game) {
      const sources = game ? backdropSources(game) : [];
      const key = sources.map(source => source.src).join('|');
      if (key === backdropKey) return;
      backdropKey = key;
      const layers = [...root.querySelectorAll('.couch-bg')];
      const next = layers.find(layer => !layer.classList.contains('shown')) || layers[0];
      const show = () => { if (backdropKey !== key) return; layers.forEach(layer => layer.classList.toggle('shown', layer === next)); };
      if (!sources.length) { layers.forEach(layer => layer.classList.remove('shown')); return; }
      let attempt = 0;
      const tryLoad = () => {
        const source = sources[attempt];
        next.classList.toggle('sharp', source.sharp);
        // A large landscape cover (RAWG art usually is) looks good sharp too;
        // only a small or portrait one is blurred.
        next.onload = () => { if (!source.sharp) next.classList.toggle('sharp', next.naturalWidth >= 1000 && next.naturalWidth > next.naturalHeight); show(); };
        next.onerror = () => { attempt += 1; if (attempt < sources.length && backdropKey === key) tryLoad(); };
        next.src = source.src;
      };
      tryLoad();
    }

    // The selected game's colour tints the progress bar, the selection ring
    // and the active tab.
    let accentFor = null;
    function applyAccent(game) {
      if (!game) { root.style.removeProperty('--game-accent'); accentFor = null; return; }
      if (accentFor === game.id) return;
      accentFor = game.id;
      Promise.resolve(getAccent(game)).then(color => {
        if (!root || accentFor !== game.id) return;
        if (color) root.style.setProperty('--game-accent', color); else root.style.removeProperty('--game-accent');
      }).catch(() => {});
    }

    function renderPanel(game) {
      const box = root.querySelector('.couch-panel');
      box.hidden = !panel || !game;
      if (box.hidden) return;
      box.replaceChildren();
      box.append(el('h2', 'couch-panel-title', game.title));
      const statuses = el('div', 'couch-statuses');
      STATUSES.forEach((status, index) => {
        const chip = el('button', `couch-status${status === game.status ? ' current' : ''}${index === panel.statusIndex ? ' focus' : ''}`, t(status));
        chip.type = 'button'; chip.tabIndex = -1;
        chip.addEventListener('click', () => { panel.statusIndex = index; act('launch'); });
        statuses.append(chip);
      });
      box.append(el('p', 'couch-panel-label', t('Статус')), statuses);
      const minutes = key => (game.hltb && !game.hltb.hidden && Number(game.hltb[key]) > 0 ? Number(game.hltb[key]) * 60000 : 0);
      const rows = [[t('Твій час'), fmtHours(game.playtime || 0)], [t('Main Story'), minutes('mainStoryMinutes')], [t('Main + Extras'), minutes('mainExtraMinutes')], [t('Completionist'), minutes('completionistMinutes')]]
        .filter(([, value]) => value).map(([label, value]) => [label, typeof value === 'number' ? fmtHours(value) : value]);
      const facts = el('dl', 'couch-facts');
      rows.forEach(([label, value]) => facts.append(el('dt', '', label), el('dd', '', value)));
      box.append(el('p', 'couch-panel-label', 'HowLongToBeat'), facts);
      const sessions = [...(Array.isArray(game.sessions) ? game.sessions : [])].filter(session => Number(session?.dur) > 0).sort((a, b) => b.start - a.start).slice(0, 5);
      box.append(el('p', 'couch-panel-label', t('Останні сесії')));
      if (!sessions.length) box.append(el('p', 'couch-panel-empty', t('Ще немає сесій')));
      else {
        const list = el('ul', 'couch-sessions');
        sessions.forEach(session => { const item = el('li'); item.append(el('span', '', formatDate(session.start)), el('b', '', fmtHours(session.dur))); list.append(item); });
        box.append(list);
      }
      const companions = (Array.isArray(game.companions) ? game.companions : []).map(app => app?.name).filter(Boolean);
      if (companions.length) box.append(el('p', 'couch-panel-label', t('Додатковий софт')), el('p', 'couch-panel-text', companions.join(' · ')));
      box.append(el('p', 'couch-panel-hint', t('← → статус · A змінити · B або Y закрити')));
    }

    function render() {
      lists = couchLists(getGames());
      if (!lists[state.tab].length && state.tab === 'recent') state = { tab: 'all', index: 0 };
      const items = lists[state.tab];
      state.index = Math.min(state.index, Math.max(0, items.length - 1));
      const game = items[state.index] || null;
      const activeId = getActiveId();

      root.querySelectorAll('.couch-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === state.tab));
      setBackdrop(game);
      applyAccent(game);
      renderPanel(game);

      const hero = root.querySelector('.couch-hero');
      hero.replaceChildren();
      if (!game) {
        hero.append(el('h1', 'couch-title', t('Тут поки порожньо')), el('p', 'couch-meta', t('Перемкни розділ кнопками LB / RB.')));
      } else {
        const title = el('h1', 'couch-title', game.title);
        const meta = el('p', 'couch-meta', [game.platform, t(game.status || 'Backlog'), `${fmtHours(game.playtime || 0)}`].filter(Boolean).join(' · '));
        hero.append(title, meta);
        const progress = hltbProgress(game);
        if (progress != null) {
          const bar = el('div', 'couch-progress');
          const fill = el('i'); fill.style.width = `${progress}%`;
          bar.append(fill);
          hero.append(bar, el('p', 'couch-progress-label', `${progress}% ${t('від HLTB Main Story')}`));
        }
        if (game.id === activeId) hero.append(el('p', 'couch-now', t('Зараз граєш')));
        else if (!LAUNCHABLE(game)) hero.append(el('p', 'couch-note', t('Запуску немає — A запустить таймер')));
      }

      const row = root.querySelector('.couch-row');
      row.replaceChildren(...items.map((item, index) => {
        const card = el('button', `couch-card${index === state.index ? ' selected' : ''}${item.id === activeId ? ' playing' : ''}`);
        card.type = 'button'; card.tabIndex = -1; card.setAttribute('aria-label', item.title);
        card.append(cover(item, 'couch-cover'));
        card.addEventListener('click', () => { if (state.index === index) act('launch'); else { state.index = index; render(); } });
        return card;
      }));
      const selected = row.children[state.index];
      if (selected) row.style.transform = `translateX(${Math.round(row.parentElement.clientWidth * 0.12 - selected.offsetLeft)}px)`;
      root.querySelector('.couch-count').textContent = items.length ? `${state.index + 1} / ${items.length}` : '';
    }

    function act(action) {
      if (!root) return;
      const game = lists[state.tab][state.index];
      if (panel) {
        if (action === 'exit' || action === 'details') panel = null;
        else if (action === 'left' || action === 'right') panel.statusIndex = Math.max(0, Math.min(STATUSES.length - 1, panel.statusIndex + (action === 'right' ? 1 : -1)));
        // The game may leave this tab with its new status, so the panel closes.
        else if (action === 'launch' && game) { setStatus(game.id, STATUSES[panel.statusIndex]); panel = null; }
        render();
        return;
      }
      if (action === 'details') { if (game) panel = { statusIndex: Math.max(0, STATUSES.indexOf(game.status)) }; render(); return; }
      if (action === 'switch') { openSwitch(); return; }
      if (action === 'exit') { close(); return; }
      if (action === 'launch') {
        const game = lists[state.tab][state.index];
        if (game && game.id !== getActiveId()) launch(game.id);
        render();
        return;
      }
      state = move(state, action, lists);
      render();
    }

    function poll(now) {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      readPad(pads[0] || null, now).forEach(act);
      if (root) frame = requestAnimationFrame(poll);
    }

    function onKey(event) {
      const action = KEYS[event.key] || KEYS[event.key?.toLowerCase?.()];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      act(action);
    }

    function open() {
      if (root) return;
      root = el('div', 'couch');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', t('Режим геймпада'));
      root.tabIndex = -1;
      const backgrounds = [el('img', 'couch-bg'), el('img', 'couch-bg')];
      backgrounds.forEach(layer => { layer.alt = ''; });
      backdropKey = '';
      const top = el('div', 'couch-top');
      const tabs = el('div', 'couch-tabs');
      tabs.append(el('span', 'couch-key', 'LB'), ...TABS.map(tab => { const button = el('button', 'couch-tab', t(LABELS[tab])); button.type = 'button'; button.tabIndex = -1; button.dataset.tab = tab; button.addEventListener('click', () => { state = { tab, index: 0 }; render(); }); return button; }), el('span', 'couch-key', 'RB'));
      top.append(el('div', 'couch-logo', 'PRG'), tabs, el('div', 'couch-count'));
      const track = el('div', 'couch-track');
      track.append(el('div', 'couch-row'));
      const hints = el('div', 'couch-hints');
      [['A', t('Грати')], ['Y', t('Деталі')], ['X', 'Switch'], ['B', t('Вийти')], ['LB RB', t('Розділи')], ['✛', t('Вибір')]].forEach(([key, label]) => { const hint = el('span'); hint.append(el('b', 'couch-key', key), document.createTextNode(label)); hints.append(hint); });
      const details = el('aside', 'couch-panel'); details.hidden = true;
      panel = null; accentFor = null;
      root.append(...backgrounds, el('div', 'couch-shade'), top, el('section', 'couch-hero'), track, hints, details);
      document.body.append(root);
      document.addEventListener('keydown', onKey, true);
      setFullscreen(true);
      render();
      // Local Steam art arrives a moment later; the row is redrawn with it.
      Promise.resolve(loadArt()).then(() => { if (root) render(); }).catch(() => {});
      root.focus({ preventScroll: true });
      frame = requestAnimationFrame(poll);
    }

    function close() {
      if (!root) return;
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      root = null;
      setFullscreen(false);
      onClose?.();
    }

    return { open, close, refresh: () => { if (root) render(); }, isOpen: () => Boolean(root) };
  }

  global.createCouchMode = createCouchMode;
  global.PRGCouch = { couchLists, move, createPadReader, TABS };
})(typeof window !== 'undefined' ? window : globalThis);
