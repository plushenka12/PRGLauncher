// The "Switch window": a capture card shown full screen on a chosen monitor,
// with its sound on the PC's output, instead of OBS. These helpers keep the
// saved choice valid and decide which windows may use the camera/microphone.
const QUALITIES = {
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '720p60': { width: 1280, height: 720, frameRate: 60 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
}
const AUDIO_MODES = new Set(['auto', 'none'])

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
  }
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

module.exports = { QUALITIES, sanitizeSwitchConfig, isConfigured, pickSwitchDisplay, allowPermission }
