// Where the mini-tab opens. It has one fixed size; by default it sits in the
// top-right corner of the second (non-primary) monitor, and once the user
// moves it, that place is remembered and reused while it is still on screen.
const MINI_TAB_SIZE = { width: 340, height: 560 }
const MARGIN = 16

function pickDisplay(displays, primaryId) {
  return displays.find(display => display.id !== primaryId)
    || displays.find(display => display.id === primaryId)
    || displays[0]
}

// The fixed size, shrunk only on a screen too small to hold it.
function sizeFor(area) {
  return {
    width: Math.min(MINI_TAB_SIZE.width, area.width - MARGIN * 2),
    height: Math.min(MINI_TAB_SIZE.height, area.height - MARGIN * 2),
  }
}

function defaultBounds(display) {
  const area = display.workArea
  const { width, height } = sizeFor(area)
  return { x: area.x + area.width - width - MARGIN, y: area.y + MARGIN, width, height }
}

// Saved positions count only while the window's top strip (where it is
// dragged) is still on some monitor, so an unplugged screen never strands it.
function isReachable(bounds, displays) {
  const strip = { x: bounds.x, y: bounds.y, width: bounds.width, height: 36 }
  return displays.some(({ workArea: area }) => {
    const overlapX = Math.min(strip.x + strip.width, area.x + area.width) - Math.max(strip.x, area.x)
    const overlapY = Math.min(strip.y + strip.height, area.y + area.height) - Math.max(strip.y, area.y)
    return overlapX >= 80 && overlapY >= 20
  })
}

function sanitize(saved) {
  if (!saved || typeof saved !== 'object') return null
  const x = Number(saved.x)
  const y = Number(saved.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// A remembered position stays on the monitor it was on and is pulled fully
// inside it, so the fixed-size window never straddles two screens.
function resolveMiniTabBounds({ saved, displays, primaryId }) {
  const position = sanitize(saved)
  const display = position && displays.find(candidate => isReachable({ ...position, width: MINI_TAB_SIZE.width, height: 36 }, [candidate]))
  if (!display) return defaultBounds(pickDisplay(displays, primaryId))
  const area = display.workArea
  const size = sizeFor(area)
  return {
    x: clamp(position.x, area.x, area.x + area.width - size.width),
    y: clamp(position.y, area.y, area.y + area.height - size.height),
    ...size,
  }
}

function loadSavedBounds(fs, file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { return null }
}

function saveBounds(fs, file, bounds) {
  const clean = sanitize(bounds)
  if (!clean) return
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(clean))
    fs.renameSync(`${file}.tmp`, file)
  } catch (error) {
    console.warn('[MiniTab] Could not save position:', error.message)
  }
}

module.exports = { resolveMiniTabBounds, loadSavedBounds, saveBounds, isReachable, MINI_TAB_SIZE }
