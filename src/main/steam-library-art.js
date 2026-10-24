const path = require('path')
const { pathToFileURL } = require('url')

// Steam caches the library art of each game the user has seen in its client
// under appcache/librarycache/<appid>/ (newer clients add one hashed folder per
// asset). Using those files gives every installed game its real portrait
// capsule and hero image, including new games whose CDN paths are hashed.
const ART_FILES = {
  'library_600x900.jpg': 'capsule',
  'library_capsule.jpg': 'capsule',
  'library_hero.jpg': 'hero',
}

function createSteamLibraryArt({ fs, getSteamPath }) {
  const cache = new Map()

  function find(appId) {
    const id = String(appId || '')
    const steamPath = getSteamPath()
    if (!steamPath || !/^\d+$/.test(id)) return null
    if (cache.has(id)) return cache.get(id)
    const found = {}
    const visit = (dir, depth) => {
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.isDirectory() && depth < 1) visit(path.join(dir, entry.name), depth + 1)
        else if (entry.isFile() && ART_FILES[entry.name] && !found[ART_FILES[entry.name]]) found[ART_FILES[entry.name]] = pathToFileURL(path.join(dir, entry.name)).href
      }
    }
    visit(path.join(steamPath, 'appcache', 'librarycache', id), 0)
    if (!Object.keys(found).length) return null
    // Misses are not cached, so art appears once Steam downloads it.
    cache.set(id, found)
    return found
  }

  // Adds `art` to each mini-tab game that has local Steam art.
  function decorate(state) {
    if (!state || !Array.isArray(state.games)) return state
    return { ...state, games: state.games.map(game => {
      const art = find(game?.appId)
      return art ? { ...game, art } : game
    }) }
  }

  return { find, decorate }
}

module.exports = { createSteamLibraryArt }
