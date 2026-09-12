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
  mainWindow?.focus()
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
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
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
