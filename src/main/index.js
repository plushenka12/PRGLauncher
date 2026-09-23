const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen, safeStorage, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const os = require('os')
const fs = require('fs')
const https = require('https')
const { execSync, execFile, spawn } = require('child_process')
const crypto = require('crypto')

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
let miniBarStandby = false
let tray       = null
let steamPath  = null
let steamMonitorTimer = null
let steamTrackedApps = new Set()
let steamMonitorStates = new Map()
let steamRunningAppId = null
let steamCollectionTimer = null
let lastBacklogSignature = null
const steamStoreCache = new Map()
const gogGameCache = new Map()
let hltbSearchInFlight = null
let hltbLastRequestAt = 0
let hltbCredentials = null
let hltbCredentialsExpiry = 0
let backloggdImportWindow = null
const launchedAtLogin = process.argv.includes('--hidden')
const opacityAnimations = new Map()

function animateWindowOpacity(window, from, to, duration, done) {
  if (!window || window.isDestroyed()) return
  const animationKey = window.id
  const previous = opacityAnimations.get(animationKey)
  if (previous) clearInterval(previous)
  const startedAt = Date.now()
  const tick = () => {
    if (window.isDestroyed()) return clearInterval(opacityAnimations.get(animationKey))
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    window.setOpacity(from + (to - from) * eased)
    if (progress < 1) return
    clearInterval(opacityAnimations.get(animationKey))
    opacityAnimations.delete(animationKey)
    done?.()
  }
  const timer = setInterval(tick, 16)
  opacityAnimations.set(animationKey, timer)
  tick()
}

// ── STEAM DETECTION ───────────────────────────────────────────────────────
function findSteamPath() {
  // On Windows Steam keeps its root in the registry. macOS stores the same
  // steamapps/userdata tree under the user's Application Support directory.
  if (process.platform === 'win32') {
    try {
      const reg = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' })
      const match = reg.match(/SteamPath\s+REG_SZ\s+(.+)/)
      if (match) return match[1].trim().replace(/\//g, '\\')
    } catch {}
  }

  // Fallback to known paths
  for (const p of STEAM_PATHS) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function isGameInstalled(appId) {
  if (!steamPath) return false
  const appsDir = path.join(steamPath, 'steamapps')
  if (!fs.existsSync(appsDir)) return false

  // Check main steamapps folder
  const manifest = path.join(appsDir, `appmanifest_${appId}.acf`)
  if (isInstalledManifest(manifest)) return true

  // Check library folders (libraryfolders.vdf)
  try {
    const vdf = fs.readFileSync(path.join(appsDir, 'libraryfolders.vdf'), 'utf8')
    const pathMatches = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)]
    for (const m of pathMatches) {
      const libManifest = path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', `appmanifest_${appId}.acf`)
      if (isInstalledManifest(libManifest)) return true
    }
  } catch {}

  return false
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

// ── GOG GALAXY (local, password-free MVP) ───────────────────────────────
// GOG Galaxy keeps installed-game registration in the Windows registry. We
// only read local install metadata; no GOG login, cookie or password is used.
function readGogRegistryGames(root) {
  if (process.platform !== 'win32') return []
  let output = ''
  try { output = execSync(`reg query "${root}" /s`, { encoding: 'utf8', windowsHide: true }) } catch { return [] }
  const result = []
  let key = null
  let values = {}
  const flush = () => {
    if (!key || !values.path) return
    const installPath = String(values.path).trim().replace(/^"|"$/g, '')
    if (!installPath || !fs.existsSync(installPath)) return
    const id = String(values.gameid || values.gameID || key.split('\\').pop() || installPath)
    const title = String(values.gamename || values.name || `GOG game ${id}`).trim()
    const rawExe = String(values.exe || values.executable || '').trim().replace(/^"|"$/g, '')
    const executable = rawExe ? (path.isAbsolute(rawExe) ? rawExe : path.join(installPath, rawExe)) : null
    result.push({ id, title, installPath, executable: executable && fs.existsSync(executable) ? executable : null, platform: 'PC', source: 'gog' })
  }
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^HKEY_LOCAL_MACHINE\\|^HKEY_CURRENT_USER\\/i.test(trimmed)) {
      flush(); key = trimmed; values = {}; continue
    }
    const match = line.match(/^\s+([^\s]+)\s+REG_\w+\s+(.*)$/i)
    if (match) values[match[1].toLocaleLowerCase()] = match[2].trim()
  }
  flush()
  return result
}

function getGogInstalledGames() {
  if (process.platform !== 'win32') return []
  const roots = [
    'HKCU\\Software\\GOG.com\\Games',
    'HKLM\\Software\\GOG.com\\Games',
    'HKLM\\Software\\WOW6432Node\\GOG.com\\Games',
  ]
  const seen = new Set()
  const games = roots.flatMap(readGogRegistryGames).filter(game => {
    const key = `${game.id}:${game.installPath}`.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  games.forEach(game => gogGameCache.set(game.id, game))
  return games
}

function readVdfNumber(contents, key) {
  const match = contents.match(new RegExp(`"${key}"\\s+"(\\d+)"`))
  return match ? Number(match[1]) : null
}

function getInstallProgress(appId) {
  if (isGameInstalled(appId)) return { state: 'ready', progress: 100, downloaded: null, total: null }
  for (const library of getSteamLibraries()) {
    const steamApps = path.join(library, 'steamapps')
    const manifest = path.join(steamApps, `appmanifest_${appId}.acf`)
    const downloadDir = path.join(steamApps, 'downloading', String(appId))
    let downloaded = null
    let total = null
    try {
      const manifestData = fs.readFileSync(manifest, 'utf8')
      downloaded = readVdfNumber(manifestData, 'BytesDownloaded')
      total = readVdfNumber(manifestData, 'BytesToDownload')
    } catch {}
    // Steam removes this directory when a queued download is cancelled. Do not
    // infer "downloading" from stale byte counters left in an app manifest.
    if (fs.existsSync(downloadDir)) {
      const progress = total && downloaded !== null ? Math.min(99, Math.floor(downloaded / total * 100)) : null
      return { state: 'downloading', progress, downloaded, total }
    }
  }
  return { state: steamPath ? 'waiting' : 'steam_not_found', progress: null, downloaded: null, total: null }
}

function isGameInLibrary(appId) {
  // Windows exposes installed/owned app records in the registry. macOS does
  // not; imported profile games are treated as library entries and Steam still
  // makes the final ownership decision when the steam:// link is opened.
  if (process.platform === 'darwin') return Boolean(steamPath)
  if (process.platform !== 'win32') return false
  try {
    execSync(`reg query "HKCU\\Software\\Valve\\Steam\\Apps\\${appId}"`, { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

function isSteamRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('tasklist /fi "imagename eq steam.exe" /fo csv /nh', { encoding: 'utf8' })
      return result.toLowerCase().includes('steam.exe')
    }
    if (process.platform === 'darwin') {
      execSync('pgrep -x steam_osx', { stdio: 'ignore' })
      return true
    }
    return false
  } catch { return false }
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

function startSteamSilent() {
  const steamExe = getSteamExecutable()
  if (!steamExe) return
  // Only launch if not already running
  if (isSteamRunning()) {
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

function hideSteamWindow() {
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
  // Steam has no Electron API. Hide only its top-level window; the client and
  // downloads keep running in its tray process.
  const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SteamWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }
'@; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'steam*' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [SteamWindow]::ShowWindowAsync($_.MainWindowHandle, 0) | Out-Null }`
  const hide = () => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true }, () => {})
  // Steam may create its window after accepting the install URL, so hide it
  // several times during that short handoff and leave its background client on.
  ;[0, 500, 1500, 3000].forEach(delay => setTimeout(hide, delay))
}

function publishSteamStatus(appId, status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steam:status', { appId, ...status })
}

function pollSteamStatus() {
  for (const appId of steamTrackedApps) {
    const status = getInstallProgress(appId)
    const signature = JSON.stringify(status)
    if (steamMonitorStates.get(appId) !== signature) {
      steamMonitorStates.set(appId, signature)
      publishSteamStatus(appId, status)
    }
  }
  pollSteamActivity()
}

function getRunningSteamAppId() {
  // Windows reports the active app through the Steam registry. There is no
  // equivalent stable, permission-free API on macOS, so manual sessions and
  // Steam profile import still work while automatic local game detection is
  // intentionally disabled there.
  if (process.platform !== 'win32') return null
  try {
    const result = execSync('reg query "HKCU\\Software\\Valve\\Steam\\Apps" /s /v Running', { encoding: 'utf8' })
    let currentAppId = null
    for (const line of result.split(/\r?\n/)) {
      const keyMatch = line.match(/\\Apps\\(\d+)\s*$/i)
      if (keyMatch) { currentAppId = keyMatch[1]; continue }
      if (currentAppId && /\bRunning\b\s+REG_DWORD\s+0x1\b/i.test(line)) return currentAppId
    }
  } catch {}
  return null
}

function pollSteamActivity() {
  const runningAppId = getRunningSteamAppId()
  if (runningAppId === steamRunningAppId) return
  steamRunningAppId = runningAppId
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steam:runningApp', { appId: runningAppId })
}

function startSteamMonitor() {
  if (steamMonitorTimer) return
  steamMonitorTimer = setInterval(pollSteamStatus, 1500)
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
  return {
    searchType: 'games',
    searchTerms: query.toLowerCase().split(/\s+/),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: null, max: null }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' }, filter: '', sort: 0, randomizer: 0
    },
    useCache: true,
    [credentials.hpKey]: credentials.hpValue
  }
}

function captureHltbCredentials() {
  if (hltbCredentials && Date.now() < hltbCredentialsExpiry) return Promise.resolve(hltbCredentials)
  return new Promise(resolve => {
    let lookupWindow = null
    let lookupSession = null
    let settled = false
    const finish = credentials => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { lookupSession?.webRequest.onBeforeSendHeaders(null) } catch {}
      if (lookupWindow && !lookupWindow.isDestroyed()) lookupWindow.destroy()
      if (credentials) {
        hltbCredentials = credentials
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
      lookupSession.webRequest.onBeforeSendHeaders({ urls: [`${HLTB_ORIGIN}/api/search/site*`] }, (details, callback) => {
        callback({ cancel: false, requestHeaders: details.requestHeaders })
        if (details.method !== 'POST') return
        const authToken = hltbHeader(details.requestHeaders, 'x-auth-token')
        const hpKey = hltbHeader(details.requestHeaders, 'x-hp-key')
        const hpValue = hltbHeader(details.requestHeaders, 'x-hp-val')
        if (!authToken || !hpKey || !hpValue) return
        finish({ authToken, hpKey, hpValue, userAgent: hltbHeader(details.requestHeaders, 'user-agent') || '' })
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
    const request = https.request(`${HLTB_ORIGIN}/api/search/site`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Origin: HLTB_ORIGIN,
        Referer: `${HLTB_ORIGIN}/`,
        'User-Agent': credentials.userAgent,
        'x-auth-token': credentials.authToken,
        'x-hp-key': credentials.hpKey,
        'x-hp-val': credentials.hpValue
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
    request.setTimeout(15000, () => request.destroy())
    request.on('error', () => resolve({ status: 0, payload: null }))
    request.end(body)
  })
}

async function searchHltb(query) {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ')
  if (!normalizedQuery || normalizedQuery.length > 160) return { ok: false, error: 'INVALID_QUERY', results: [] }
  if (hltbSearchInFlight) return { ok: false, error: 'BUSY', results: [] }

  hltbSearchInFlight = (async () => {
    const remainingGap = HLTB_MIN_REQUEST_GAP - (Date.now() - hltbLastRequestAt)
    if (remainingGap > 0) await wait(remainingGap)
    hltbLastRequestAt = Date.now()

    for (let attempt = 0; attempt < 2; attempt++) {
      const credentials = await captureHltbCredentials()
      if (!credentials) return { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
      const response = await postHltbSearch(normalizedQuery, credentials)
      const results = normalizeHltbResults(response.payload)
      if (response.status >= 200 && response.status < 300) return results.length ? { ok: true, results } : { ok: false, error: 'NO_RESULTS', results: [] }
      // HLTB uses these status codes when its short-lived credentials rotated.
      if (![401, 403, 404].includes(response.status) || attempt === 1) return { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
      hltbCredentials = null
      hltbCredentialsExpiry = 0
    }
    return { ok: false, error: 'HLTB_UNAVAILABLE', results: [] }
  })()

  try { return await hltbSearchInFlight }
  finally { hltbSearchInFlight = null }
}

// ── IPC HANDLERS ──────────────────────────────────────────────────────────
ipcMain.handle('steam:launchGame', async (_, appId) => {
  const normalizedAppId = String(appId || '')
  if (!/^\d+$/.test(normalizedAppId)) return { action: 'error', message: 'Invalid Steam App ID' }

  const installed = isGameInstalled(normalizedAppId)

  // Ownership is not reliably stored in the Windows registry. Let the logged-in
  // Steam client make that decision: it can launch an owned game or offer its
  // normal install/purchase flow without producing a false "not owned" result.
  await shell.openExternal(`steam://run/${normalizedAppId}`)
  // Steam may briefly surface its main window to hand off a launch. Hide it
  // only for this launcher-initiated path; manually opening Steam from tray is
  // intentionally left alone.
  ;[500, 1800].forEach(delay => setTimeout(hideSteamWindow, delay))
  return { action: 'requested', appId: normalizedAppId, installed }
})

ipcMain.handle('steam:gameStatus', async (_, appId) => {
  if (!appId) return { status: 'unknown' }
  const installed = isGameInstalled(appId)
  const inLibrary = installed || isGameInLibrary(appId)
  return {
    status: installed ? 'installed' : inLibrary ? 'in_library' : 'not_owned',
    steamPath
  }
})

ipcMain.handle('steam:installStatus', async (_, appId) => {
  const normalizedAppId = String(appId || '')
  if (!/^\d+$/.test(normalizedAppId)) return { state: 'error', message: 'Invalid Steam App ID' }
  return getInstallProgress(normalizedAppId)
})

ipcMain.handle('steam:requestInstall', async (_, appId) => {
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

ipcMain.handle('steam:hideWindow', () => hideSteamWindow())

ipcMain.handle('steam:trackApps', (_, appIds) => {
  steamTrackedApps = new Set((Array.isArray(appIds) ? appIds : [])
    .map(appId => String(appId))
    .filter(appId => /^\d+$/.test(appId)))
  steamMonitorStates.clear()
  pollSteamStatus()
  startSteamMonitor()
})

ipcMain.handle('steam:getCollection', (_, name) => getSteamCollection(name))

ipcMain.handle('steam:profileLibrary', async (_, payload) => {
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

ipcMain.handle('steam:importGames', async () => {
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

ipcMain.handle('steam:getStoreGames', async (_, appIds) => {
  const ids = [...new Set((Array.isArray(appIds) ? appIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 100)
  return Promise.all(ids.map(getSteamStoreGame))
})

ipcMain.handle('steam:getRunningAppId', async () => {
  return { appId: getRunningSteamAppId() }
})

ipcMain.handle('gog:installedGames', async () => ({ ok: true, games: getGogInstalledGames() }))
ipcMain.handle('gog:launchGame', async (_, payload) => {
  const id = String(payload?.id || '')
  const cached = gogGameCache.get(id)
  const executable = String(payload?.executable || cached?.executable || '')
  if (executable && path.isAbsolute(executable) && fs.existsSync(executable)) {
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { action: 'requested', id }
  }
  if (/^[\w.-]+$/.test(id)) {
    await shell.openExternal(`goggalaxy://openGameView/${encodeURIComponent(id)}`)
    return { action: 'requested', id }
  }
  return { action: 'error', message: 'GOG executable was not found' }
})

ipcMain.handle('hltb:search', async (_, query) => searchHltb(query))
ipcMain.handle('hltb:openGame', async (_, url) => {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'howlongtobeat.com' || !/^\/game\/\d+\/?$/.test(parsed.pathname)) return { ok: false }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch { return { ok: false } }
})
ipcMain.handle('app:openExternal', async (_, url) => {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'prgtracker.netlify.app') return { ok: false }
    await shell.openExternal(parsed.toString())
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

ipcMain.handle('backloggd:importProfile', async (_, url) => {
  try { return await scrapeBackloggdProfile(url) }
  catch (error) { return { ok: false, error: error?.message || 'Не вдалося прочитати Backloggd.' } }
})

const NINTENDO_CLIENT_ID = '5c38e31cd085304b'
const NINTENDO_REDIRECT_URI = 'npf5c38e31cd085304b://auth'
const NINTENDO_SCOPE = 'openid user user.mii user.email user.links[].id'
let nintendoProfile = null
const NINTENDO_TOKEN_FILE = () => {
  if (!nintendoProfile) throw new Error('Select a PRG profile first')
  return path.join(app.getPath('userData'), `nintendo-${nintendoProfile}.enc`)
}
ipcMain.handle('nintendo:setProfile', (_, uid) => {
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
      response.on('end', () => { let data = null; try { data = JSON.parse(text) } catch {} if (response.statusCode >= 200 && response.statusCode < 300) resolve(data); else reject(new Error(`Nintendo HTTP ${response.statusCode}`)) })
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
  const session = await nintendoRequest('https://accounts.nintendo.com/connect/1.0.0/api/session_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, body)
  const sessionToken = session?.session_token || session?.sessionToken
  if (!sessionToken) throw new Error('Nintendo did not return a session token')
  if (!profile || profile !== nintendoProfile) throw new Error('PRG account changed')
  saveNintendoSession(sessionToken)
  return sessionToken
}
async function nintendoGetAccessToken(sessionToken) {
  return nintendoRequest('https://accounts.nintendo.com/connect/1.0.0/api/token', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { client_id: NINTENDO_CLIENT_ID, session_token: sessionToken, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token' })
}
async function nintendoFetchPlayHistory() {
  const profile = nintendoProfile
  const sessionToken = loadNintendoSession(); if (!sessionToken) throw new Error('Nintendo account is not connected')
  const token = await nintendoGetAccessToken(sessionToken)
  if (!profile || profile !== nintendoProfile) throw new Error('PRG account changed')
  const accessToken = token?.access_token || token?.accessToken
  if (!accessToken) throw new Error('Nintendo access token unavailable')
  return nintendoRequest('https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories', { headers: { Authorization: `${token.token_type || 'Bearer'} ${accessToken}`, 'User-Agent': 'com.nintendo.znej/1.13.0 (Windows; PRGLauncher)', 'gentry-locale': 'en-US' } })
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

ipcMain.handle('nintendo:openAuth', async () => {
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

ipcMain.handle('nintendo:closeAuth', () => {
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
  nintendoAuthWindow = null
  return { action: 'closed' }
})

ipcMain.handle('nintendo:authStatus', async () => {
  return { connected: Boolean(loadNintendoSession()) }
})
ipcMain.handle('nintendo:disconnect', () => {
  try { fs.unlinkSync(NINTENDO_TOKEN_FILE()) } catch {}
  nintendoAuthState = null; nintendoPlayHistory = null
  if (nintendoAuthWindow && !nintendoAuthWindow.isDestroyed()) nintendoAuthWindow.close()
  return { connected: false }
})
ipcMain.handle('nintendo:completeAuth', async (_, callbackUrl) => {
  try { return await completeNintendoCallback(callbackUrl) } catch (error) { return { connected: false, error: error.message } }
})

ipcMain.handle('nintendo:fetchHistory', async () => {
  const profile = nintendoProfile
  try { const history = await nintendoFetchPlayHistory(); if (!profile || profile !== nintendoProfile) return { ok: false, error: 'PRG account changed' }; nintendoPlayHistory = history; return { ok: true, data: history } }
  catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('app:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.handle('app:hide', () => {
  if (mainWindow) mainWindow.hide()
})

ipcMain.handle('app:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})

ipcMain.handle('app:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('app:exportBackup', async (_, payload) => {
  if (!payload || !Array.isArray(payload.games)) return { ok: false, error: 'Invalid backup data' }
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export PRGLauncher backup', defaultPath: `PRGLauncher-backup-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: 'JSON backup', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try { fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8'); return { ok: true, filePath: result.filePath } } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('app:importBackup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Import PRGLauncher backup', properties: ['openFile'], filters: [{ name: 'JSON backup', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
  try {
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
    if (!data || !Array.isArray(data.games)) throw new Error('Це не backup PRGLauncher')
    return { ok: true, data }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) return { status: 'dev', message: 'Оновлення доступні лише у packaged-версії' }
  try { updateState = { status: 'checking', version: null, error: null }; const result = await autoUpdater.checkForUpdates(); return { status: result?.updateInfo?.version && result.updateInfo.version !== app.getVersion() ? 'available' : 'latest', version: result?.updateInfo?.version || null } }
  catch (error) { updateState = { status: 'error', version: null, error: error.message }; return { status: 'error', error: error.message } }
})
ipcMain.handle('app:downloadUpdate', async () => { try { await autoUpdater.downloadUpdate(); return { ok: true } } catch (error) { return { ok: false, error: error.message } } })
ipcMain.handle('app:installUpdate', () => { if (updateState.status === 'downloaded') autoUpdater.quitAndInstall(); return { ok: updateState.status === 'downloaded' } })

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

ipcMain.handle('app:setSize', (_, w, h) => {
  if (mainWindow) mainWindow.setSize(w, h, true)
})

function sendMiniState(state) {
  if (miniBar && !miniBar.isDestroyed()) miniBar.webContents.send('mini:state', state)
}

function createMiniBar() {
  if (miniBar && !miniBar.isDestroyed()) return miniBar

  miniBar = new BrowserWindow({
    width: 360,
    height: 58,
    minWidth: 260,
    minHeight: 58,
    maxHeight: 58,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    movable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  miniBar.setAlwaysOnTop(true, 'floating')
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const margin = 16
  miniBar.setPosition(workArea.x + workArea.width - 360 - margin, workArea.y + margin)
  miniBar.loadFile(path.join(__dirname, '..', 'renderer', 'mini-bar.html'))
  miniBar.on('closed', () => { const timer=opacityAnimations.get(miniBar?.id); if(timer)clearInterval(timer); opacityAnimations.delete(miniBar?.id); miniBar = null })
  return miniBar
}

function transitionToMiniBar(bar, state) {
  sendMiniState(state)
  bar.setOpacity(0)
  bar.showInactive()
  bar.webContents.send('mini:transition', 'in')
  animateWindowOpacity(bar, 0, 1, 180)

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send('app:miniTransition', 'out')
    animateWindowOpacity(mainWindow, mainWindow.getOpacity(), 0, 150, () => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.hide()
        mainWindow.setOpacity(1)
      }
    })
  } else {
    mainWindow?.hide()
  }
}

function transitionToMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(0)
    mainWindow.show()
    mainWindow.webContents.send('app:miniTransition', 'in')
    animateWindowOpacity(mainWindow, 0, 1, 190, () => mainWindow?.focus())
  }
  if (miniBar && !miniBar.isDestroyed() && miniBar.isVisible()) {
    miniBar.webContents.send('mini:transition', 'out')
    animateWindowOpacity(miniBar, miniBar.getOpacity(), 0, 150, () => {
      if (!miniBar?.isDestroyed()) {
        miniBar.hide()
        miniBar.setOpacity(1)
      }
    })
  }
}

ipcMain.handle('mini:show', (_, state) => {
  const bar = createMiniBar()
  miniBarStandby = !state?.active
  const show = () => transitionToMiniBar(bar, state)
  if (bar.webContents.isLoading()) bar.webContents.once('did-finish-load', show)
  else show()
})

ipcMain.handle('mini:update', (_, state) => {
  if (!state?.active && !miniBarStandby && miniBar && !miniBar.isDestroyed() && miniBar.isVisible()) {
    transitionToMainWindow()
    return
  }
  if (state?.active) miniBarStandby = false
  sendMiniState(state)
})

ipcMain.handle('mini:restore', () => {
  transitionToMainWindow()
})

ipcMain.handle('mini:togglePin', () => {
  if (!miniBar || miniBar.isDestroyed()) return false
  const pinned = !miniBar.isAlwaysOnTop()
  miniBar.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal')
  return pinned
})

ipcMain.on('mini:pause', () => {
  mainWindow?.webContents.send('mini:pause')
})

ipcMain.handle('app:quit', () => {
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

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    if (!launchedAtLogin) mainWindow.show()
  })

  mainWindow.on('close', (e) => {
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
app.whenReady().then(() => {
  steamPath = findSteamPath()
  console.log('[Steam] Path:', steamPath || 'not found')

  // Start Steam silently in background
  startSteamSilent()
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
  checkForUpdatesAfterLaunch()
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
