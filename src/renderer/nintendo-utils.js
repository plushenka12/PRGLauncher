// Pure Nintendo play-activity normalization. The Nintendo auth bridge and
// renderer import flow stay outside this module.
(function exposeNintendoUtils(global) {
  function normalizeNintendoHistory(data) {
    const found = [];
    const walk = (value, depth = 0) => {
      if (!value || depth > 5) return;
      if (Array.isArray(value)) { value.forEach(item => { if (item && typeof item === 'object') walk(item, depth + 1); }); return; }
      if (typeof value !== 'object') return;
      const looksLikeTitle = value.titleName || value.title_name || value.name || (typeof value.title === 'string' ? value.title : null) || value.title?.titleName || value.title?.name;
      if (looksLikeTitle) found.push(value);
      Object.entries(value).forEach(([key, child]) => { if (/play|history|title|item|data/i.test(key)) walk(child, depth + 1); });
    };
    walk(data);
    return [...new Set(found)].map((item, index) => {
      const title = item?.titleName || item?.name || (typeof item?.title === 'string' ? item.title : null) || item?.title?.titleName || item?.title?.name || item?.title?.title_name || `Nintendo title #${index + 1}`;
      const rawMinutes = item?.totalPlayedMinutes ?? item?.playedMinutes ?? item?.total_played_minutes ?? item?.playTimeMinutes ?? item?.totalPlayedTimeMinutes ?? item?.playTime ?? item?.playtime ?? null;
      const rawHours = item?.totalPlayedHours ?? item?.playedHours ?? item?.total_played_hours ?? null;
      const parseTime = (value, unit) => {
        if (value == null) return 0;
        if (typeof value === 'number') return unit === 'hours' ? value * 60 : value;
        const text = String(value).replace(',', '.');
        const match = text.match(/(\d+(?:\.\d+)?)/);
        if (!match) return 0;
        const number = Number(match[1]);
        return unit === 'hours' || /hour|год/i.test(text) ? number * 60 : number;
      };
      const minutes = rawMinutes != null ? parseTime(rawMinutes, 'minutes') : parseTime(rawHours, 'hours');
      const system = String(item?.platform || item?.system || item?.device || item?.platformName || item?.title?.platform || 'Nintendo Switch');
      const cover = item?.imageUrl || item?.image_url || item?.image?.url || item?.title?.imageUrl || item?.title?.image_url || null;
      const id = String(item?.titleId || item?.title_id || item?.title?.titleId || item?.title?.id || title).trim();
      const lastPlayedAt = item?.lastPlayedAt || item?.lastPlayed || item?.last_played_at || item?.title?.lastPlayedAt || null;
      return { id, title: String(title), minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 0, platform: /switch\s*2|switch2/i.test(system) ? 'Nintendo Switch 2' : 'Nintendo Switch', cover, lastPlayedAt, raw: item };
    }).filter(item => item.title);
  }

  function extractNintendoDaily(item) {
    const out = [];
    const walk = (value, depth = 0) => {
      if (!value || depth > 5) return;
      if (Array.isArray(value)) { value.forEach(child => walk(child, depth + 1)); return; }
      if (typeof value !== 'object') return;
      const dateValue = value.date || value.playDate || value.playedAt || value.played_at || value.day;
      const minutesValue = value.minutes ?? value.playedMinutes ?? value.playTimeMinutes ?? value.playtimeMinutes ?? value.durationMinutes;
      if (dateValue && minutesValue != null) {
        const timestamp = Date.parse(String(dateValue));
        const minutes = Number(minutesValue);
        if (Number.isFinite(timestamp) && Number.isFinite(minutes) && minutes > 0 && minutes < 24 * 60) out.push({ ts: timestamp, minutes, key: `${timestamp}:${minutes}` });
      }
      Object.entries(value).forEach(([key, child]) => { if (/day|date|session|history|play/i.test(key)) walk(child, depth + 1); });
    };
    walk(item);
    return [...new Map(out.map(entry => [entry.key, entry])).values()];
  }

  // The Switch release of a game and its "Nintendo Switch 2 Edition" are
  // separate titles for Nintendo, each with its own play time, but one game
  // in the library. Their names share this key ("… – Nintendo Switch 2
  // Edition + Jamboree TV" included).
  function editionKey(title) {
    return String(title || '').toLocaleLowerCase()
      .replace(/\b(nintendo\s+)?switch\s*2?\s+edition\b.*$/iu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  // Where the sync remembers what it has already counted for one Nintendo
  // title: the card's own fields for its main title, an entry in
  // nintendoEditions for any other edition merged into it.
  const PRIMARY = { minutes: 'nintendoLastSeenMinutes', playedAt: 'nintendoLastSeenPlayedAt', daily: 'nintendoImportedDailyKeys', sync: 'nintendoLastSync' };
  function nintendoTrack(game, id) {
    if (!game.nintendoTitleId) game.nintendoTitleId = id;
    if (game.nintendoTitleId === id) return { edition: false, get: key => game[PRIMARY[key]], set: (key, value) => { game[PRIMARY[key]] = value; } };
    game.nintendoEditions = Array.isArray(game.nintendoEditions) ? game.nintendoEditions : [];
    let edition = game.nintendoEditions.find(entry => entry.id === id);
    if (!edition) { edition = { id, minutes: null, playedAt: null, daily: [], sync: null }; game.nintendoEditions.push(edition); }
    return { edition: true, get: key => edition[key], set: (key, value) => { edition[key] = value; } };
  }

  const ownsTitle = (game, id) => game.nintendoTitleId === id || (Array.isArray(game.nintendoEditions) && game.nintendoEditions.some(entry => entry.id === id));

  // Applies one play-activity record to its card: new daily sessions, then
  // the growth of the title's total since the last sync.
  function applyNintendoItem(game, item, { now = Date.now() } = {}) {
    const track = nintendoTrack(game, item.id);
    let changed = 0, updated = false;
    const hasBaseline = track.get('minutes') !== undefined && track.get('minutes') !== null;
    const previous = Number(track.get('minutes') || 0);
    const current = Math.max(previous, item.minutes || 0);
    const playedAt = Date.parse(item.lastPlayedAt || '');
    const importedDaily = new Set(track.get('daily') || []);
    let dailyChanged = false, dailyMinutesAdded = 0, dailyLatest = 0;
    const dailyAnchor = Number(track.get('playedAt') || game.lastPlayed || 0);
    extractNintendoDaily(item.raw).forEach(day => {
      if (importedDaily.has(day.key)) return;
      const start = new Date(day.ts); start.setHours(12, 0, 0, 0);
      game.sessions = Array.isArray(game.sessions) ? game.sessions : [];
      game.sessions.push({ start: start.getTime(), end: start.getTime() + day.minutes * 60000, dur: day.minutes * 60000, source: 'nintendo-sync' });
      importedDaily.add(day.key);
      game.lastPlayed = Math.max(Number(game.lastPlayed || 0), start.getTime());
      dailyLatest = Math.max(dailyLatest, start.getTime());
      if (hasBaseline && start.getTime() > dailyAnchor) dailyMinutesAdded += day.minutes;
      dailyChanged = true;
    });
    if (dailyChanged) {
      track.set('daily', [...importedDaily]);
      if (dailyMinutesAdded) { game.playtime = Math.max(0, Number(game.playtime || 0) + dailyMinutesAdded * 60000); updated = true; }
      if (dailyLatest > Number(track.get('playedAt') || 0)) track.set('playedAt', dailyLatest);
      changed++;
    }
    if (!hasBaseline) {
      track.set('minutes', current); track.set('playedAt', Number.isFinite(playedAt) ? playedAt : null); track.set('sync', now); changed++;
      // A new edition of a game already in the library brings its own time.
      if (track.edition && current) {
        game.playtime = Math.max(0, Number(game.playtime || 0) + current * 60000);
        if (Number.isFinite(playedAt)) game.lastPlayed = Math.max(Number(game.lastPlayed || 0), playedAt);
        updated = true;
      }
    } else if (current !== previous) {
      const deltaMinutes = current - previous;
      game.playtime = Math.max(0, Number(game.playtime || 0) + deltaMinutes * 60000);
      track.set('minutes', current); track.set('sync', now);
      const sessionStart = Number.isFinite(playedAt) ? playedAt : now - deltaMinutes * 60000;
      game.sessions = Array.isArray(game.sessions) ? game.sessions : [];
      game.sessions.push({ start: sessionStart, end: sessionStart + deltaMinutes * 60000, dur: deltaMinutes * 60000, source: 'nintendo-sync' });
      game.lastPlayed = sessionStart;
      track.set('playedAt', Number.isFinite(playedAt) ? playedAt : sessionStart);
      changed++; updated = true;
    } else if (Number.isFinite(playedAt) && playedAt > Number(game.lastPlayed || 0)) {
      game.lastPlayed = playedAt; track.set('playedAt', playedAt); changed++;
    }
    if (!game.cover && item.cover) { game.cover = item.cover; changed++; }
    return { changed, updated };
  }

  // Merging two cards of different Nintendo titles keeps the second title's
  // sync state, so its later play is still counted once. Returns true when
  // the cards were different titles, whose times then add up.
  function mergeNintendoEditions(primary, duplicate) {
    if (!primary.nintendoTitleId || !duplicate.nintendoTitleId || primary.nintendoTitleId === duplicate.nintendoTitleId) return false;
    primary.nintendoEditions = Array.isArray(primary.nintendoEditions) ? primary.nintendoEditions : [];
    const add = entry => { if (entry.id && entry.id !== primary.nintendoTitleId && !primary.nintendoEditions.some(item => item.id === entry.id)) primary.nintendoEditions.push(entry); };
    add({
      id: duplicate.nintendoTitleId,
      minutes: duplicate.nintendoLastSeenMinutes ?? Math.round(Number(duplicate.playtime || 0) / 60000),
      playedAt: duplicate.nintendoLastSeenPlayedAt ?? null,
      daily: [...(duplicate.nintendoImportedDailyKeys || [])],
      sync: duplicate.nintendoLastSync ?? null,
    });
    (Array.isArray(duplicate.nintendoEditions) ? duplicate.nintendoEditions : []).forEach(entry => add({ ...entry }));
    return true;
  }

  global.createNintendoUtils = () => ({ normalizeNintendoHistory, extractNintendoDaily, editionKey, ownsTitle, applyNintendoItem, mergeNintendoEditions });
})(window);
