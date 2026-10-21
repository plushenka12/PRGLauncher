const OWNER_UID = 'Qf6BCLccnvfJv5JEjROoxYlwhSv1';
const reply = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data)
});

function parseRequest(body) {
  const input = JSON.parse(body || '{}');
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const pageSize = Number(input.pageSize);
  if (!query || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || ![1, 8].includes(pageSize)) {
    throw new Error('INVALID_QUERY');
  }
  return { query, pageSize };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error('UPSTREAM_ERROR');
  return response.json();
}

exports.parseRequest = parseRequest;
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  let request;
  try { request = parseRequest(event.body); } catch { return reply(400, { error: 'INVALID_QUERY' }); }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return reply(401, { error: 'LOGIN_REQUIRED' });
  const rawgKey = process.env.RAWG_API_KEY;
  const firebaseKey = process.env.FIREBASE_WEB_API_KEY;
  if (!rawgKey || !firebaseKey) return reply(503, { error: 'SERVER_NOT_CONFIGURED' });

  try {
    const account = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token })
    });
    if (account.users?.[0]?.localId !== OWNER_UID) return reply(403, { error: 'ACCESS_DENIED' });
  } catch { return reply(401, { error: 'LOGIN_REQUIRED' }); }

  try {
    const url = new URL('https://api.rawg.io/api/games');
    url.search = new URLSearchParams({ key: rawgKey, search: request.query, page_size: String(request.pageSize), language: 'eng' }).toString();
    const data = await jsonFetch(url);
    if (!Array.isArray(data?.results)) throw new Error('INVALID_RESPONSE');
    const results = data.results.slice(0, request.pageSize).map(game => ({
      id: game.id, name: game.name, released: game.released || null,
      background_image: game.background_image || null,
      genres: Array.isArray(game.genres) ? game.genres.slice(0, 20).map(item => ({ name: item.name })) : [],
      tags: Array.isArray(game.tags) ? game.tags.slice(0, 10).map(item => ({ name: item.name })) : []
    }));
    return reply(200, { results });
  } catch { return reply(502, { error: 'RAWG_UNAVAILABLE' }); }
};
