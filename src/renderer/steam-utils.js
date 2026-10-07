// Pure Steam data helpers. IPC, network requests and DOM rendering remain in
// the renderer; this module only normalizes payloads and playtime deltas.
(function exposeSteamUtils(global) {
  function normalizeSteamGame(raw = {}) {
    const appId = Number(raw.appId ?? raw.steamAppId);
    const minutes = Number(raw.minutes ?? raw.playtimeMinutes ?? 0);
    return {
      appId: Number.isFinite(appId) ? appId : null,
      title: String(raw.title || raw.name || '').trim(),
      cover: raw.cover || raw.headerImage || null,
      minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 0,
      installed: Boolean(raw.installed)
    };
  }

  function mergeSteamPlaytime(game, source, wasSteamLinked = false) {
    if (!game || !source) return 0;
    const minutes = Number(source.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) return 0;
    if (game.steamLastSeenMinutes === undefined || game.steamLastSeenMinutes === null) {
      game.steamLastSeenMinutes = minutes;
      if (!wasSteamLinked) game.playtime = Math.max(0, Number(game.playtime || 0)) + minutes * 60000;
      return wasSteamLinked ? 0 : minutes * 60000;
    }
    const previous = Number(game.steamLastSeenMinutes || 0);
    if (minutes <= previous) return 0;
    const delta = (minutes - previous) * 60000;
    game.playtime = Math.max(0, Number(game.playtime || 0)) + delta;
    game.steamLastSeenMinutes = minutes;
    return delta;
  }

  function importErrorMessage(code) {
    return ({
      INVALID_PROFILE: 'Встав повне https-посилання steamcommunity.com/id/… або /profiles/…',
      LOGIN_REQUIRED: 'Увійди знову в PRG Account.',
      SERVER_NOT_CONFIGURED: 'Сервер імпорту ще не налаштовано: потрібен Steam API-ключ у Netlify.',
      SERVER_NOT_DEPLOYED: 'Сервер імпорту ще не опубліковано на Netlify.',
      PROFILE_NOT_FOUND: 'Steam-профіль не знайдено.',
      LIBRARY_PRIVATE: 'Бібліотека недоступна. Відкрий профіль і «Деталі ігор» у налаштуваннях Steam.',
      INCOMPLETE_LIBRARY: 'Steam повернув неповний список. Спробуй ще раз.',
      STEAM_UNAVAILABLE: 'Steam тимчасово недоступний. Спробуй ще раз.'
    })[code] || 'Не вдалося завантажити Steam.';
  }

  global.createSteamUtils = () => ({ normalizeSteamGame, mergeSteamPlaytime, importErrorMessage });
})(window);
