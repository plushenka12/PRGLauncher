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

  global.createNintendoUtils = () => ({ normalizeNintendoHistory, extractNintendoDaily });
})(window);
