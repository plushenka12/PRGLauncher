const path = require('path')

// Programs started together with a game (for example Path of Building and
// Awakened PoE Trade with Path of Exile). Only programs the launcher started
// itself are remembered, so one the user opened earlier is never closed.
function createCompanionApps({ runCommand, spawn, platform = process.platform }) {
  const launched = new Map()
  const paths = platform === 'win32' ? path.win32 : path.posix
  const imageNameOf = executable => paths.basename(executable)

  async function isRunning(imageName) {
    if (platform !== 'win32') return false
    const { stdout } = await runCommand('tasklist', ['/fi', `imagename eq ${imageName}`, '/fo', 'csv', '/nh'])
    return stdout.toLowerCase().includes(`"${imageName.toLowerCase()}"`)
  }

  async function launch({ gameId, executable, closeWithGame }) {
    const imageName = imageNameOf(executable)
    if (await isRunning(imageName)) return { action: 'already-running' }
    const child = spawn(executable, [], { cwd: paths.dirname(executable), detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    const list = launched.get(gameId) || []
    list.push({ imageName, closeWithGame: Boolean(closeWithGame) })
    launched.set(gameId, list)
    return { action: 'requested' }
  }

  // A polite close (like the window's ×): a program can still ask to save,
  // and one that ignores it simply stays open. Nothing is force-killed.
  async function closeFor(gameId) {
    const list = launched.get(gameId) || []
    launched.delete(gameId)
    const names = [...new Set(list.filter(app => app.closeWithGame).map(app => app.imageName))]
    if (platform === 'win32') for (const imageName of names) await runCommand('taskkill', ['/im', imageName, '/t'])
    return { closed: names.length }
  }

  return { launch, closeFor, tracked: gameId => [...(launched.get(gameId) || [])] }
}

module.exports = { createCompanionApps }
