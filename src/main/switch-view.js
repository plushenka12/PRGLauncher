// The "Switch window": a capture card shown full screen on a chosen monitor,
// with its sound on the PC's output, instead of OBS. These helpers keep the
// saved choice valid and decide which windows may use the camera/microphone.
const QUALITIES = {
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '720p60': { width: 1280, height: 720, frameRate: 60 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
}
const AUDIO_MODES = new Set(['auto', 'none'])
// Replay buffer length in seconds; 0 is off (the default: recording costs GPU).
const REPLAY_SECONDS = [0, 30, 60]

const text = (value, max = 256) => (typeof value === 'string' && value.length <= max ? value : '')

function sanitizeSwitchConfig(input) {
  const config = input && typeof input === 'object' ? input : {}
  const audioId = text(config.audioId)
  return {
    videoId: text(config.videoId),
    videoLabel: text(config.videoLabel),
    audioId: AUDIO_MODES.has(audioId) ? audioId : audioId || 'auto',
    audioLabel: text(config.audioLabel),
    displayId: Number.isFinite(Number(config.displayId)) ? Number(config.displayId) : null,
    quality: Object.prototype.hasOwnProperty.call(QUALITIES, config.quality) ? config.quality : '1080p60',
    replay: REPLAY_SECONDS.includes(Number(config.replay)) ? Number(config.replay) : 0,
    outputId: text(config.outputId) || 'default',
    outputLabel: text(config.outputLabel),
    mode: config.mode === 'window' ? 'window' : 'fullscreen',
  }
}

// Bounds of the Switch window in window mode: the remembered ones if they
// are still on a connected monitor, else 1280×720 (or two thirds of a smaller
// screen) centred on the chosen monitor.
const MIN_WINDOW = { width: 480, height: 270 }
function switchWindowBounds({ saved, display, displays, isReachable }) {
  const box = saved && typeof saved === 'object' ? ['x', 'y', 'width', 'height'].map(key => Math.round(Number(saved[key]))) : []
  if (box.length === 4 && box.every(Number.isFinite) && box[2] >= MIN_WINDOW.width && box[3] >= MIN_WINDOW.height) {
    const bounds = { x: box[0], y: box[1], width: box[2], height: box[3] }
    if (isReachable(bounds, displays)) return bounds
  }
  const area = display.workArea
  const width = Math.max(MIN_WINDOW.width, Math.min(1280, Math.round(area.width * 2 / 3)))
  const height = Math.round(width * 9 / 16)
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
}

// Where a clip from the Switch window is saved. The page only suggests a name;
// anything but our own "PRG Switch <date>.mp4|webm" is replaced, and an
// existing file is never overwritten.
const CLIP_NAME = /^PRG Switch \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mp4|webm|png)$/
function clipSavePath({ folder, filename, exists, join, now = new Date() }) {
  const extension = (/\.(webm|png)$/i.exec(String(filename || ''))?.[1] || 'mp4').toLowerCase()
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const base = CLIP_NAME.test(String(filename || '')) ? String(filename).replace(/\.(mp4|webm|png)$/, '') : `PRG Switch ${stamp}`
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(folder, `${base}${index > 1 ? ` (${index})` : ''}.${extension}`)
    if (!exists(candidate)) return candidate
  }
  return join(folder, `${base} ${Date.now()}.${extension}`)
}

const isConfigured = config => Boolean(config.videoId || config.videoLabel)

// The chosen monitor if it is still connected, else the second one, else the main one.
function pickSwitchDisplay(displays, primaryId, displayId) {
  return displays.find(display => display.id === displayId)
    || displays.find(display => display.id !== primaryId)
    || displays.find(display => display.id === primaryId)
    || displays[0]
}

// Deny by default. Our own local pages may use the camera/microphone (the
// launcher lists capture devices; the Switch window shows one) and may write
// to the clipboard (copying the profile link). Nothing else gets a permission.
function allowPermission({ permission, url, role }) {
  if (!String(url || '').startsWith('file:')) return false
  if (permission === 'media') return role === 'main' || role === 'switch'
  if (permission === 'clipboard-sanitized-write') return role === 'main'
  return false
}

module.exports = { QUALITIES, REPLAY_SECONDS, MIN_WINDOW, sanitizeSwitchConfig, isConfigured, pickSwitchDisplay, allowPermission, clipSavePath, switchWindowBounds }
