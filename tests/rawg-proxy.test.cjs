const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { handler, parseRequest } = require('../netlify/functions/rawg-search');

const ownerUid = 'Qf6BCLccnvfJv5JEjROoxYlwhSv1';
const request = { httpMethod: 'POST', headers: { authorization: 'Bearer demo.token' }, body: JSON.stringify({ query: 'Example Game', pageSize: 8 }) };

test('RAWG proxy accepts only bounded game searches', () => {
  assert.deepEqual(parseRequest(request.body), { query: 'Example Game', pageSize: 8 });
  for (const body of ['{}', '{', JSON.stringify({ query: 'a', pageSize: 100 }), JSON.stringify({ query: 'bad\nname', pageSize: 1 })]) {
    assert.throws(() => parseRequest(body));
  }
});

test('RAWG proxy authenticates the owner, projects results, and never returns keys', async () => {
  const previousFetch = global.fetch;
  const previousRawg = process.env.RAWG_API_KEY;
  const previousFirebase = process.env.FIREBASE_WEB_API_KEY;
  process.env.RAWG_API_KEY = 'demo-rawg-secret';
  process.env.FIREBASE_WEB_API_KEY = 'demo-firebase-identifier';
  const calls = [];
  global.fetch = async url => {
    calls.push(String(url));
    return { ok: true, json: async () => String(url).includes('accounts:lookup')
      ? { users: [{ localId: ownerUid }] }
      : { results: [{ id: 1, name: 'Example Game', released: '2026-01-01', background_image: 'https://media.rawg.io/demo.jpg',
        genres: [{ name: 'Adventure' }], tags: [{ name: 'Open World' }], unwanted: 'not forwarded' }] } };
  };
  try {
    const result = await handler(request);
    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]).hostname, 'api.rawg.io');
    assert.equal(JSON.parse(result.body).results[0].genres[0].name, 'Adventure');
    assert.ok(!result.body.includes('unwanted'));
    assert.ok(!result.body.includes('demo-rawg-secret'));

    let deniedCalls = 0;
    global.fetch = async () => { deniedCalls++; return { ok: true, json: async () => ({ users: [{ localId: 'not-owner' }] }) }; };
    assert.equal((await handler(request)).statusCode, 403);
    assert.equal(deniedCalls, 1, 'denied accounts must not reach RAWG');
    assert.equal((await handler({ ...request, headers: {} })).statusCode, 401);
    assert.equal((await handler({ ...request, httpMethod: 'GET' })).statusCode, 405);
  } finally {
    global.fetch = previousFetch;
    if (previousRawg === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = previousRawg;
    if (previousFirebase === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = previousFirebase;
  }
});

test('launcher routes RAWG through a narrow owner-only IPC bridge, never a renderer key', () => {
  const renderer = fs.readFileSync('src/renderer/index.html', 'utf8');
  const main = fs.readFileSync('src/main/index.js', 'utf8');
  const preload = fs.readFileSync('src/preload/index.js', 'utf8');
  assert.doesNotMatch(renderer, /RAWG_KEY|api\.rawg\.io\/api/);
  assert.match(renderer, /window\.launcher\.searchRawg\(query,pageSize,token\)/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /\.netlify\/functions\/rawg-search/);
  assert.match(preload, /searchRawg: \(query, pageSize, token\) => ipcRenderer\.invoke\('rawg:search'/);
});

test('renderer RAWG lookup keeps normalized-title fallback and authenticates each request', async () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const start = html.indexOf('async function requestRawg(');
  const end = html.indexOf('function showSearchResults(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const owner = { getIdToken: async () => 'demo.token' };
  const sandbox = {
    currentUser: owner,
    normalizeRawgSearchTitle: () => 'Example Game',
    window: { launcher: { searchRawg: async (query, pageSize, token) => {
      calls.push({ query, pageSize, token });
      return { results: query === 'Example Game' ? [{ name: 'Example Game' }] : [] };
    } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end), sandbox);
  const result = await sandbox.searchRAWG('Example Game - Special Edition');
  assert.equal(result.results[0].name, 'Example Game');
  assert.deepEqual(calls, [
    { query: 'Example Game - Special Edition', pageSize: 8, token: 'demo.token' },
    { query: 'Example Game', pageSize: 8, token: 'demo.token' }
  ]);
  sandbox.currentUser = null;
  assert.equal(await sandbox.searchRAWG('Example Game'), null);
});
