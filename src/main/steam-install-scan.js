const path = require('path')

// Install/download status for many Steam apps at once. One directory listing
// per library replaces per-app probing, and a manifest is parsed again only
// when its size or modification time changes.

function readVdfNumber(contents, key) {
  const match = contents.match(new RegExp(`"${key}"\\s+"(\\d+)"`))
  return match ? Number(match[1]) : null
}

function createSteamInstallScanner({ fs }) {
  const manifests = new Map()

  function listIds(directory, pattern) {
    const ids = new Set()
    let entries = []
    try { entries = fs.readdirSync(directory) } catch { return ids }
    for (const name of entries) {
      const match = pattern.exec(name)
      if (match) ids.add(match[1])
    }
    return ids
  }

  function readManifest(file) {
    let stat
    try { stat = fs.statSync(file) } catch { manifests.delete(file); return null }
    const cached = manifests.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
    let data
    try { data = fs.readFileSync(file, 'utf8') } catch { return null }
    const entry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      flags: readVdfNumber(data, 'StateFlags'),
      downloaded: readVdfNumber(data, 'BytesDownloaded'),
      total: readVdfNumber(data, 'BytesToDownload'),
    }
    manifests.set(file, entry)
    return entry
  }

  // A snapshot of which manifests and download folders exist right now.
  function scan(libraries) {
    return libraries.map(library => {
      const steamApps = path.join(library, 'steamapps')
      return {
        steamApps,
        manifests: listIds(steamApps, /^appmanifest_(\d+)\.acf$/i),
        downloading: listIds(path.join(steamApps, 'downloading'), /^(\d+)$/),
      }
    })
  }

  // Same rules as before: installed when any library's manifest has Steam's
  // installed bit (4); downloading only while Steam keeps the download folder.
  function statusFor(appId, snapshot, hasSteam) {
    const id = String(appId)
    for (const library of snapshot) {
      if (!library.manifests.has(id)) continue
      const manifest = readManifest(path.join(library.steamApps, `appmanifest_${id}.acf`))
      if (manifest && manifest.flags !== null && (manifest.flags & 4) === 4) return { state: 'ready', progress: 100, downloaded: null, total: null }
    }
    for (const library of snapshot) {
      if (!library.downloading.has(id)) continue
      const manifest = library.manifests.has(id) ? readManifest(path.join(library.steamApps, `appmanifest_${id}.acf`)) : null
      const downloaded = manifest ? manifest.downloaded : null
      const total = manifest ? manifest.total : null
      const progress = total && downloaded !== null ? Math.min(99, Math.floor(downloaded / total * 100)) : null
      return { state: 'downloading', progress, downloaded, total }
    }
    return { state: hasSteam ? 'waiting' : 'steam_not_found', progress: null, downloaded: null, total: null }
  }

  return { scan, statusFor, cacheSize: () => manifests.size }
}

module.exports = { readVdfNumber, createSteamInstallScanner }
