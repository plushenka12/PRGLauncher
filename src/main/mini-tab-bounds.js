// Where the mini-tab opens. By default it sits in the top-right corner of the
// second (non-primary) monitor at a third of its height; once the user moves or
// resizes it, that place is remembered and reused while it is still on screen.
const DEFAULT_WIDTH = 330
const MIN_WIDTH = 270
const MIN_HEIGHT = 260
const MARGIN = 16

function pickDisplay(displays, primaryId) {
  return displays.find(display => display.id !== primaryId)
    || displays.find(display => display.id === primaryId)
    || displays[0]
}

function defaultBounds(display) {
  const area = display.workArea
  const width = Math.min(DEFAULT_WIDTH, area.width - MARGIN * 2)
  const height = Math.max(MIN_HEIGHT, Math.round(area.height / 3))
  return { x: area.x + area.width - width - MARGIN, y: area.y + MARGIN, width, height }
}

// Saved bounds count only while their top strip (where the window is dragged)
// is still on some monitor, so an unplugged screen never strands the window.
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
  const values = ['x', 'y', 'width', 'height'].map(key => Number(saved[key]))
  if (!values.every(Number.isFinite)) return null
  const [x, y, width, height] = values.map(Math.round)
  return { x, y, width: Math.max(MIN_WIDTH, width), height: Math.max(MIN_HEIGHT, height) }
}

function resolveMiniTabBounds({ saved, displays, primaryId }) {
  const bounds = sanitize(saved)
  if (bounds && isReachable(bounds, displays)) return bounds
  return defaultBounds(pickDisplay(displays, primaryId))
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

module.exports = { resolveMiniTabBounds, loadSavedBounds, saveBounds, isReachable, MIN_WIDTH, MIN_HEIGHT }
