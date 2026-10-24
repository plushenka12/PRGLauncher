const path = require('path')

// Executables the user has approved for launching. The renderer cannot write
// this list: entries are added only by the main process after a native file
// picker choice or an explicit native confirmation.
const MAX_ENTRIES = 1000

function normalizeExecutablePath(value, platform = process.platform) {
  const input = String(value || '').trim()
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!input || input.length > 1024 || input.includes('\0') || !paths.isAbsolute(input)) return null
  const resolved = paths.resolve(input)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

function createLaunchAllowlist({ filePath, fs, platform = process.platform }) {
  let entries = null

  function load() {
    if (entries) return entries
    entries = new Set()
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const list = Array.isArray(data?.executables) ? data.executables : []
      list.map(item => normalizeExecutablePath(item, platform)).filter(Boolean).slice(-MAX_ENTRIES).forEach(item => entries.add(item))
    } catch {}
    return entries
  }

  function save() {
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, executables: [...entries] }, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
  }

  return {
    has(executable) {
      const key = normalizeExecutablePath(executable, platform)
      return Boolean(key) && load().has(key)
    },
    add(executable) {
      const key = normalizeExecutablePath(executable, platform)
      if (!key) return false
      const set = load()
      if (set.has(key)) return true
      set.add(key)
      while (set.size > MAX_ENTRIES) set.delete(set.values().next().value)
      try { save() } catch (error) { console.warn('[Launch] Could not save allowlist:', error.message) }
      return true
    },
  }
}

module.exports = { normalizeExecutablePath, createLaunchAllowlist, MAX_ENTRIES }
