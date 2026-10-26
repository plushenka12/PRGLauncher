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
  }
}

// Where a clip from the Switch window is saved. The page only suggests a name;
// anything but our own "PRG Switch <date>.mp4|webm" is replaced, and an
// existing file is never overwritten.
const CLIP_NAME = /^PRG Switch \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mp4|webm)$/
function clipSavePath({ folder, filename, exists, join, now = new Date() }) {
  const extension = /\.webm$/i.test(String(filename || '')) ? 'webm' : 'mp4'
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')
  const base = CLIP_NAME.test(String(filename || '')) ? String(filename).replace(/\.(mp4|webm)$/, '') : `PRG Switch ${stamp}`
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

module.exports = { QUALITIES, REPLAY_SECONDS, sanitizeSwitchConfig, isConfigured, pickSwitchDisplay, allowPermission, clipSavePath }
