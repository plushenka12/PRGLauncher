const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, safeStorage, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const os = require('os')
const fs = require('fs')
const https = require('https')
const { execFile, spawn } = require('child_process')
const crypto = require('crypto')
const { parseRunningSteamAppId } = require('./steam-activity')
const { createNintendoHttpError, requiresNintendoReauth } = require('./nintendo-http')
const { createLaunchAllowlist } = require('./launch-allowlist')
const { attachNavigationGuard } = require('./navigation-guard')
const { runCommand } = require('./run-command')
const { createSteamInstallScanner, readVdfNumber } = require('./steam-install-scan')
const { createActivityScheduler, isGameProcessLog } = require('./steam-activity-scheduler')
const { STEAM_GUARD_SCRIPT, createSteamWindowGuard } = require('./steam-window-guard')
const { resolveMiniTabBounds, loadSavedBounds, saveBounds, isReachable } = require('./mini-tab-bounds')
const { createSteamLibraryArt } = require('./steam-library-art')
const steamLibraryArt = createSteamLibraryArt({ fs, getSteamPath: () => steamPath })

// Keep the Windows app identity and packaged process name discoverable.
if (process.platform === 'win32') app.setAppUserModelId('com.prgtracker.launcher')

// ── CONFIG ────────────────────────────────────────────────────────────────
const STEAM_PATHS = process.platform === 'win32'
  ? [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      process.env.PROGRAMFILES + '\\Steam',
      process.env['PROGRAMFILES(X86)'] + '\\Steam',
    ]
  : process.platform === 'darwin'
    ? [path.join(os.homedir(), 'Library', 'Application Support', 'Steam')]
    : []

// ── STATE ─────────────────────────────────────────────────────────────────
let mainWindow = null
let miniBar    = null
let nintendoAuthWindow = null
let nintendoAuthState = null
let nintendoPlayHistory = null
let updateState = { status: 'idle', version: null, error: null }
let automaticUpdateCheck = false
let isQuitting = false
let updateInstallInProgress = false
let updateInstallTimer = null
let tray       = null
let steamPath  = null
let steamMonitorTimer = null
let steamActivityPolling = false
let steamStatusPolling = false
let steamTrackedApps = new Set()
let steamMonitorStates = new Map()
let steamRunningAppId = null
let steamCollectionTimer = null
let lastBacklogSignature = null
const steamStoreCache = new Map()
let hltbSearchInFlight = null
let hltbLastRequestAt = 0
let hltbCredentials = null
let hltbCredentialsExpiry = 0
let hltbSearchEndpoint = null
let backloggdImportWindow = null
const launchedAtLogin = process.argv.includes('--hidden')

// ── IPC SENDERS ───────────────────────────────────────────────────────────
// The main window and the mini-bar share the preload bridge. Every channel
// belongs to the main window's top frame except the two the mini-bar uses.
const MINI_BAR_CHANNELS = new Set(['mini:restore', 'mini:launch'])

function isMainSender(event) {
  return Boolean(mainWindow) && event?.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
}

function isMiniBarSender(event) {
  return Boolean(miniBar) && event?.sender === miniBar.webContents && event.senderFrame === miniBar.webContents.mainFrame
}

function handleFromMain(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isMainSender(event) && !(MINI_BAR_CHANNELS.has(channel) && isMiniBarSender(event))) {
      throw new Error(`${channel} is not available to this window`)
    }
    return handler(event, ...args)
  })
}

// ── STEAM DETECTION ───────────────────────────────────────────────────────
async function findSteamPath() {
  // On Windows Steam keeps its root in the registry. macOS stores the same
  // steamapps/userdata tree under the user's Application Support directory.
  if (process.platform === 'win32') {
    const reg = await runCommand('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
    const match = reg.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim().replace(/\//g, '\\')
  }

  // Fallback to known paths
  for (const p of STEAM_PATHS) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function isGameInstalled(appId, libraries = getSteamLibraries()) {
  if (!steamPath) return false
  return libraries.some(library => isInstalledManifest(path.join(library, 'steamapps', `appmanifest_${appId}.acf`)))
}

function isInstalledManifest(manifest) {
  try {
    const data = fs.readFileSync(manifest, 'utf8')
    const flags = readVdfNumber(data, 'StateFlags')
    // Steam's installed bit is 4. An absent flag is treated conservatively as not ready.
    return flags !== null && (flags & 4) === 4
  } catch {
    return false
  }
}

function getSteamLibraries() {
  if (!steamPath) return []
  const libraries = [steamPath]
  try {
    const vdf = fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const library = match[1].replace(/\\\\/g, '\\')
      if (!libraries.includes(library)) libraries.push(library)
    }
  } catch {}
  return libraries
}

const steamInstallScanner = createSteamInstallScanner({ fs })

// Steam removes the downloading/<appId> folder when a queued download is
// cancelled, so stale byte counters in a manifest never mean "downloading".
function getInstallProgress(appId, libraries = getSteamLibraries()) {
  return steamInstallScanner.statusFor(appId, steamInstallScanner.scan(libraries), Boolean(steamPath))
}

function readSteamStatuses(appIds, libraries = getSteamLibraries()) {
  const snapshot = steamInstallScanner.scan(libraries)
  return [...appIds].map(appId => steamInstallScanner.statusFor(appId, snapshot, Boolean(steamPath)))
}

async function isGameInLibrary(appId) {
  // Windows exposes installed/owned app records in the registry. macOS does
  // not; imported profile games are treated as library entries and Steam still
  // makes the final ownership decision when the steam:// link is opened.
  if (process.platform === 'darwin') return Boolean(steamPath)
  if (process.platform !== 'win32' || !/^\d+$/.test(String(appId))) return false
  return (await runCommand('reg', ['query', `HKCU\\Software\\Valve\\Steam\\Apps\\${appId}`])).ok
}

async function isSteamRunning() {
  if (process.platform === 'win32') {
    const result = await runCommand('tasklist', ['/fi', 'imagename eq steam.exe', '/fo', 'csv', '/nh'])
    return result.stdout.toLowerCase().includes('steam.exe')
  }
  if (process.platform === 'darwin') return (await runCommand('pgrep', ['-x', 'steam_osx'])).ok
  return false
}

function getSteamExecutable() {
  if (process.platform === 'win32') {
    const executable = steamPath && path.join(steamPath, 'steam.exe')
    return executable && fs.existsSync(executable) ? executable : null
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Steam.app/Contents/MacOS/steam_osx',
      path.join(os.homedir(), 'Applications', 'Steam.app', 'Contents', 'MacOS', 'steam_osx'),
    ]
    return candidates.find(candidate => fs.existsSync(candidate)) || null
  }
  return null
}

async function startSteamSilent() {
  const steamExe = getSteamExecutable()
  if (!steamExe) return
  // Only launch if not already running
  if (await isSteamRunning()) {
    console.log('[Steam] Already running')
    return
  }
  // -silent = start minimized to tray, no main window
  const proc = spawn(steamExe, ['-silent', '-nochatui', '-nofriendsui'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,   // hide console window
  })
  proc.unref()
  console.log('[Steam] Started silently')
}

const STEAM_GUARD_MS = { startup: 60000, launch: 30000, exit: 20000, download: 20000 }
const steamWindowGuard = createSteamWindowGuard({
  spawnGuard: durationMs => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', `& { ${STEAM_GUARD_SCRIPT} } -DurationMs ${Math.round(durationMs)}`], { windowsHide: true }, () => {}),
})

// Keeps Steam's main window hidden for `durationMs` while Steam may surface it
// by itself. Dialogs that need the user stay visible (see steam-window-guard).
function hideSteamWindow(durationMs = STEAM_GUARD_MS.download) {
  if (process.platform === 'darwin') {
    // macOS requires Automation access the first time this runs. Use Steam's
    // bundle id first (the display name can be localized), then fall back to
    // the name used by older Steam builds. This is called only from a
    // launcher-initiated flow after Steam has started its operation.
    const scripts = [
      'tell application id "com.valvesoftware.steam" to hide',
      'tell application "Steam" to hide',
    ]
    const tryHide = index => {
      if (index >= scripts.length) return
      execFile('/usr/bin/osascript', ['-e', scripts[index]], { windowsHide: true }, error => {
        if (!error) return
        if (index + 1 < scripts.length) return tryHide(index + 1)
        console.warn('[Steam] macOS hide unavailable:', error.message)
      })
    }
    tryHide(0)
    return
  }
  // macOS needs Accessibility permission for controlling another app's window.
  // Do not request that intrusive permission just to hide Steam; launching via
  // steam:// stays supported and the user remains in control of Steam's UI.
  if (process.platform !== 'win32') return
  // Steam has no Electron API. The client and downloads keep running in its
  // tray process while the library window is hidden.
  steamWindowGuard.guard(durationMs)
}

function publishSteamStatus(appId, status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steam:status', { appId, ...status })
}

async function pollSteamStatus() {
  if (steamStatusPolling || !steamTrackedApps.size) return
  steamStatusPolling = true
  try {
    const appIds = [...steamTrackedApps]
    readSteamStatuses(appIds).forEach((status, index) => {
      const appId = appIds[index]
      const signature = JSON.stringify(status)
      if (steamMonitorStates.get(appId) !== signature) {
        steamMonitorStates.set(appId, signature)
        publishSteamStatus(appId, status)
      }
    })
  } finally {
    steamStatusPolling = false
  }
}

function getRunningSteamAppId() {
  // Windows reports the active app through the Steam registry. There is no
  // equivalent stable, permission-free API on macOS, so manual sessions and
  // Steam profile import still work while automatic local game detection is
  // intentionally disabled there.
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\Apps', '/s', '/v', 'Running'], { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (error, output) => {
      resolve(error ? undefined : parseRunningSteamAppId(output))
    })
  })
}

// Resolves whether a Steam game is running, or undefined when the check failed.
async function pollSteamActivity() {
  if (steamActivityPolling) return undefined
  steamActivityPolling = true
  try {
    const runningAppId = await getRunningSteamAppId()
    if (runningAppId === undefined) return undefined
    if (runningAppId !== steamRunningAppId) {
      // Steam often brings its library forward when a game exits.
      if (steamRunningAppId && !runningAppId && process.platform === 'win32') hideSteamWindow(STEAM_GUARD_MS.exit)
      steamRunningAppId = runningAppId
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steam:runningApp', { appId: runningAppId })
    }
    return Boolean(runningAppId)
  } finally {
    steamActivityPolling = false
  }
}

const steamActivity = createActivityScheduler({ poll: pollSteamActivity })
let steamLogWatcher = null

// Steam's game-process log changes the moment a game starts or exits, so a
// watcher on it makes detection immediate while the registry is read rarely.
function watchSteamGameLog() {
  if (steamLogWatcher || !steamPath) return
  try {
    steamLogWatcher = fs.watch(path.join(steamPath, 'logs'), (_, filename) => {
      if (isGameProcessLog(filename)) steamActivity.notify()
    })
    steamLogWatcher.on('error', () => stopSteamGameLogWatch())
  } catch {
    steamLogWatcher = null
  }
}

function stopSteamGameLogWatch() {
  try { steamLogWatcher?.close() } catch {}
  steamLogWatcher = null
}

function startSteamMonitor() {
  if (!steamMonitorTimer) steamMonitorTimer = setInterval(pollSteamStatus, 10000)
  steamActivity.start()
  watchSteamGameLog()
}

function stopSteamActivity() {
  steamActivity.stop()
  stopSteamGameLogWatch()
  steamWindowGuard.stop()
}

function getSteamCollection(name) {
  if (!steamPath) return { found: false, appIds: [] }
  const usersDir = path.join(steamPath, 'userdata')
  let users = []
  try { users = fs.readdirSync(usersDir, { withFileTypes: true }).filter(item => item.isDirectory() && /^\d+$/.test(item.name)).map(item => item.name) } catch {}
  for (const userId of users) {
    const cloudDir = path.join(usersDir, userId, 'config', 'cloudstorage')
    try {
      const namespaces = JSON.parse(fs.readFileSync(path.join(cloudDir, 'cloud-storage-namespaces.json'), 'utf8'))
      const active = [...namespaces].filter(item => Number(item[1]) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? 1
      const entries = JSON.parse(fs.readFileSync(path.join(cloudDir, `cloud-storage-namespace-${active}.json`), 'utf8'))
      for (const [key, entry] of entries) {
        if (!String(key).startsWith('user-collections.') || entry?.is_deleted || !entry?.value) continue
        const collection = JSON.parse(entry.value)
        if (String(collection.name || '').trim().toLocaleLowerCase() !== String(name).trim().toLocaleLowerCase()) continue
        const removed = new Set((collection.removed || []).map(Number))
        const appIds = [...new Set((collection.added || []).map(Number).filter(appId => Number.isInteger(appId) && appId > 0 && !removed.has(appId)))]
        return { found: true, userId, name: collection.name, appIds }
      }
    } catch {}
  }
  return { found: false, appIds: [] }
}

function pollBacklogCollection() {
  const collection = getSteamCollection('BACKLOG')
  const signature = JSON.stringify(collection.appIds)
  if (signature !== lastBacklogSignature) {
    lastBacklogSignature = signature
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steam:collection', collection)
  }
}

function startSteamCollectionMonitor() {
  if (steamCollectionTimer) return
  steamCollectionTimer = setInterval(pollBacklogCollection, 60000)
  pollBacklogCollection()
}

// Store lookups run in the main process rather than the renderer. Steam's API
// does not consistently allow browser-context requests from an Electron file,
// which previously made collection imports fall back to numeric App IDs.
function getSteamStoreGame(appId) {
  const id = String(appId || '')
  if (!/^\d+$/.test(id)) return Promise.resolve({ appId: Number(appId), title: null, cover: null })
  if (steamStoreCache.has(id)) return Promise.resolve(steamStoreCache.get(id))
  return new Promise(resolve => {
    const request = https.get(`https://store.steampowered.com/api/appdetails?appids=${id}&l=ukrainian&cc=UA`, {
      headers: { 'User-Agent': 'PRGLauncher/1.0 (+local Steam collection importer)', Accept: 'application/json' }
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          const data = JSON.parse(body)[id]?.data
          const game = { appId: Number(id), title: data?.name || null, cover: data?.header_image || null }
          if (game.title) steamStoreCache.set(id, game)
          resolve(game)
        } catch { resolve({ appId: Number(id), title: null, cover: null }) }
      })
    })
    request.setTimeout(8000, () => request.destroy())
    request.on('error', () => resolve({ appId: Number(id), title: null, cover: null }))
  })
}

// ── HOWLONGTOBEAT ─────────────────────────────────────────────────────────
// HLTB intentionally rotates the credentials used by its search endpoint.  A
// tiny hidden BrowserWindow lets the site make its own search request, then we
// only consume that response.  It keeps the integration keyless and avoids
// distributing a hard-coded / expired HLTB token with PRGLauncher.
const HLTB_ORIGIN = 'https://howlongtobeat.com'
const HLTB_MIN_REQUEST_GAP = 1200
const HLTB_SEARCH_TIMEOUT = 18000
const HLTB_CREDENTIAL_CACHE_MS = 30 * 60 * 1000
const HLTB_SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000
const hltbSearchCache = new Map()

function hltbMinutes(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null
}

function getHltbRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.data?.games)) return payload.data.games
  if (Array.isArray(payload?.games)) return payload.games
  return []
}

function normalizeHltbResults(payload) {
  const seen = new Set()
  return getHltbRows(payload).map(row => {
    const id = Number(row?.game_id ?? row?.id)
    const title = String(row?.game_name ?? row?.name ?? '').trim()
    if (!Number.isInteger(id) || id <= 0 || !title || seen.has(id)) return null
    seen.add(id)
    const date = String(row?.release_world ?? row?.game_name_date ?? row?.game_release_date ?? '')
    const yearMatch = date.match(/(?:19|20)\d{2}/)
    return {
      id,
      title: title.slice(0, 240),
      year: yearMatch ? Number(yearMatch[0]) : null,
      mainStoryMinutes: hltbMinutes(row?.comp_main),
      mainExtraMinutes: hltbMinutes(row?.comp_plus),
      completionistMinutes: hltbMinutes(row?.comp_100),
      allStylesMinutes: hltbMinutes(row?.comp_all),
      sourceUrl: `${HLTB_ORIGIN}/game/${id}`
    }
  }).filter(Boolean).slice(0, 12)
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function hltbHeader(headers, name) {
  const wanted = name.toLowerCase()
  const key = Object.keys(headers || {}).find(header => header.toLowerCase() === wanted)
  return key ? headers[key] : null
}

function createHltbPayload(query, credentials) {
  const payload = {
    searchType: 'games',
    searchTerms: query.toLowerCase().split(/\s+/),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: null, max: null }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' }, filter: '', sort: 0, randomizer: 0
    },
    useCache: true
  }
  if (credentials.hpKey && credentials.hpValue) payload[credentials.hpKey] = credentials.hpValue
  return payload
}

function captureHltbCredentials() {
  if (hltbCredentials && hltbSearchEndpoint && Date.now() < hltbCredentialsExpiry) return Promise.resolve(hltbCredentials)
  return new Promise(resolve => {
    let lookupWindow = null
    let lookupSession = null
    let settled = false
    const finish = (credentials, endpoint = null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { lookupSession?.webRequest.onBeforeSendHeaders(null) } catch {}
      if (lookupWindow && !lookupWindow.isDestroyed()) lookupWindow.destroy()
      if (credentials) {
        hltbCredentials = credentials
        if (endpoint) hltbSearchEndpoint = endpoint
        hltbCredentialsExpiry = Date.now() + HLTB_CREDENTIAL_CACHE_MS
      }
      resolve(credentials || null)
    }
    const timeout = setTimeout(() => finish(null), HLTB_SEARCH_TIMEOUT)
    try {
      // A fresh, private partition guarantees that no HLTB cookies or tokens
      // bleed into PRGLauncher, while the site can still create the one
      // short-lived request that contains its current credentials.
      const partition = `hltb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      lookupWindow = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
      })
      lookupSession = lookupWindow.webContents.session
      // HLTB periodically renames its search endpoint (/api/search/site,
      // /api/find, /api/locate, ...). Watch the actual authenticated POST
      // instead of hard-coding one historical path.
      lookupSession.webRequest.onBeforeSendHeaders({ urls: [`${HLTB_ORIGIN}/api/*`] }, (details, callback) => {
        callback({ cancel: false, requestHeaders: details.requestHeaders })
        if (details.method !== 'POST') return
        const authToken = hltbHeader(details.requestHeaders, 'x-auth-token')
        const hpKey = hltbHeader(details.requestHeaders, 'x-hp-key')
        const hpValue = hltbHeader(details.requestHeaders, 'x-hp-val')
        if (!authToken) return
        finish({ authToken, hpKey, hpValue, userAgent: hltbHeader(details.requestHeaders, 'user-agent') || '' }, String(details.url || '').split('?')[0])
      })
      lookupWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) finish(null)
      })
      // `?q=` makes HLTB's own page issue one normal search. We do not submit
      // a fabricated request from the renderer or persist any credentials.
      lookupWindow.loadURL(`${HLTB_ORIGIN}/?q=zelda`).catch(() => finish(null))
    } catch { finish(null) }
  })
}

function postHltbSearch(query, credentials) {
  return new Promise(resolve => {
    const body = JSON.stringify(createHltbPayload(query, credentials))
    const request = https.request(hltbSearchEndpoint || `${HLTB_ORIGIN}/api/search/site`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Origin: HLTB_ORIGIN,
        Referer: `${HLTB_ORIGIN}/`,
        'User-Agent': credentials.userAgent,
        'x-auth-token': credentials.authToken
      }
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk; if (text.length > 2_000_000) request.destroy() })
      response.on('end', () => {
        let payload = null
        try { payload = text ? JSON.parse(text) : null } catch {}
        resolve({ status: response.statusCode || 0, payload })
      })
    })
    if (credentials.hpKey) request.setHeader('x-hp-key', credentials.hpKey)
    if (credentials.hpValue) request.setHeader('x-hp-val', credentials.hpValue)
    request.setTimeout(15000, () => request.destroy())
    request.on('error', () => resolve({ status: 0, payload: null }))
    request.end(body)
  })
}

async function searchHltb(query) {
  // Storefronts use several visually different apostrophes and trademark
  // symbols. HLTB's search is token based, so send a stable plain-text query.
  const normalizedQuery = String(query || '')
    .normalize('NFKC')
    .replace(/[®™©]/gu, ' ')
    .replace(/[’‘`´']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (!normalizedQuery || normalizedQuery.length > 160) return { ok: false, error: 'INVALID_QUERY', results: [] }
  if (hltbSearchInFlight) return { ok: false, error: 'BUSY', results: [] }
  const cacheKey = normalizedQuery.toLocaleLowerCase()
  const cached = hltbSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.savedAt < HLTB_SUCCESS_CACHE_MS) {
    return { ok: true, cached: true, results: cached.results.map(result => ({ ...result })) }
  }

  hltbSearchInFlight = (async () => {
    const remainingGap = HLTB_MIN_REQUEST_GAP - (Date.now() - hltbLastRequestAt)
    if (remainingGap > 0) await wait(remainingGap)
    hltbLastRequestAt = Date.now()

    for (let attempt = 0; attempt < 3; attempt++) {
      const credentials = await captureHltbCredentials()
      if (!credentials) {
        if (attempt < 2) {
          await wait(1200 * (attempt + 1))
          continue
        }
        const fallback = hltbSearchCache.get(cacheKey)
        return fallback
          ? { ok: true, cached: true, stale: true, results: fallback.results.map(result => ({ ...result })) }
          : { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
      }
      const response = await postHltbSearch(normalizedQuery, credentials)
      const results = normalizeHltbResults(response.payload)
      if (response.status >= 200 && response.status < 300) {
        if (!results.length) return { ok: false, error: 'NO_RESULTS', results: [] }
        hltbSearchCache.set(cacheKey, { savedAt: Date.now(), results: results.map(result => ({ ...result })) })
        return { ok: true, results }
      }
      // HLTB uses these status codes when its short-lived credentials rotated.
      if ([401, 403, 404].includes(response.status)) {
        hltbCredentials = null
        hltbCredentialsExpiry = 0
        hltbSearchEndpoint = null
      } else if (![0, 408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        const fallback = hltbSearchCache.get(cacheKey)
        if (fallback) return { ok: true, cached: true, stale: true, results: fallback.results.map(result => ({ ...result })) }
        return { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
      }
      if (attempt < 2) await wait(900 * (attempt + 1))
    }
    const fallback = hltbSearchCache.get(cacheKey)
    return fallback
      ? { ok: true, cached: true, stale: true, results: fallback.results.map(result => ({ ...result })) }
      : { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
  })()

  try { return await hltbSearchInFlight }
  finally { hltbSearchInFlight = null }
}

function parseHltbMinutes(value, unit = 'hours') {
  const number = Number(String(value ?? '').replace(',', '.').replace('½', '.5').replace(/[^\d.].*$/u, ''))
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(unit.toLowerCase().startsWith('min') ? number : number * 60)
}

function parseHltbDetailPage(page, id, sourceUrl) {
  const text = String(page?.text || '')
  const source = String(page?.html || '') + '\n' + text
  const readJsonNumber = keys => {
    for (const key of keys) {
      const match = source.match(new RegExp("[\\\"']" + key + "[\\\"']\\s*:\\s*[\\\"']?([0-9]+(?:\\.[0-9]+)?)[\\\"']?", 'i'))
      if (match) return parseHltbMinutes(match[1], 'minutes')
    }
    return null
  }
  const readLabel = labels => {
    for (const label of labels) {
      const match = text.match(new RegExp(label + '[^\\d]{0,80}([0-9]+(?:[.,][0-9]+)?(?:\\s*½)?)\\s*(hours?|hrs?|minutes?|mins?)', 'i'))
      if (match) return parseHltbMinutes(match[1], match[2])
    }
    return null
  }
  const titleMatch = source.match(/[\"'](?:game_name|name|title)[\"']\\s*:\\s*[\"']([^\"']{2,240})[\"']/i) || text.match(/^(?:How Long to Beat|HLTB)?\\s*([^\\n]{2,160})/i)
  const result = {
    id: Number(id),
    title: titleMatch?.[1]?.trim() || 'HLTB game #' + id,
    year: null,
    mainStoryMinutes: readJsonNumber(['comp_main', 'mainStoryMinutes']) ?? readLabel(['Main Story', 'Main']),
    mainExtraMinutes: readJsonNumber(['comp_plus', 'mainExtraMinutes']) ?? readLabel(['Main\\s*\\+\\s*Extras', 'Main\\s*Extra', 'Main Plus Extras']),
    completionistMinutes: readJsonNumber(['comp_100', 'completionistMinutes']) ?? readLabel(['Completionist', '100%']),
    allStylesMinutes: readJsonNumber(['comp_all', 'allStylesMinutes']) ?? readLabel(['All Styles', 'All Playstyles']),
    sourceUrl
  }
  return result.title && [result.mainStoryMinutes, result.mainExtraMinutes, result.completionistMinutes, result.allStylesMinutes].some(Number.isFinite) ? result : null
}

function fetchHltbGamePage(url) {
  return new Promise(resolve => {
    let pageWindow = null
    let settled = false
    const finish = result => { if (settled) return; settled = true; clearTimeout(timeout); if (pageWindow && !pageWindow.isDestroyed()) pageWindow.destroy(); resolve(result || null) }
    const timeout = setTimeout(() => finish(null), HLTB_SEARCH_TIMEOUT)
    try {
      const parsed = new URL(String(url || ''))
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'howlongtobeat.com' || !/^\/game\/\d+(?:\/[^/]*)?\/?$/i.test(parsed.pathname)) return finish(null)
      const id = parsed.pathname.match(/^\/game\/(\d+)/i)?.[1]
      pageWindow = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { partition: 'hltb-detail-' + process.pid + '-' + Date.now(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
      pageWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) finish(null) })
      pageWindow.webContents.on('did-finish-load', async () => {
        try {
          const page = await pageWindow.webContents.executeJavaScript('(() => ({ text: document.body?.innerText || \"\", html: [...document.scripts].map(s => s.textContent || \"\").filter(s => /comp_main|Main Story|game_name|completionist/i.test(s)).join(\"\\\\n\").slice(0, 600000) }))()')
          finish(parseHltbDetailPage(page, id, parsed.toString()))
        } catch { finish(null) }
      })
      pageWindow.loadURL(parsed.toString()).catch(() => finish(null))
    } catch { finish(null) }
  })
}

// ── IPC HANDLERS ──────────────────────────────────────────────────────────
handleFromMain('steam:launchGame', async (_, appId) => {
  const normalizedAppId = String(appId || '')
  if (!/^\d+$/.test(normalizedAppId)) return { action: 'error', message: 'Invalid Steam App ID' }

  const installed = isGameInstalled(normalizedAppId)

  // Ownership is not reliably stored in the Windows registry. Let the logged-in
  // Steam client make that decision: it can launch an owned game or offer its
  // normal install/purchase flow without producing a false "not owned" result.
  await shell.openExternal(`steam://run/${normalizedAppId}`)
  steamActivity.notify()
  // Steam may surface its library window to hand off a launch; keep it hidden
  // for this launcher-initiated path. Launch and install dialogs stay visible.
  hideSteamWindow(STEAM_GUARD_MS.launch)
  return { action: 'requested', appId: normalizedAppId, installed }
})

handleFromMain('steam:gameStatus', async (_, appId) => {
  if (!appId) return { status: 'unknown' }
  const installed = isGameInstalled(appId)
  const inLibrary = installed || await isGameInLibrary(appId)
  return {
    status: installed ? 'installed' : inLibrary ? 'in_library' : 'not_owned',
    steamPath
  }
})

handleFromMain('steam:installStatus', async (_, appId) => {
  const normalizedAppId = String(appId || '')
  if (!/^\d+$/.test(normalizedAppId)) return { state: 'error', message: 'Invalid Steam App ID' }
  return getInstallProgress(normalizedAppId)
})

handleFromMain('steam:requestInstall', async (_, appId) => {
  const normalizedAppId = String(appId || '')
  if (!/^\d+$/.test(normalizedAppId)) return { action: 'error', message: 'Invalid Steam App ID' }
  await shell.openExternal(`steam://install/${normalizedAppId}`)
  // Do not focus the launcher or hide Steam here. Steam must keep the library
  // picker/modal in the foreground so the user can choose an install drive.
  // The renderer hides Steam only after its status changes to `downloading`,
  // which means the picker has already been accepted and the download is safe
  // to continue in the background.
  return { action: 'requested' }
})

handleFromMain('steam:hideWindow', () => hideSteamWindow())

handleFromMain('steam:trackApps', (_, appIds) => {
  const nextApps = new Set((Array.isArray(appIds) ? appIds : [])
    .map(appId => String(appId))
    .filter(appId => /^\d+$/.test(appId)))
  if (nextApps.size === steamTrackedApps.size && [...nextApps].every(appId => steamTrackedApps.has(appId))) return
  steamTrackedApps = nextApps
  steamMonitorStates.clear()
  pollSteamStatus()
  startSteamMonitor()
})

handleFromMain('steam:getCollection', (_, name) => getSteamCollection(name))

handleFromMain('steam:profileLibrary', async (_, payload) => {
  if (!payload || typeof payload.profile !== 'string' || payload.profile.length > 300 || typeof payload.token !== 'string' || payload.token.length > 10000) return { error: 'INVALID_PROFILE' }
  try {
    return await new Promise((resolve, reject) => {
      const request = https.request('https://prgtracker.netlify.app/.netlify/functions/steam-library', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.token}` } }, response => {
        let body = ''; response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; if (body.length > 10000000) request.destroy(new Error('Response too large')) });
        response.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({ error: 'SERVER_NOT_DEPLOYED' }) } });
        response.on('error', reject);
      });
      request.setTimeout(45000, () => request.destroy(new Error('Timeout')));
      request.on('error', reject); request.end(JSON.stringify({ profile: payload.profile }));
    });
  } catch { return { error: 'STEAM_UNAVAILABLE' } }
})

handleFromMain('rawg:search', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { error: 'ACCESS_DENIED' }
  if (!payload || typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 200
    || ![1, 8].includes(payload.pageSize) || typeof payload.token !== 'string' || payload.token.length > 10000) {
    return { error: 'INVALID_QUERY' }
  }
  try {
    const response = await fetch('https://prgtracker.netlify.app/.netlify/functions/rawg-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.token}` },
      body: JSON.stringify({ query: payload.query, pageSize: payload.pageSize }),
      signal: AbortSignal.timeout(16000),
      redirect: 'error'
    })
    const body = await response.text()
    if (body.length > 1000000) return { error: 'RAWG_UNAVAILABLE' }
    const data = JSON.parse(body)
    return response.ok && Array.isArray(data?.results) ? { results: data.results } : { error: data?.error || 'RAWG_UNAVAILABLE' }
  } catch { return { error: 'RAWG_UNAVAILABLE' } }
})

handleFromMain('steam:importGames', async () => {
  const found = new Map()
  for (const library of getSteamLibraries()) {
    const directory = path.join(library, 'steamapps')
    let files = []; try { files = fs.readdirSync(directory) } catch { continue }
    for (const file of files.filter(name => /^appmanifest_\d+\.acf$/.test(name))) {
      try {
        const data = fs.readFileSync(path.join(directory, file), 'utf8')
        const appId = readVdfNumber(data, 'appid')
        if (!appId) continue
        found.set(appId, { appId, title: data.match(/"name"\s+"([^"]+)"/)?.[1] || `Steam game #${appId}`, cover: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` })
      } catch {}
    }
  }
  return { found: Boolean(steamPath), games: [...found.values()].sort((a,b) => a.title.localeCompare(b.title)) }
})

handleFromMain('steam:getStoreGames', async (_, appIds) => {
  const ids = [...new Set((Array.isArray(appIds) ? appIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 100)
  return Promise.all(ids.map(getSteamStoreGame))
})

handleFromMain('steam:getRunningAppId', async () => {
  return { appId: (await getRunningSteamAppId()) ?? null }
})

let launchAllowlist = null
function getLaunchAllowlist() {
  if (!launchAllowlist) launchAllowlist = createLaunchAllowlist({ filePath: path.join(app.getPath('userData'), 'launch-allowlist.json'), fs })
  return launchAllowlist
}

// A path that did not come from the file picker (an older library entry, a
// synced PC or an imported backup) needs one native confirmation the renderer
// cannot answer for the user.
async function confirmUnknownExecutable(executable, args) {
  const uk = String(app.getLocale() || '').toLowerCase().startsWith('uk')
  const detail = [executable, args.length ? args.join(' ') : ''].filter(Boolean).join('\n')
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'PRGLauncher',
    message: uk ? 'Дозволити PRGLauncher запустити цю програму?' : 'Allow PRGLauncher to run this program?',
    detail: `${detail}\n\n${uk ? 'Її не було вибрано через діалог на цьому ПК. Запускайте лише програми, яким довіряєте.' : 'It was not chosen with the file picker on this PC. Only run programs you trust.'}`,
    buttons: uk ? ['Запустити', 'Скасувати'] : ['Run', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  return result.response === 0
}

ipcMain.handle('local:chooseExecutable', async (event) => {
  if (!isMainSender(event)) return { canceled: true }
  const filters = process.platform === 'win32'
    ? [{ name: 'Executable', extensions: ['exe', 'bat', 'cmd'] }]
    : process.platform === 'darwin'
      ? [{ name: 'Application', extensions: ['app'] }]
      : []
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose game executable', properties: ['openFile'], filters })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  getLaunchAllowlist().add(result.filePaths[0])
  return { canceled: false, path: result.filePaths[0] }
})

function parseLaunchArguments(value) {
  const input = String(value || '').trim()
  if (!input) return []
  const args = []
  input.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g, (_match, quoted, single, bare) => {
    args.push(String(quoted ?? single ?? bare ?? '').replace(/\\([\\"'])/g, '$1'))
    return _match
  })
  return args.slice(0, 32)
}

ipcMain.handle('local:launchGame', async (event, payload) => {
  if (!isMainSender(event)) return { action: 'error', message: 'Launch request was rejected' }
  const data = typeof payload === 'string' ? { executable: payload } : (payload || {})
  const executable = String(data.executable || '')
  if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable)) return { action: 'error', message: 'Executable was not found' }
  const allowlist = getLaunchAllowlist()
  if (!allowlist.has(executable)) {
    if (!(await confirmUnknownExecutable(executable, parseLaunchArguments(data.arguments)))) return { action: 'cancelled' }
    allowlist.add(executable)
  }
  if (process.platform === 'darwin' && executable.toLowerCase().endsWith('.app')) {
    const error = await shell.openPath(executable)
    return error ? { action: 'error', message: error } : { action: 'requested' }
  }
  const cwd = String(data.workingDirectory || '').trim()
  const workingDirectory = cwd && path.isAbsolute(cwd) && fs.existsSync(cwd) ? cwd : path.dirname(executable)
  const child = spawn(executable, parseLaunchArguments(data.arguments), { cwd: workingDirectory, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return { action: 'requested' }
})

handleFromMain('hltb:search', async (_, query) => searchHltb(query))
handleFromMain('hltb:fetchGame', async (_, url) => {
  const result = await fetchHltbGamePage(url)
  return result ? { ok: true, result } : { ok: false, error: 'HLTB_DETAIL_UNAVAILABLE' }
})
handleFromMain('hltb:openGame', async (_, url) => {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'howlongtobeat.com' || !/^\/game\/\d+\/?$/.test(parsed.pathname)) return { ok: false }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch { return { ok: false } }
})
handleFromMain('app:openExternal', async (_, url) => {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'prgtracker.netlify.app') return { ok: false }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch { return { ok: false } }
})
ipcMain.handle('review:openLink', async (event, value) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || typeof value !== 'string' || value.length > 2048) return { ok: false }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || /(^localhost$|\.localhost$|\.local$|^\d+\.\d+\.\d+\.\d+$|^\[.*\]$)/i.test(url.hostname)) return { ok: false }
    await shell.openExternal(url.toString())
    return { ok: true }
  } catch { return { ok: false } }
})

// Backloggd exposes public profile pages but does not provide a stable public
// API.  The importer uses a hidden, sandboxed browser window so the same
// server-rendered cards a user sees are parsed without asking for a password,
// cookie or private profile access.
function normalizeBackloggdUrl(input) {
  const value = String(input || '').trim()
  if (!value) throw new Error('Встав посилання на публічний профіль Backloggd.')
  let parsed
  try { parsed = new URL(value.includes('://') ? value : `https://${value}`) } catch { throw new Error('Посилання Backloggd має неправильний формат.') }
  if (parsed.protocol !== 'https:' || !['backloggd.com', 'www.backloggd.com'].includes(parsed.hostname.toLowerCase())) throw new Error('Потрібне посилання https://backloggd.com/u/…')
  const match = parsed.pathname.match(/^\/u\/([^/]+)/i)
  if (!match) throw new Error('Потрібне посилання на публічний профіль: backloggd.com/u/username')
  const username = decodeURIComponent(match[1])
  if (!/^[a-z0-9_-]{1,40}$/i.test(username)) throw new Error('Ім’я профілю Backloggd має неправильний формат.')
  return { username, url: `https://backloggd.com/u/${encodeURIComponent(username)}/games` }
}

async function scrapeBackloggdProfile(input) {
  const profile = normalizeBackloggdUrl(input)
  if (backloggdImportWindow && !backloggdImportWindow.isDestroyed()) backloggdImportWindow.destroy()
  backloggdImportWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:prg-backloggd-import' }
  })
  const windowRef = backloggdImportWindow
  const rows = []
  const seen = new Set()
  const extractionScript = `(() => {
    const cards = [...document.querySelectorAll('.rating-hover, [data-game-id], .game-cover')].map(node => node.closest('.rating-hover') || node.closest('[data-game-id]') || node).filter(Boolean);
    const unique = [...new Set(cards)];
    return unique.map(entry => {
      const cover = entry.querySelector?.('.game-cover') || (entry.matches?.('.game-cover') ? entry : null);
      const image = entry.querySelector?.('img');
      const link = entry.matches?.('a[href]') ? entry : entry.querySelector?.('a[href]');
      const titleNode = entry.querySelector?.('.game-text-centered, .game-title, [data-game-title]');
      const title = (titleNode?.textContent || image?.alt || cover?.getAttribute?.('alt') || entry.getAttribute?.('data-game-title') || '').replace(/\\s+/g, ' ').trim();
      const href = link?.getAttribute?.('href') || '';
      const id = cover?.getAttribute?.('game_id') || entry.getAttribute?.('data-game-id') || (href.match(/\\/game\\/(\\d+)/i) || [])[1] || '';
      const style = cover?.getAttribute?.('style') || image?.getAttribute?.('style') || '';
      const styleUrl = (style.match(/url\\([\\"']?([^\\"')]+)[\\"']?\\)/i) || [])[1] || '';
      const coverUrl = image?.getAttribute?.('data-src') || image?.getAttribute?.('data-original') || image?.getAttribute?.('src') || styleUrl || '';
      const stars = entry.querySelector?.('.stars-top');
      const width = (stars?.getAttribute?.('style') || '').match(/width\\s*:\\s*([0-9.]+)%/i);
      let rating = width ? Number(width[1]) / 20 : null;
      if (!Number.isFinite(rating)) { const raw = entry.querySelector?.('[data-rating]')?.getAttribute?.('data-rating') || entry.getAttribute?.('data-rating'); rating = raw ? Number(raw) / 2 : null; }
      if (!Number.isFinite(rating) || rating <= 0) rating = null;
      const statusNode = entry.querySelector?.('[data-status-title]') || entry.closest?.('[data-status-title]');
      const status = statusNode?.getAttribute?.('data-status-title') || entry.getAttribute?.('data-status-title') || entry.querySelector?.('[play_type]')?.getAttribute?.('play_type') || '';
      const platform = (entry.querySelector?.('.game-platform, [data-platform]')?.textContent || entry.getAttribute?.('data-platform') || '').replace(/\\s+/g, ' ').trim();
      return { id: String(id || ''), title, cover: coverUrl, rating, status, platform, href };
    }).filter(game => game.title && (game.id || game.href));
  })()`
  try {
    for (let page = 1; page <= 100; page += 1) {
      if (windowRef.isDestroyed()) throw new Error('Імпорт Backloggd скасовано.')
      const pageUrl = `${profile.url}?page=${page}`
      await windowRef.loadURL(pageUrl)
      // Let the profile page finish hydrating its card metadata before the
      // DOM snapshot is taken (Backloggd progressively decorates cards).
      await new Promise(resolve => setTimeout(resolve, 450))
      const extracted = await windowRef.webContents.executeJavaScript(extractionScript, true)
      if (!Array.isArray(extracted) || !extracted.length) break
      const fresh = extracted.filter(game => {
        const key = game.id || game.href || game.title.toLocaleLowerCase()
        if (seen.has(key)) return false
        seen.add(key); return true
      })
      rows.push(...fresh)
      if (!fresh.length) break
      if (extracted.length < 20) break
    }
    if (!rows.length) throw new Error('У профілі Backloggd не знайдено публічних ігор. Перевір URL і видимість бібліотеки.')
    return { ok: true, username: profile.username, games: rows }
  } catch (error) {
    const message = error?.message || ''
    if (/ERR_ABORTED|ERR_BLOCKED_BY_RESPONSE|403|Access denied/i.test(message)) throw new Error('Backloggd не дозволив завантаження профілю. Перевір, що профіль публічний, або відкрий його в браузері й спробуй ще раз.')
    throw error
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy()
    if (backloggdImportWindow === windowRef) backloggdImportWindow = null
  }
}

handleFromMain('backloggd:importProfile', async (_, url) => {
  try { return await scrapeBackloggdProfile(url) }
  catch (error) { return { ok: false, error: error?.message || 'Не вдалося прочитати Backloggd.' } }
})

const NINTENDO_CLIENT_ID = '5c38e31cd085304b'
const NINTENDO_USER_AGENT = 'com.nintendo.znej/1.13.0 (Android/7.1.2)'
const NINTENDO_REDIRECT_URI = 'npf5c38e31cd085304b://auth'
const NINTENDO_SCOPE = 'openid user user.mii user.email user.links[].id'
let nintendoProfile = null
const NINTENDO_TOKEN_FILE = () => {
  if (!nintendoProfile) throw new Error('Select a PRG profile first')
  return path.join(app.getPath('userData'), `nintendo-${nintendoProfile}.enc`)
}
handleFromMain('nintendo:setProfile', (_, uid) => {
  if (uid !== null && (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) throw new Error('Invalid profile')
  const next = uid === null ? null : crypto.createHash('sha256').update(uid).digest('hex')
  if (next !== nintendoProfile) {
    nintendoAuthState = null; nintendoPlayHistory = null
    if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
    nintendoProfile = next
  }
  return { connected: Boolean(loadNintendoSession()) }
})

function nintendoPkceChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url') }
function nintendoRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: options.method || 'GET', headers: { Accept: 'application/json', ...(options.headers || {}) } }, response => {
      let text = ''
      response.setEncoding('utf8'); response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        let data = null
        try { data = JSON.parse(text) } catch {}
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(data)
        reject(createNintendoHttpError(options.stage, response.statusCode, data))
      })
    })
    request.setTimeout(15000, () => request.destroy(new Error('Nintendo request timeout')))
    request.on('error', reject)
    if (body) request.write(typeof body === 'string' ? body : JSON.stringify(body))
    request.end()
  })
}
function saveNintendoSession(sessionToken) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
  fs.writeFileSync(NINTENDO_TOKEN_FILE(), safeStorage.encryptString(sessionToken).toString('base64'), { mode: 0o600 })
}
function loadNintendoSession() {
  try { if (!safeStorage.isEncryptionAvailable()) return null; const raw = fs.readFileSync(NINTENDO_TOKEN_FILE(), 'utf8'); return safeStorage.decryptString(Buffer.from(raw, 'base64')) } catch { return null }
}
async function nintendoExchangeSessionCode(code, verifier) {
  const profile = nintendoProfile
  const body = new URLSearchParams({ client_id: NINTENDO_CLIENT_ID, session_token_code: code, session_token_code_verifier: verifier }).toString()
  const session = await nintendoRequest('https://accounts.nintendo.com/connect/1.0.0/api/session_token', { method: 'POST', stage: 'session-token', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': NINTENDO_USER_AGENT, 'X-Platform': 'Android', 'X-ProductVersion': '2.5.0' } }, body)
  const sessionToken = session?.session_token || session?.sessionToken
  if (!sessionToken) throw new Error('Nintendo did not return a session token')
  if (!profile || profile !== nintendoProfile) throw new Error('PRG account changed')
  saveNintendoSession(sessionToken)
  return sessionToken
}
async function nintendoGetAccessToken(sessionToken) {
  return nintendoRequest('https://accounts.nintendo.com/connect/1.0.0/api/token', { method: 'POST', stage: 'access-token', headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': NINTENDO_USER_AGENT } }, { client_id: NINTENDO_CLIENT_ID, session_token: sessionToken, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token' })
}
async function nintendoFetchPlayHistory() {
  const profile = nintendoProfile
  const sessionToken = loadNintendoSession(); if (!sessionToken) throw new Error('Nintendo account is not connected')
  const token = await nintendoGetAccessToken(sessionToken)
  if (!profile || profile !== nintendoProfile) throw new Error('PRG account changed')
  const accessToken = token?.access_token || token?.accessToken
  if (!accessToken) throw new Error('Nintendo access token unavailable')
  return nintendoRequest('https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories', { stage: 'play-history', headers: { Authorization: `${token.token_type || 'Bearer'} ${accessToken}`, 'User-Agent': NINTENDO_USER_AGENT, 'gentry-locale': 'en-US' } })
}
async function completeNintendoCallback(url) {
  if (!nintendoAuthState || !String(url || '').includes('auth')) throw new Error('Nintendo callback is missing')
  const parsed = new URL(String(url).trim())
  const hash = parsed.hash.replace(/^#/, '')
  const hashParams = new URLSearchParams(hash)
  const returnedState = parsed.searchParams.get('state') || hashParams.get('state')
  const code = parsed.searchParams.get('session_token_code') || parsed.searchParams.get('de') || hashParams.get('session_token_code') || hashParams.get('de')
  if (!code || returnedState !== nintendoAuthState.state) throw new Error('Invalid Nintendo callback')
  await nintendoExchangeSessionCode(code, nintendoAuthState.verifier)
  nintendoPlayHistory = null
  mainWindow?.webContents.send('nintendo:authComplete', { connected: true })
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
  return { connected: true }
}

handleFromMain('nintendo:openAuth', async () => {
  if (!nintendoProfile) throw new Error('Select a PRG profile first')
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) {
    nintendoAuthWindow.focus()
    return { action: 'already_open' }
  }
  const verifier = crypto.randomBytes(32).toString('base64url')
  const state = crypto.randomBytes(16).toString('hex')
  nintendoAuthState = { verifier, state }
  const authUrl = `https://accounts.nintendo.com/connect/1.0.0/authorize?${new URLSearchParams({ client_id: NINTENDO_CLIENT_ID, redirect_uri: NINTENDO_REDIRECT_URI, response_type: 'session_token_code', scope: NINTENDO_SCOPE, state, session_token_code_challenge: nintendoPkceChallenge(verifier), session_token_code_challenge_method: 'S256', theme: 'login_form' }).toString()}`
  nintendoAuthWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 420,
    minHeight: 620,
    title: 'Connect Nintendo Account — PRGLauncher',
    autoHideMenuBar: true,
    backgroundColor: '#10131c',
    webPreferences: {
      partition: `nintendo-auth-${nintendoProfile}-${crypto.randomBytes(8).toString('hex')}`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    }
  })
  const handleCallback = async (_event, url) => {
    if (!url.startsWith(NINTENDO_REDIRECT_URI) || !nintendoAuthState) return
    _event.preventDefault()
    try { await completeNintendoCallback(url) } catch (error) { mainWindow?.webContents.send('nintendo:authComplete', { connected: false, error: error.message }) }
  }
  nintendoAuthWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(NINTENDO_REDIRECT_URI)) { handleCallback({ preventDefault() {} }, url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  nintendoAuthWindow.webContents.on('will-redirect', handleCallback)
  nintendoAuthWindow.webContents.on('will-navigate', handleCallback)
  nintendoAuthWindow.webContents.on('will-frame-navigate', handleCallback)
  nintendoAuthWindow.on('closed', () => { nintendoAuthWindow = null })
  await nintendoAuthWindow.loadURL(authUrl)
  return { action: 'opened' }
})

handleFromMain('nintendo:closeAuth', () => {
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
  nintendoAuthWindow = null
  return { action: 'closed' }
})

handleFromMain('nintendo:authStatus', async () => {
  return { connected: Boolean(loadNintendoSession()) }
})
handleFromMain('nintendo:disconnect', () => {
  try { fs.unlinkSync(NINTENDO_TOKEN_FILE()) } catch {}
  nintendoAuthState = null; nintendoPlayHistory = null
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
  return { connected: false }
})
handleFromMain('nintendo:completeAuth', async (_, callbackUrl) => {
  try { return await completeNintendoCallback(callbackUrl) } catch (error) { return { connected: false, error: error.message } }
})

handleFromMain('nintendo:fetchHistory', async () => {
  const profile = nintendoProfile
  try { const history = await nintendoFetchPlayHistory(); if (!profile || profile !== nintendoProfile) return { ok: false, error: 'PRG account changed' }; nintendoPlayHistory = history; return { ok: true, data: history } }
  catch (error) { if (profile !== nintendoProfile) return { ok: false, error: 'PRG account changed' }; return { ok: false, error: error.message, authRequired: requiresNintendoReauth(error) } }
})

handleFromMain('app:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

handleFromMain('app:hide', () => {
  if (mainWindow) mainWindow.hide()
})

handleFromMain('app:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})

handleFromMain('app:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

handleFromMain('app:exportBackup', async (_, payload) => {
  if (!payload || !Array.isArray(payload.games)) return { ok: false, error: 'Invalid backup data' }
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export PRGLauncher backup', defaultPath: path.join(app.getPath('documents'), `PRGLauncher-backup-${new Date().toISOString().slice(0,10)}.json`), filters: [{ name: 'JSON backup', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try { fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8'); return { ok: true, filePath: result.filePath } } catch (error) { return { ok: false, error: error.message } }
})

handleFromMain('app:exportDiagnostics', async (_, payload) => {
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export PRGLauncher diagnostics', defaultPath: path.join(app.getPath('documents'), `PRGLauncher-diagnostics-${new Date().toISOString().slice(0,10)}.json`), filters: [{ name: 'JSON diagnostics', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    const safe = payload && typeof payload === 'object' ? payload : {}
    fs.writeFileSync(result.filePath, JSON.stringify({ ...safe, exportedAt: Date.now(), appVersion: app.getVersion(), platform: process.platform, arch: process.arch }, null, 2), 'utf8')
    return { ok: true, filePath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

handleFromMain('app:importBackup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Import PRGLauncher backup', properties: ['openFile'], filters: [{ name: 'JSON backup', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
  try {
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
    if (!data || !Array.isArray(data.games) || data.games.some(game => !game || typeof game !== 'object' || !String(game.id || '').trim() || !String(game.title || '').trim())) throw new Error('Це не backup PRGLauncher або файл пошкоджено')
    if (data.games.length > 100000) throw new Error('Backup перевищує безпечний ліміт ігор')
    return { ok: true, data }
  } catch (error) { return { ok: false, error: error.message } }
})

handleFromMain('app:checkForUpdates', async () => {
  if (!app.isPackaged) return { status: 'dev', message: 'Оновлення доступні лише у packaged-версії' }
  try { updateState = { status: 'checking', version: null, error: null }; const result = await autoUpdater.checkForUpdates(); return { status: result?.updateInfo?.version && result.updateInfo.version !== app.getVersion() ? 'available' : 'latest', version: result?.updateInfo?.version || null } }
  catch (error) { updateState = { status: 'error', version: null, error: error.message }; return { status: 'error', error: error.message } }
})
handleFromMain('app:downloadUpdate', async () => { try { await autoUpdater.downloadUpdate(); return { ok: true } } catch (error) { return { ok: false, error: error.message } } })
function prepareForUpdateInstall() {
  if (updateInstallInProgress) return
  updateInstallInProgress = true
  isQuitting = true
  updateState = { ...updateState, status: 'installing', error: null }
  mainWindow?.webContents.send('app:updateStatus', updateState)
  if (steamMonitorTimer) { clearInterval(steamMonitorTimer); steamMonitorTimer = null }
  stopSteamActivity()
  if (steamCollectionTimer) { clearInterval(steamCollectionTimer); steamCollectionTimer = null }
  if (miniBar && !miniBar.isDestroyed()) miniBar.hide()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  // Remove the tray entry immediately so the updater can replace the app
  // without leaving a stale PRGLauncher process/menu item behind.
  if (tray) {
    try { tray.destroy() } catch {}
    tray = null
  }
}

handleFromMain('app:installUpdate', () => {
  const ready = updateState.status === 'downloaded'
  if (ready) {
    prepareForUpdateInstall()
    // Give the renderer a short final turn to flush synchronous localStorage
    // writes, then destroy every window before electron-updater starts the
    // installer. This avoids the Windows "please close PRGLauncher" prompt.
    updateInstallTimer = setTimeout(() => {
      updateInstallTimer = null
      for (const window of [mainWindow, miniBar, nintendoAuthWindow]) {
        if (!window || window.isDestroyed()) continue
        try { window.destroy() } catch {}
      }
      mainWindow = null
      miniBar = null
      nintendoAuthWindow = null
      autoUpdater.quitAndInstall(false, true)
    }, 250)
  }
  return { ok: ready }
})

function checkForUpdatesAfterLaunch() {
  if (!app.isPackaged) return
  setTimeout(async () => {
    automaticUpdateCheck = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      console.warn('[Update] Automatic check failed:', error.message)
    } finally {
      automaticUpdateCheck = false
    }
  }, 3000)
}

handleFromMain('app:setSize', (_, w, h) => {
  if (mainWindow) mainWindow.setSize(w, h, true)
})

// ── MINI-TAB ──────────────────────────────────────────────────────────────
// A small always-on-top window that is always present: the running session's
// timer and the installed Steam games, newest played first. It opens on the
// second monitor by default and remembers where the user puts it.
let lastMiniState = null
let miniBoundsSaveTimer = null
const MINI_TAB_BOUNDS_FILE = () => path.join(app.getPath('userData'), 'mini-tab.json')

function sendMiniState(state) {
  if (state) lastMiniState = steamLibraryArt.decorate(state)
  if (miniBar && !miniBar.isDestroyed() && !miniBar.webContents.isLoading() && lastMiniState) {
    miniBar.webContents.send('mini:state', lastMiniState)
  }
}

function currentMiniTabBounds() {
  return resolveMiniTabBounds({
    saved: loadSavedBounds(fs, MINI_TAB_BOUNDS_FILE()),
    displays: screen.getAllDisplays(),
    primaryId: screen.getPrimaryDisplay().id,
  })
}

function rememberMiniTabBounds() {
  clearTimeout(miniBoundsSaveTimer)
  miniBoundsSaveTimer = setTimeout(() => {
    if (miniBar && !miniBar.isDestroyed()) saveBounds(fs, MINI_TAB_BOUNDS_FILE(), miniBar.getBounds())
  }, 400)
}

// After a monitor is unplugged or rearranged, bring the mini-tab back on screen
// at its fixed size.
function keepMiniTabOnScreen() {
  if (!miniBar || miniBar.isDestroyed()) return
  const bounds = currentMiniTabBounds()
  if (!isReachable(miniBar.getBounds(), screen.getAllDisplays())) miniBar.setBounds(bounds)
  else miniBar.setSize(bounds.width, bounds.height)
}

function createMiniBar() {
  if (miniBar && !miniBar.isDestroyed()) return miniBar

  miniBar = new BrowserWindow({
    ...currentMiniTabBounds(),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    movable: true,
    fullscreenable: false,
    maximizable: false,
    title: 'PRGLauncher',
    backgroundColor: '#0d0d1a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  miniBar.setAlwaysOnTop(true, 'floating')
  const miniBarFile = path.join(__dirname, '..', 'renderer', 'mini-bar.html')
  attachNavigationGuard(miniBar.webContents, miniBarFile)
  miniBar.webContents.on('did-finish-load', () => sendMiniState())
  miniBar.once('ready-to-show', () => miniBar?.showInactive())
  miniBar.on('moved', rememberMiniTabBounds)
  // The mini-tab is not closed by the user; only quitting the app removes it.
  miniBar.on('close', event => { if (!isQuitting) event.preventDefault() })
  miniBar.on('closed', () => { clearTimeout(miniBoundsSaveTimer); miniBar = null })
  miniBar.loadFile(miniBarFile)
  return miniBar
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// The big window's "compact" button: hide it and leave the mini-tab.
handleFromMain('mini:show', (_, state) => {
  sendMiniState(state)
  const bar = createMiniBar()
  if (!bar.isVisible() && !bar.webContents.isLoading()) bar.showInactive()
  mainWindow?.hide()
})

handleFromMain('mini:update', (_, state) => {
  sendMiniState(state)
})

handleFromMain('mini:restore', () => {
  showMainWindow()
})

// The mini-tab asks the launcher window to start a game; the renderer owns
// the library and the timer, so it decides whether the id can be launched.
handleFromMain('mini:launch', (_, gameId) => {
  const id = String(gameId || '')
  if (!/^[\w.:-]{1,128}$/.test(id) || !mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send('mini:launch', id)
  return true
})

ipcMain.on('mini:pause', (event) => {
  if (!isMiniBarSender(event)) return
  mainWindow?.webContents.send('mini:pause')
})

handleFromMain('app:quit', () => {
  miniBar?.destroy()
  mainWindow?.destroy()
  app.quit()
})

// ── WINDOW ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // macOS keeps its familiar traffic-light controls. Windows continues to
    // use the custom frameless header already present in the launcher.
    frame: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#08080f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'darwin' ? 'icon.icns' : 'icon.ico'),
  })

  const mainWindowFile = path.join(__dirname, '..', 'renderer', 'index.html')
  attachNavigationGuard(mainWindow.webContents, mainWindowFile, { allowAuthPopup: true })
  mainWindow.loadFile(mainWindowFile)

  mainWindow.once('ready-to-show', () => {
    if (!launchedAtLogin) mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow.hide()      // minimize to tray instead of closing
  })
}

// ── TRAY ──────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png')
  let icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (process.platform === 'darwin') {
    // Do not reuse the colorful Dock artwork in the menu bar. macOS template
    // images must be a small monochrome silhouette; otherwise the system can
    // render a cropped, oversized fragment of the source bitmap.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><g fill="#fff"><circle cx="9" cy="5" r="3.6"/><circle cx="13" cy="9" r="3.6"/><circle cx="9" cy="13" r="3.6"/><circle cx="5" cy="9" r="3.6"/><circle cx="9" cy="9" r="2.2"/><path d="M8.3 11.7h1.4v5.1c0 .6-.7.9-1.1.5l-.9-.8c-.4-.3-.2-.9.3-1.1l.3-.1z"/></g></svg>'
    icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon)
  tray.setToolTip('PRGLauncher')

  const menu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────
// No window uses <webview>; refuse one rather than let it load remote content.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.whenReady().then(async () => {
  steamPath = await findSteamPath()
  console.log('[Steam] Path:', steamPath || 'not found')

  // Start Steam silently in background
  startSteamSilent()
  // Steam started by Windows at sign-in, or just now, may show its library.
  if (process.platform === 'win32') hideSteamWindow(STEAM_GUARD_MS.startup)
  startSteamMonitor()
  startSteamCollectionMonitor()

  // Packaged Windows/macOS builds start in the background. Dev runs never
  // modify the user's login settings.
  if (['win32', 'darwin'].includes(process.platform) && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: process.platform === 'darwin',
      path: process.execPath,
      args: ['--hidden'],
    })
  }

  autoUpdater.autoDownload = false
  autoUpdater.on('checking-for-update', () => { updateState = { status: 'checking', version: null, error: null }; mainWindow?.webContents.send('app:updateStatus', updateState) })
  autoUpdater.on('update-available', info => { updateState = { status: 'available', version: info.version, error: null }; mainWindow?.webContents.send('app:updateStatus', updateState) })
  autoUpdater.on('update-not-available', info => { updateState = { status: 'latest', version: info.version, error: null }; mainWindow?.webContents.send('app:updateStatus', updateState) })
  autoUpdater.on('download-progress', progress => { updateState = { status: 'downloading', version: updateState.version, percent: Math.round(progress.percent), error: null }; mainWindow?.webContents.send('app:updateStatus', updateState) })
  autoUpdater.on('update-downloaded', info => { updateState = { status: 'downloaded', version: info.version, error: null }; mainWindow?.webContents.send('app:updateStatus', updateState) })
  autoUpdater.on('error', error => {
    updateState = { status: 'error', version: null, error: error.message }
    if (automaticUpdateCheck) console.warn('[Update] Automatic check error:', error.message)
    else mainWindow?.webContents.send('app:updateStatus', updateState)
  })

  createWindow()
  createTray()
  createMiniBar()
  for (const event of ['display-removed', 'display-metrics-changed']) screen.on(event, keepMiniTabOnScreen)
  checkForUpdatesAfterLaunch()
})

app.on('before-quit', () => {
  isQuitting = true
  if (steamMonitorTimer) { clearInterval(steamMonitorTimer); steamMonitorTimer = null }
  stopSteamActivity()
  if (steamCollectionTimer) { clearInterval(steamCollectionTimer); steamCollectionTimer = null }
})

app.on('window-all-closed', (e) => {
  e.preventDefault() // keep running in tray
})

app.on('activate', () => {
  mainWindow?.show()
})

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
