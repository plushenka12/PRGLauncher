const { pathToFileURL } = require('url')

// Windows with the preload bridge must only ever show the launcher's own
// files: a page that navigated elsewhere would inherit window.launcher.
// Must match authDomain in src/renderer/index.html.
const FIREBASE_AUTH_ORIGIN = 'https://gametracker-30c93.firebaseapp.com'

function fileKey(value, platform = process.platform) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    return platform === 'win32' ? pathname.toLowerCase() : pathname
  } catch { return null }
}

// Reloads keep the same file; query strings and fragments are allowed.
function isAllowedAppNavigation(target, appFile, platform = process.platform) {
  const expected = fileKey(pathToFileURL(appFile).href, platform)
  return Boolean(expected) && fileKey(target, platform) === expected
}

// Firebase signInWithPopup opens its auth handler; popups never receive the
// preload, so they are allowed only for that handler.
function isFirebaseAuthPopup(target) {
  try {
    const url = new URL(target)
    return url.origin === FIREBASE_AUTH_ORIGIN && url.pathname.startsWith('/__/auth/')
  } catch { return false }
}

function attachNavigationGuard(webContents, appFile, { allowAuthPopup = false } = {}) {
  webContents.on('will-navigate', (event, target) => {
    if (!isAllowedAppNavigation(target, appFile)) {
      event.preventDefault()
      console.warn('[Navigation] Blocked', String(target).slice(0, 200))
    }
  })
  webContents.setWindowOpenHandler(({ url }) => {
    if (allowAuthPopup && isFirebaseAuthPopup(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }
    }
    console.warn('[Navigation] Blocked window.open', String(url).slice(0, 200))
    return { action: 'deny' }
  })
}

module.exports = { FIREBASE_AUTH_ORIGIN, isAllowedAppNavigation, isFirebaseAuthPopup, attachNavigationGuard }
