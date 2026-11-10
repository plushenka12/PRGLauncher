// Local cache of card-sized covers. A remote cover is downloaded once, shrunk
// to the width a library card needs and kept on disk, so the grid shows small
// local files instead of decoding full-size images from the network on every
// launch. The cache is disposable: a missing or broken entry only means the
// card shows the original cover.
const crypto = require('node:crypto')

// The same image hosts the renderer's CSP allows.
const ALLOWED_HOSTS = [/^media\.rawg\.io$/, /^(shared|cdn)\.akamai\.steamstatic\.com$/, /^([a-z0-9-]+\.)*backloggd\.com$/, /^images\.igdb\.com$/]
const MAX_URL_LENGTH = 2000
const MAX_URLS = 5000
const MAX_BYTES = 12 * 1024 * 1024
const THUMB_WIDTH = 480
const INDEX_FILE = 'index.json'

function isAllowedCoverUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return false
  let url
  try { url = new URL(value) } catch { return false }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && ALLOWED_HOSTS.some(host => host.test(url.hostname))
}

const fileNameFor = url => `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`

// fetchImage(url) resolves { buffer, contentType, finalUrl }; shrink(buffer, width)
// resolves a JPEG buffer or null when the image cannot be read.
function createCoverCache({ dir, fs, path, fetchImage, shrink, toFileUrl, concurrency = 2, log = () => {} }) {
  let entries = null // url -> file name
  const failed = new Set()
  const queue = []
  const queued = new Set()
  let active = 0
  let unsaved = 0
  let idleWaiters = []

  function load() {
    if (entries) return entries
    entries = new Map()
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, INDEX_FILE), 'utf8'))
      const files = new Set(fs.readdirSync(dir))
      for (const [url, name] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
        if (isAllowedCoverUrl(url) && name === fileNameFor(url) && files.has(name)) entries.set(url, name)
      }
    } catch {}
    return entries
  }

  function saveIndex() {
    unsaved = 0
    try {
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, INDEX_FILE)
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(Object.fromEntries(entries)))
      fs.renameSync(`${target}.tmp`, target)
    } catch (error) { log('index', error.message) }
  }

  // Every cover that is already on disk: { url: file URL }.
  function index() {
    const result = {}
    for (const [url, name] of load()) result[url] = toFileUrl(path.join(dir, name))
    return result
  }

  async function download(url) {
    const { buffer, contentType, finalUrl } = await fetchImage(url)
    if (finalUrl && !isAllowedCoverUrl(finalUrl)) throw new Error('redirected to another host')
    if (!/^image\//i.test(String(contentType || ''))) throw new Error('not an image')
    if (!buffer || !buffer.length || buffer.length > MAX_BYTES) throw new Error('bad size')
    const thumb = await shrink(buffer, THUMB_WIDTH)
    if (!thumb || !thumb.length) throw new Error('unreadable image')
    const name = fileNameFor(url)
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, name)
    fs.writeFileSync(`${target}.tmp`, thumb)
    fs.renameSync(`${target}.tmp`, target)
    entries.set(url, name)
    unsaved += 1
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const url = queue.shift()
      active += 1
      download(url).catch(error => { failed.add(url); log('cover', error.message) }).finally(() => {
        active -= 1
        queued.delete(url)
        if (unsaved >= 20 || (!queue.length && !active && unsaved)) saveIndex()
        if (!queue.length && !active) { idleWaiters.forEach(resolve => resolve()); idleWaiters = [] }
        pump()
      })
    }
  }

  // The library's current covers: missing ones are fetched in the background
  // and cached covers the library no longer uses are removed.
  function request(urls) {
    const wanted = new Set((Array.isArray(urls) ? urls : []).slice(0, MAX_URLS).filter(isAllowedCoverUrl))
    if (!wanted.size) return { queued: 0, removed: 0 }
    load()
    let removed = 0
    for (const [url, name] of [...entries]) {
      if (wanted.has(url)) continue
      entries.delete(url)
      removed += 1
      try { fs.unlinkSync(path.join(dir, name)) } catch {}
    }
    if (removed) saveIndex()
    let added = 0
    for (const url of wanted) {
      if (entries.has(url) || failed.has(url) || queued.has(url)) continue
      queued.add(url)
      queue.push(url)
      added += 1
    }
    pump()
    return { queued: added, removed }
  }

  const whenIdle = () => (!queue.length && !active ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)))

  return { index, request, whenIdle }
}

module.exports = { createCoverCache, isAllowedCoverUrl, fileNameFor, THUMB_WIDTH, MAX_BYTES }
