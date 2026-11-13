const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFunctionsServer, loadHandlers, NAMES, MAX_BODY } = require('../server/functions-server.cjs');

async function withServer(handlers, run) {
  const server = createFunctionsServer({ handlers });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('the server runs the unchanged Netlify handlers', () => {
  const handlers = loadHandlers();
  assert.deepEqual(Object.keys(handlers), ['rawg-search', 'steam-library']);
  assert.deepEqual(NAMES, ['rawg-search', 'steam-library']);
  for (const handler of Object.values(handlers)) assert.equal(typeof handler, 'function');
});

test('a request becomes the Netlify event and the reply is passed through', async () => {
  let seen = null;
  await withServer({ 'rawg-search': async event => { seen = event; return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: '{"ok":1}' }; } }, async base => {
    const response = await fetch(`${base}/.netlify/functions/rawg-search?x=1`, { method: 'POST', headers: { Authorization: 'Bearer demo.token', 'Content-Type': 'application/json' }, body: '{"query":"Demo","pageSize":8}' });
    assert.equal(response.status, 201);
    assert.equal(await response.text(), '{"ok":1}');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  assert.equal(seen.httpMethod, 'POST');
  assert.equal(seen.headers.authorization, 'Bearer demo.token');
  assert.equal(seen.body, '{"query":"Demo","pageSize":8}');
});

test('unknown paths, large bodies and handler errors are refused', async () => {
  await withServer({ 'rawg-search': async () => { throw new Error('boom'); }, 'steam-library': async () => ({ statusCode: 200, body: '{}' }) }, async base => {
    for (const url of ['/', '/.netlify/functions/', '/.netlify/functions/constructor', '/.netlify/functions/../index.html', '/.netlify/functions/other']) {
      assert.equal((await fetch(base + url, { method: 'POST' })).status, 404, url);
    }
    const large = await fetch(`${base}/.netlify/functions/steam-library`, { method: 'POST', body: 'x'.repeat(MAX_BODY + 1) }).catch(() => ({ status: 413 }));
    assert.equal(large.status, 413);
    const failed = await fetch(`${base}/.netlify/functions/rawg-search`, { method: 'POST', body: '{}' });
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), '{"error":"SERVER_ERROR"}');
  });
});

test('the deployment keeps keys out of the repository and binds to localhost', () => {
  const service = fs.readFileSync('server/prglauncher-functions.service', 'utf8');
  assert.match(service, /EnvironmentFile=\/etc\/prglauncher\/env/);
  assert.match(service, /User=prglauncher/);
  assert.match(fs.readFileSync('server/functions-server.cjs', 'utf8'), /listen\(port, '127\.0\.0\.1'/);
  const setup = fs.readFileSync('server/setup.sh', 'utf8');
  assert.match(setup, /RAWG_API_KEY=\\nSTEAM_WEB_API_KEY=\\n/, 'secret keys start empty');
  assert.match(setup, /chmod 600 "\$ENV_DIR\/env"/);
  const nginx = fs.readFileSync('server/nginx-prglauncher.conf', 'utf8');
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8787;/);
  assert.match(nginx, /limit_except POST \{ deny all; \}/);
});

test('the guest page opens the owner library without a profile id', () => {
  const site = fs.readFileSync('web-dashboard/index.html', 'utf8');
  assert.match(site, /profileId=params\.get\('u'\)\|\|decodeURIComponent\(location\.pathname\.match\(\/\^\\\/u\\\/\(\[\^\/\]\+\)\\\/\?\$\/\)\?\.\[1\]\|\|''\)\|\|'Qf6BCLccnvfJv5JEjROoxYlwhSv1'/);
});
