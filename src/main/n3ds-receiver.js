// LAN receiver for the PRG 3DS homebrew. Off by default; when on, it accepts
// one kind of request from the home network: POST /n3ds/v1/upload with the
// 6-digit pairing code shown in the launcher. Everything else is refused.
const crypto = require('crypto')

const DEFAULT_PORT = 47833
const MAX_BODY = 2 * 1024 * 1024
const MAX_FAILURES = 5
const LOCKOUT_MS = 10 * 60 * 1000

// Loopback, RFC 1918 and link-local addresses, also as IPv4-mapped IPv6.
function isLocalAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/i, '')
  if (ip === '::1') return true
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
}

const newCode = (random = crypto.randomInt) => String(random(0, 1000000)).padStart(6, '0')

function sameCode(given, expected) {
  const a = Buffer.from(String(given || ''))
  const b = Buffer.from(String(expected || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function createN3dsReceiver({ http, getCode, onUpload, now = () => Date.now(), log = () => {} }) {
  let server = null
  let failures = 0
  let lockedUntil = 0

  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
    res.end(JSON.stringify(body))
  }

  function handle(req, res) {
    if (!isLocalAddress(req.socket.remoteAddress)) { req.destroy(); return }
    if (req.method !== 'POST' || req.url !== '/n3ds/v1/upload') { reply(res, 404, { ok: false, code: 'not-found' }); return }
    if (now() < lockedUntil) { reply(res, 429, { ok: false, code: 'locked' }); return }
    if (!sameCode(req.headers['x-prg-code'], getCode())) {
      failures += 1
      if (failures >= MAX_FAILURES) { lockedUntil = now() + LOCKOUT_MS; failures = 0; log('[3DS] Too many wrong codes, locked for 10 min') }
      reply(res, 403, { ok: false, code: 'bad-code' })
      return
    }
    failures = 0
    const declared = Number(req.headers['content-length'])
    if (!Number.isFinite(declared) || declared > MAX_BODY) { reply(res, 413, { ok: false, code: 'too-large' }); req.resume(); return }
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) { reply(res, 413, { ok: false, code: 'too-large' }); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', async () => {
      if (res.writableEnded) return
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reply(res, 400, { ok: false, code: 'bad-json' }); return }
      try {
        const result = await onUpload(body)
        reply(res, result.ok ? 200 : 400, result)
      } catch (error) {
        log('[3DS] Upload failed:', error.message)
        reply(res, 500, { ok: false, code: 'failed' })
      }
    })
  }

  function start(port = DEFAULT_PORT) {
    if (server) return Promise.resolve({ ok: true, port })
    return new Promise(resolve => {
      const candidate = http.createServer(handle)
      candidate.requestTimeout = 30000
      candidate.once('error', error => { log('[3DS] Receiver failed:', error.message); resolve({ ok: false, code: error.code === 'EADDRINUSE' ? 'port-in-use' : 'failed' }) })
      candidate.listen(port, '0.0.0.0', () => { server = candidate; resolve({ ok: true, port }) })
    })
  }

  function stop() {
    if (!server) return Promise.resolve()
    const closing = server
    server = null
    return new Promise(resolve => closing.close(() => resolve()))
  }

  return { start, stop, isRunning: () => Boolean(server) }
}

module.exports = { createN3dsReceiver, isLocalAddress, newCode, sameCode, DEFAULT_PORT, MAX_BODY }
