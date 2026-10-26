// The taskbar jump list: right-click PRGLauncher on the taskbar to start one
// of the recently played games. Windows draws the menu itself; we give each
// game its own icon (Steam's cached game icon, or the .exe for local games)
// and a tooltip with the time played.
const path = require('path')

const LAUNCH_ARG = '--prg-launch='
const GAME_ID = /^[\w.:-]{1,128}$/
const MAX_GAMES = 7

// The game id passed by a jump-list click, if any.
function launchIdFrom(argv) {
  const arg = (Array.isArray(argv) ? argv : []).find(item => typeof item === 'string' && item.startsWith(LAUNCH_ARG))
  const id = arg ? arg.slice(LAUNCH_ARG.length) : ''
  return GAME_ID.test(id) ? id : null
}

// What the renderer may send: recent, launchable games only.
function cleanGames(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_GAMES).map(game => ({
    id: String(game?.id || ''),
    title: String(game?.title || '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 120),
    appId: /^\d{1,10}$/.test(String(game?.appId || '')) ? String(game.appId) : '',
    executable: typeof game?.executable === 'string' && /\.exe$/i.test(game.executable) && path.win32.isAbsolute(game.executable) ? game.executable : '',
    detail: String(game?.detail || '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 120),
  })).filter(game => GAME_ID.test(game.id) && game.title)
}

// An .ico file is a small header plus PNG images; Windows Vista+ reads PNG
// entries directly, so a resized PNG is all a game icon needs.
function pngToIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0)
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(6 + 16, 12)
  return Buffer.concat([header, entry, png])
}

// Steam keeps each game's square icon as <sha1>.jpg next to its library art.
function findSteamIcon(fs, steamPath, appId) {
  if (!steamPath || !/^\d+$/.test(appId)) return null
  const dir = path.join(steamPath, 'appcache', 'librarycache', appId)
  try {
    const name = fs.readdirSync(dir).find(file => /^[0-9a-f]{40}\.jpg$/i.test(file))
    return name ? path.join(dir, name) : null
  } catch { return null }
}

function buildItems(games, { program, baseArgs, iconFor }) {
  return games.map(game => {
    const icon = iconFor(game)
    return {
      type: 'task',
      title: game.title,
      description: game.detail || game.title,
      program,
      args: [...baseArgs, `${LAUNCH_ARG}${game.id}`].map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' '),
      iconPath: icon || program,
      iconIndex: 0,
    }
  })
}

module.exports = { LAUNCH_ARG, launchIdFrom, cleanGames, pngToIco, findSteamIcon, buildItems, MAX_GAMES }
