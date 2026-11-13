// Runs the launcher's two server-side integrations (netlify/functions) on the
// owner's own server, behind nginx. The handlers are used unchanged: this file
// only turns a Node HTTP request into the event they expect. It listens on
// localhost; nginx terminates TLS and forwards /.netlify/functions/<name>.
const http = require('node:http');
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'netlify', 'functions');
const NAMES = ['rawg-search', 'steam-library'];
const MAX_BODY = 16 * 1024;

function loadHandlers(dir = FUNCTIONS_DIR) {
  return Object.fromEntries(NAMES.map(name => [name, require(path.join(dir, `${name}.js`)).handler]));
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function createFunctionsServer({ handlers = loadHandlers(), log = () => {} } = {}) {
  return http.createServer((req, res) => {
    const match = /^\/\.netlify\/functions\/([a-z-]+)$/.exec(String(req.url || '').split('?')[0]);
    const handler = match && Object.hasOwn(handlers, match[1]) ? handlers[match[1]] : null;
    if (!handler) { send(res, 404, '{"error":"NOT_FOUND"}'); return; }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { aborted = true; send(res, 413, '{"error":"TOO_LARGE"}'); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      const event = { httpMethod: req.method, headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') };
      try {
        const result = await handler(event);
        send(res, Number(result?.statusCode) || 500, String(result?.body ?? ''), result?.headers || {});
      } catch (error) {
        log(match[1], error?.message);
        send(res, 500, '{"error":"SERVER_ERROR"}');
      }
    });
    req.on('error', () => { aborted = true; });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createFunctionsServer({ log: (name, message) => console.error(`[${name}]`, message) })
    .listen(port, '127.0.0.1', () => console.log(`PRGLauncher functions on 127.0.0.1:${port}`));
}

module.exports = { createFunctionsServer, loadHandlers, NAMES, MAX_BODY };
