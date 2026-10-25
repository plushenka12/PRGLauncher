// Mini-tab page script: player view, installed games and the daily Wrapped.
  const TEXT = {
    uk: {
      playing: 'Зараз граю', last: 'Остання гра', play: 'Грати', stop: 'Завершити сесію', open: 'Відкрити лаунчер', launch: 'Запустити', installed: 'Встановлені',
      never: 'Ще не запускали', today: 'Сьогодні', yesterday: 'Вчора', days: n => `${n} дн. тому`, weeks: n => `${n} тиж. тому`, months: n => `${n} міс. тому`,
      h: n => `${n} год`, m: n => `${n} хв`, playedSuffix: ' зіграно',
      main: 'сюжет', extra: 'сюжет + додатково', full: '100%', next: (name, d) => `${name} ~${d}`, beyond: d => `більше за 100% (~${d})`,
      games: n => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? 'гра' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'гри' : 'ігор'}`; },
      empty: 'Встановлених ігор Steam поки немає.', signedOut: 'Увійди в PRG Account у лаунчері, щоб бачити свої ігри.',
    },
    en: {
      playing: 'Now playing', last: 'Last played', play: 'Play', stop: 'End session', open: 'Open launcher', launch: 'Launch', installed: 'Installed',
      never: 'Not played yet', today: 'Today', yesterday: 'Yesterday', days: n => `${n} days ago`, weeks: n => `${n} weeks ago`, months: n => `${n} months ago`,
      h: n => `${n} h`, m: n => `${n} min`, playedSuffix: ' played',
      main: 'main story', extra: 'main + extras', full: 'completionist', next: (name, d) => `${name} ~${d}`, beyond: d => `past completionist (~${d})`,
      games: n => `${n} ${n === 1 ? 'game' : 'games'}`,
      empty: 'No installed Steam games yet.', signedOut: 'Sign in to PRG Account in the launcher to see your games.',
    },
  };
  const ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6c0 .6.65.97 1.17.66l7.6-4.8a.78.78 0 0 0 0-1.32l-7.6-4.8A.78.78 0 0 0 5 3.2Z"/></svg>',
    stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
  };
  const $ = id => document.getElementById(id);
  let state = { active: false, startedAt: 0, games: [], lang: 'uk', signedIn: false };
  let clock = null;
  let artKey = '';
  let listKey = '';
  let firstList = true;

  const t = () => TEXT[state.lang] || TEXT.uk;
  const pad = n => String(n).padStart(2, '0');
  const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };
  const validAppId = id => /^\d+$/.test(String(id || ''));
  const steamArt = (id, file) => validAppId(id) ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/${file}` : null;
  const legacyArt = (id, file) => validAppId(id) ? `https://cdn.akamai.steamstatic.com/steam/apps/${id}/${file}` : null;
  const portraitSources = game => [game.art?.capsule, steamArt(game.appId, 'library_600x900.jpg'), legacyArt(game.appId, 'library_600x900.jpg'), game.cover, steamArt(game.appId, 'header.jpg')];

  function duration(minutes) {
    const x = t();
    const total = Math.max(0, Math.round(minutes));
    if (total < 60) return x.m(total);
    const hours = total / 60;
    return x.h(hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10);
  }
  function ago(timestamp) {
    const x = t();
    if (!timestamp) return x.never;
    const day = 864e5;
    const today = new Date().setHours(0, 0, 0, 0);
    if (timestamp >= today) return x.today;
    if (timestamp >= today - day) return x.yesterday;
    const days = Math.ceil((today - timestamp) / day);
    if (days < 14) return x.days(days);
    if (days < 60) return x.weeks(Math.round(days / 7));
    return x.months(Math.round(days / 30));
  }
  const playedMinutes = game => ((game.playtime || 0) + (state.active && state.gameId === game.id && state.startedAt ? Date.now() - state.startedAt : 0)) / 60000;
  const subline = game => [ago(game.lastPlayed), game.playtime >= 60000 ? duration(game.playtime / 60000) : ''].filter(Boolean).join(' · ');

  // HLTB milestones the game has, in order; the bar spans to the last one.
  function milestones(game) {
    const x = t();
    const h = game.hltb || {};
    return [['main', h.main], ['extra', h.extra], ['full', h.full]]
      .filter(([, minutes]) => Number.isFinite(minutes) && minutes > 0)
      .map(([key, minutes]) => ({ key, name: x[key], minutes }))
      .filter((stone, index, list) => index === 0 || stone.minutes > list[index - 1].minutes);
  }

  function loadImage(sources) {
    return new Promise(resolve => {
      const queue = sources.filter(Boolean);
      const next = () => {
        const src = queue.shift();
        if (!src) return resolve(null);
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = next;
        img.src = src;
      };
      next();
    });
  }
  // Portrait art fills its frame; landscape art (a header used as a fallback)
  // is shown whole over a blurred copy of itself instead of being cropped.
  function fitPortrait(img) {
    if (!(img.naturalWidth > img.naturalHeight)) return img;
    const box = document.createElement('div');
    box.className = 'letterbox';
    const bg = new Image();
    bg.className = 'bg'; bg.alt = ''; bg.src = img.src;
    img.className = 'fg';
    box.append(bg, img);
    return box;
  }
  function initials(game, className = 'initials') {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = String(game.title || '?').slice(0, 2).toUpperCase();
    return div;
  }

  function heroGame() {
    const games = state.games || [];
    if (state.active) return games.find(game => game.id === state.gameId) || { id: state.gameId, title: state.title, playtime: state.activePlaytime || 0 };
    return games[0] || null;
  }

  function renderProgress(game) {
    const x = t();
    const stones = game ? milestones(game) : [];
    $('hltb').hidden = !stones.length;
    if (!stones.length) return;
    const played = playedMinutes(game);
    const scale = stones[stones.length - 1].minutes;
    $('fill').style.width = `${Math.min(100, played / scale * 100)}%`;
    const track = $('track');
    track.querySelectorAll('.tick').forEach(tick => tick.remove());
    stones.slice(0, -1).forEach(stone => {
      const tick = document.createElement('i');
      tick.className = `tick${played >= stone.minutes ? ' done' : ''}`;
      tick.style.left = `${stone.minutes / scale * 100}%`;
      tick.title = `${stone.name} ~${duration(stone.minutes)}`;
      track.append(tick);
    });
    const amount = document.createElement('b');
    amount.textContent = duration(played);
    $('played').replaceChildren(amount, x.playedSuffix);
    const upcoming = stones.find(stone => played < stone.minutes);
    $('next').textContent = upcoming ? x.next(upcoming.name, duration(upcoming.minutes)) : x.beyond(duration(scale));
  }

  function tick() {
    const game = heroGame();
    // Total time in the game across all sessions, the running one included.
    $('timer').textContent = state.active && game ? fmtClock(playedMinutes(game) * 60000) : '00:00:00';
    if (state.active && game) renderProgress(game);
  }

  function renderNow() {
    const x = t();
    const game = heroGame();
    $('now').hidden = !game;
    $('controls').hidden = !game || (!state.active && !state.signedIn);
    $('now').classList.toggle('active', Boolean(state.active));
    $('label').textContent = state.active ? x.playing : x.last;
    $('title').textContent = game ? game.title : '';
    $('meta-line').textContent = game && !state.active ? subline(game) : '';
    const big = $('big');
    big.className = `big${state.active ? ' stop' : ''}`;
    big.innerHTML = state.active ? ICON.stop : ICON.play;
    const label = game ? `${state.active ? x.stop : x.play}: ${game.title}` : '';
    big.title = label; big.setAttribute('aria-label', label);
    big.onclick = () => {
      if (state.active) { window.launcher?.pauseMiniSession?.(); return; }
      if (game) launch(game.id, big);
    };
    renderProgress(game);
    clearInterval(clock);
    clock = state.active ? setInterval(tick, 1000) : null;
    tick();

    const key = game ? `${game.id}|${game.appId || ''}|${game.cover || ''}` : '';
    if (key === artKey) return;
    artKey = key;
    const cover = $('cover');
    const ambient = $('ambient');
    if (!game) { cover.replaceChildren(); ambient.replaceChildren(); return; }
    cover.replaceChildren(initials(game));
    loadImage(portraitSources(game)).then(img => {
      if (artKey !== key) return;
      if (!img) { ambient.replaceChildren(); return; }
      img.alt = '';
      cover.replaceChildren(fitPortrait(img));
      const glow = new Image();
      glow.alt = ''; glow.src = img.src;
      ambient.replaceChildren(glow);
      requestAnimationFrame(() => requestAnimationFrame(() => glow.classList.add('shown')));
    });
  }

  function thumbFor(game) {
    const box = document.createElement('div');
    box.className = 'thumb';
    box.append(initials(game));
    loadImage(portraitSources(game)).then(img => { if (img) { img.alt = ''; box.replaceChildren(fitPortrait(img)); } });
    return box;
  }

  function launch(id, button) {
    button.disabled = true;
    Promise.resolve(window.launcher?.launchFromMini?.(id)).finally(() => setTimeout(() => { button.disabled = false; }, 1500));
  }

  function renderList() {
    const x = t();
    const all = Array.isArray(state.games) ? state.games : [];
    const hero = heroGame();
    const games = all.filter(game => game.id !== hero?.id);
    $('count').textContent = all.length ? x.games(all.length) : '';
    const key = JSON.stringify([new Date().toDateString(), state.lang, state.signedIn, state.active, state.gameId, all]);
    if (key === listKey) return;
    listKey = key;
    $('empty').hidden = all.length > 0;
    $('empty-text').textContent = state.signedIn ? x.empty : x.signedOut;
    $('empty-open').textContent = x.open;
    $('shelf').hidden = !games.length;
    $('shelf-title').textContent = x.installed;
    const list = $('list');
    list.replaceChildren();
    games.forEach((game, index) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'listitem');
      if (firstList) { row.classList.add('entering'); row.style.animationDelay = `${Math.min(index, 8) * 35}ms`; }
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name'; name.textContent = game.title;
      const sub = document.createElement('div');
      sub.className = 'sub'; sub.textContent = subline(game);
      info.append(name, sub);
      const stones = milestones(game);
      if (stones.length) {
        const track = document.createElement('div');
        track.className = 'mini-track';
        const fill = document.createElement('i');
        fill.style.width = `${Math.min(100, playedMinutes(game) / stones[0].minutes * 100)}%`;
        track.title = `${duration(playedMinutes(game))} / ${stones[0].name} ~${duration(stones[0].minutes)}`;
        track.append(fill);
        info.append(track);
      }
      const button = document.createElement('button');
      button.className = 'play';
      button.innerHTML = ICON.play;
      const label = `${x.launch}: ${game.title}`;
      button.title = label; button.setAttribute('aria-label', label);
      button.onclick = () => launch(game.id, button);
      row.append(thumbFor(game), info, button);
      list.append(row);
    });
    if (games.length) firstList = false;
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    for (const [name, value] of Object.entries(theme)) {
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string' && value.length < 120) document.documentElement.style.setProperty(name, value);
    }
  }

  function render() {
    const x = t();
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'uk';
    $('open').title = x.open; $('open').setAttribute('aria-label', x.open);
    renderNow();
    renderList();
  }

  // ── Wrapped ────────────────────────────────────────────────────────────
  const WTEXT = {
    uk: {
      heading: 'Твій тиждень · 7 днів', played: 'Цього тижня ти грав', days: n => `${n} з 7 днів із грою`,
      top: 'Гра тижня', share: n => `${n}% усього твого часу`, longest: 'Найдовша сесія',
      on: ['у неділю', 'у понеділок', 'у вівторок', 'у середу', 'у четвер', 'у пʼятницю', 'у суботу'],
      versus: 'Порівняно з тижнем раніше', more: d => `+${d}`, less: d => `−${d}`, same: 'Стільки ж',
      moreText: 'Більше, ніж минулого тижня', lessText: 'Менше, ніж минулого тижня', firstText: 'Минулого тижня ти не грав — гарний старт',
      sessions: n => plural(n, 'сесія', 'сесії', 'сесій'), games: n => plural(n, 'гра', 'гри', 'ігор'), go: 'Погнали', close: 'Закрити',
      week: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    },
    en: {
      heading: 'Your week · 7 days', played: 'This week you played', days: n => `${n} of 7 days with games`,
      top: 'Game of the week', share: n => `${n}% of all your time`, longest: 'Longest session',
      on: ['on Sunday', 'on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday'],
      versus: 'Compared with the week before', more: d => `+${d}`, less: d => `−${d}`, same: 'The same',
      moreText: 'More than last week', lessText: 'Less than last week', firstText: 'No games the week before — nice start',
      sessions: n => `${n} ${n === 1 ? 'session' : 'sessions'}`, games: n => `${n} ${n === 1 ? 'game' : 'games'}`, go: "Let's go", close: 'Close',
      week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
  };
  function plural(n, one, few, many) { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`; }
  const wt = () => WTEXT[state.lang] || WTEXT.uk;
  // Hours and minutes as separate parts so the number can be set large.
  function splitDuration(ms) {
    const minutes = Math.round(Math.max(0, ms) / 60000);
    const uk = state.lang !== 'en';
    if (minutes < 60) return [String(minutes), uk ? 'хв' : 'min'];
    const hours = minutes / 60;
    return [String(hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10), uk ? 'год' : 'h'];
  }
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function bigNumber(ms) {
    const [value, unit] = splitDuration(ms);
    const big = el('div', 'w-big w-in');
    const number = el('span', '', '0');
    big.append(number, el('small', '', unit));
    // Count up from zero; the final value is set right away for reduced motion.
    const target = Number(value);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(target)) { number.textContent = value; return big; }
    const decimals = value.includes('.') ? 1 : 0;
    const started = performance.now();
    const step = time => {
      const p = Math.min(1, (time - started) / 900);
      number.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(decimals);
      if (p < 1 && document.body.contains(number)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return big;
  }

  let wrapped = null;
  let seenWrappedId = '';
  let slideIndex = 0;
  let slides = [];

  function topGameSources(top) {
    const known = (state.games || []).find(game => game.id === top.gameId);
    return known ? portraitSources(known) : [steamArt(top.appId, 'library_600x900.jpg'), top.cover, steamArt(top.appId, 'header.jpg')];
  }

  function buildSlides(data) {
    const x = wt();
    const list = [];
    list.push({ bg: 'var(--accent2)', render: slide => {
      slide.append(el('div', 'w-label w-in', x.played), bigNumber(data.playtime));
      const bars = el('div', 'w-bars w-in');
      const peak = Math.max(...data.days.map(day => day.playtime), 1);
      data.days.forEach((day, index) => {
        const bar = el('div', `w-bar${day.playtime ? '' : ' zero'}${index === data.days.length - 1 ? ' today' : ''}`);
        const fill = el('i');
        fill.style.height = `${day.playtime ? Math.max(8, day.playtime / peak * 100) : 0}%`;
        fill.style.animationDelay = `${120 + index * 60}ms`;
        bar.append(fill, el('span', '', x.week[day.weekday]));
        bars.append(bar);
      });
      slide.append(bars, el('div', 'w-sub w-in', x.days(data.activeDays)));
    } });
    list.push({ art: data.top, render: slide => {
      const cover = el('div', 'w-cover w-in');
      cover.append(initials({ title: data.top.title }));
      loadImage(topGameSources(data.top)).then(img => { if (img) { img.alt = ''; cover.replaceChildren(fitPortrait(img)); } });
      const meter = el('div', 'w-meter w-in');
      const fill = el('b');
      fill.style.width = `${Math.min(100, data.top.share)}%`;
      meter.append(fill);
      slide.append(cover, el('div', 'w-label w-in', x.top), el('div', 'w-title w-in', data.top.title), bigNumber(data.top.playtime), meter, el('div', 'w-sub w-in', x.share(data.top.share)));
    } });
    if (data.longest) list.push({ bg: 'color-mix(in srgb,var(--coral) 78%,#000)', render: slide => {
      slide.append(el('div', 'w-label w-in', x.longest), bigNumber(data.longest.dur), el('div', 'w-title w-in', data.longest.title), el('div', 'w-sub w-in', x.on[new Date(data.longest.start).getDay()]));
    } });
    list.push({ bg: 'var(--bg2)', render: slide => {
      const delta = data.playtime - data.previousPlaytime;
      const minutes = Math.round(Math.abs(delta) / 60000);
      const [value, unit] = splitDuration(Math.abs(delta));
      const head = data.previousPlaytime ? (minutes < 1 ? x.same : (delta > 0 ? x.more : x.less)(`${value} ${unit}`)) : `${splitDuration(data.playtime).join(' ')}`;
      const big = el('div', 'w-big w-in', head);
      big.style.color = delta >= 0 ? 'var(--green)' : '#fff';
      big.style.fontSize = '48px';
      const chips = el('div', 'w-chips w-in');
      chips.append(el('span', 'w-chip', x.sessions(data.sessions)), el('span', 'w-chip', x.games(data.games)));
      const cta = el('button', 'w-cta w-in', x.go);
      cta.onclick = closeWrapped;
      slide.append(el('div', 'w-label w-in', x.versus), big, el('div', 'w-sub w-in', data.previousPlaytime ? (delta >= 0 ? x.moreText : x.lessText) : x.firstText), chips, cta);
    } });
    return list;
  }

  function showSlide(index) {
    slideIndex = Math.max(0, Math.min(index, slides.length - 1));
    const current = slides[slideIndex];
    const bg = $('w-bg');
    bg.style.backgroundColor = current.bg || 'var(--bg)';
    bg.replaceChildren();
    if (current.art) {
      loadImage(topGameSources(current.art)).then(img => { if (img && slides[slideIndex] === current) { img.alt = ''; bg.replaceChildren(img); } });
    }
    const progress = $('w-progress');
    progress.replaceChildren(...slides.map((_, i) => {
      const bar = el('i', i < slideIndex ? 'done' : i === slideIndex ? 'now' : '');
      const fill = el('b');
      if (i === slideIndex) fill.addEventListener('animationend', () => nextSlide(), { once: true });
      bar.append(fill);
      return bar;
    }));
    const stage = $('w-stage');
    stage.querySelector('.w-slide')?.remove();
    const slide = el('div', 'w-slide');
    current.render(slide);
    slide.querySelectorAll('.w-in').forEach((node, i) => { if (!node.style.animationDelay) node.style.animationDelay = `${i * 70}ms`; });
    stage.append(slide);
  }
  function nextSlide() { if (slideIndex >= slides.length - 1) closeWrapped(); else showSlide(slideIndex + 1); }

  function openWrapped(data) {
    wrapped = data;
    slides = buildSlides(data);
    const x = wt();
    $('w-heading').textContent = x.heading;
    $('w-close').title = x.close; $('w-close').setAttribute('aria-label', x.close);
    const root = $('wrapped');
    root.hidden = false;
    showSlide(0);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  }
  function closeWrapped() {
    const root = $('wrapped');
    if (root.hidden) return;
    root.classList.remove('open');
    setTimeout(() => { root.hidden = true; $('w-stage').querySelector('.w-slide')?.remove(); wrapped = null; }, 380);
  }
  $('w-close').onclick = closeWrapped;
  $('w-prev').onclick = () => showSlide(slideIndex - 1);
  $('w-next').onclick = () => nextSlide();
  $('wrapped').addEventListener('mouseenter', () => $('wrapped').classList.add('paused'));
  $('wrapped').addEventListener('mouseleave', () => $('wrapped').classList.remove('paused'));
  document.addEventListener('keydown', event => {
    if ($('wrapped').hidden) return;
    if (event.key === 'Escape') closeWrapped();
    else if (event.key === 'ArrowRight') nextSlide();
    else if (event.key === 'ArrowLeft') showSlide(slideIndex - 1);
  });

  window.launcher?.onMiniState?.(next => {
    state = { ...state, ...next };
    applyTheme(next.theme);
    render();
    // Each day's Wrapped plays once per mini-tab.
    if (next.wrapped && next.wrapped.id !== seenWrappedId && !wrapped) {
      seenWrappedId = next.wrapped.id;
      openWrapped(next.wrapped);
    }
  });
  $('open').onclick = () => window.launcher?.restoreMain?.();
  $('empty-open').onclick = () => window.launcher?.restoreMain?.();
  render();
