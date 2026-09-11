const reply = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
function parseProfile(value) {
  if (typeof value !== 'string' || value.length > 300) throw new Error('INVALID_PROFILE');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com' || url.port || url.username || url.password) throw new Error('INVALID_PROFILE');
  const match = url.pathname.match(/^\/(profiles|id)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match || (match[1] === 'profiles' && !/^7656119\d{10}$/.test(match[2]))) throw new Error('INVALID_PROFILE');
  return { kind: match[1], value: match[2] };
}
async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error('UPSTREAM_ERROR');
  return response.json();
}
exports.parseProfile = parseProfile;
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  let profile;
  try { profile = parseProfile(JSON.parse(event.body || '{}').profile); } catch { return reply(400, { error: 'INVALID_PROFILE' }); }
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return reply(401, { error: 'LOGIN_REQUIRED' });
  const key = process.env.STEAM_WEB_API_KEY;
  if (!key) return reply(503, { error: 'SERVER_NOT_CONFIGURED' });
  try {
    // Firebase validates the token; never trust a UID supplied by the client.
    const firebaseKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBL-IHjUiSlmJ2N_caWx_MWAI8v2RL4Rpw';
    const account = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) });
    if (!account.users?.length) return reply(401, { error: 'LOGIN_REQUIRED' });
  } catch { return reply(401, { error: 'LOGIN_REQUIRED' }); }
  try {
    const steam = async (method, params) => jsonFetch(`https://api.steampowered.com/${method}/?${new URLSearchParams({ key, ...params })}`);
    let steamId = profile.value;
    if (profile.kind === 'id') {
      const resolved = await steam('ISteamUser/ResolveVanityURL/v1', { vanityurl: profile.value });
      if (resolved.response?.success !== 1) return reply(404, { error: 'PROFILE_NOT_FOUND' });
      steamId = resolved.response.steamid;
    }
    const data = await steam('IPlayerService/GetOwnedGames/v1', { steamid: steamId, include_appinfo: 'true', include_played_free_games: 'true', include_free_sub: 'true', skip_unvetted_apps: 'false' });
    const result = data.response;
    if (!result || !Number.isInteger(result.game_count)) return reply(403, { error: 'LIBRARY_PRIVATE' });
    const games = [...new Map((result.games || []).filter(g => Number.isInteger(g.appid) && g.appid > 0).map(g => [g.appid, { appId: g.appid, title: g.name || `Steam game #${g.appid}`, minutes: Math.max(0, Number(g.playtime_forever) || 0), cover: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg` }])).values()];
    if (games.length !== result.game_count) return reply(502, { error: 'INCOMPLETE_LIBRARY' });
    return reply(200, { steamId, games: games.sort((a,b) => a.title.localeCompare(b.title)) });
  } catch { return reply(502, { error: 'STEAM_UNAVAILABLE' }); }
};
