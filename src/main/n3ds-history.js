// Nintendo 3DS play history (PTM PlayHistory.dat, see 3dbrew "PTM Savegame")
// turned into play sessions. The file comes from the owner's 3DS over the
// LAN, so it is untrusted: sizes are checked and impossible spans dropped.
//
// Layout: u32 start index, u32 entry count, then 12-byte entries (little
// endian): u32 TitleID high, u32 TitleID low, u32 info. The low 4 bits of
// info are the event, the upper 28 bits minutes since 2000-01-01 in the
// console's local time. The log is a ring buffer of up to 73 000 entries.
const ENTRY_SIZE = 12
const MAX_ENTRIES = 0x11D28
const FILE_SIZE = 8 + MAX_ENTRIES * ENTRY_SIZE
const SPECIAL_HIGH = 0xFFFFFFFF

// Events for a title (bit 0: close, bit 1: applet, bit 2: resume/suspend).
const LAUNCH = new Set([0b0000, 0b0010])
const CLOSE = new Set([0b0001, 0b0011])
const SUSPEND = new Set([0b0101, 0b0111])
const RESUME = new Set([0b0100, 0b0110])
// Special entries (TitleID FFFFFFFF FFFFFFFF).
const DS_MODE_END = 1
const SLEEP_START = 8
const SLEEP_END = 9
const SERVICES_STOPPED = 10
const CLOCK_FROM = 11
const CLOCK_TO = 12

// Only games: applications, demos and DSiWare. System titles are skipped.
const GAME_HIGH = new Set([0x00040000, 0x00040002, 0x00048004])
// A span longer than this is a missing close (a flat battery, a crash), not
// play, so it is dropped rather than counted.
const MAX_SPAN_MINUTES = 8 * 60

function readEntries(buffer, { rotate = true } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > FILE_SIZE) return null
  const start = rotate ? buffer.readUInt32LE(0) : 0
  const count = buffer.readUInt32LE(4)
  const available = Math.floor((buffer.length - 8) / ENTRY_SIZE)
  if (count > MAX_ENTRIES || count > available) return null
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + ((start + index) % count) * ENTRY_SIZE
    const info = buffer.readUInt32LE(offset + 8)
    entries.push({ high: buffer.readUInt32LE(offset), low: buffer.readUInt32LE(offset + 4), event: info & 0xF, minute: info >>> 4 })
  }
  return entries
}

const backwardSteps = entries => entries.reduce((count, entry, index) => count + (index && entry.minute < entries[index - 1].minute ? 1 : 0), 0)

// The PTM service hands out the same entries as the file, but it is not
// documented whether they come oldest first or in ring order. Whichever
// reading runs forward in time more consistently is taken.
function readServiceEntries(buffer) {
  const asReturned = readEntries(buffer, { rotate: false })
  const rotated = readEntries(buffer)
  if (!asReturned || !rotated) return null
  return backwardSteps(rotated) < backwardSteps(asReturned) ? rotated : asReturned
}

const titleIdOf = entry => entry.high.toString(16).padStart(8, '0').toUpperCase() + entry.low.toString(16).padStart(8, '0').toUpperCase()

// Walks the log keeping the one running game (the 3DS runs one application at
// a time). Play pauses while the game is suspended in the HOME Menu or the
// console sleeps; a clock change moves the running span with the clock.
function buildSessions(entries) {
  const sessions = []
  let skipped = 0
  let current = null
  let clockFrom = null

  const pause = minute => {
    if (!current || current.since == null) return
    const span = minute - current.since
    if (span < 0 || span > MAX_SPAN_MINUTES) { current.broken = true } else current.played += span
    current.since = null
  }
  const finish = minute => {
    if (!current) return
    pause(minute)
    if (current.broken) skipped += 1
    else if (current.played > 0) sessions.push({ titleId: current.titleId, startMinute: current.startMinute, endMinute: minute, minutes: current.played })
    current = null
  }

  for (const entry of entries) {
    if (entry.high === SPECIAL_HIGH && entry.low === SPECIAL_HIGH) {
      if (entry.event === SLEEP_START) pause(entry.minute)
      else if (entry.event === SLEEP_END) { if (current && current.since == null && !current.suspended) current.since = entry.minute }
      else if (entry.event === SERVICES_STOPPED || entry.event === DS_MODE_END) finish(entry.minute)
      else if (entry.event === CLOCK_FROM) clockFrom = entry.minute
      else if (entry.event === CLOCK_TO && clockFrom != null) {
        if (current && current.since != null) current.since += entry.minute - clockFrom
        clockFrom = null
      }
      continue
    }
    const titleId = titleIdOf(entry)
    if (LAUNCH.has(entry.event)) {
      if (current && current.titleId === titleId && current.since != null) continue
      finish(entry.minute)
      if (GAME_HIGH.has(entry.high)) current = { titleId, startMinute: entry.minute, since: entry.minute, played: 0, suspended: false, broken: false }
    } else if (!current || current.titleId !== titleId) {
      continue
    } else if (SUSPEND.has(entry.event)) {
      pause(entry.minute)
      current.suspended = true
    } else if (RESUME.has(entry.event)) {
      if (current.since == null) current.since = entry.minute
      current.suspended = false
    } else if (CLOSE.has(entry.event)) {
      finish(entry.minute)
    }
  }
  // A session still open at the end is the one running now (the uploader's
  // host title) or one that never closed; neither is counted.
  return { sessions, skipped }
}

// Console minutes are local time; the PC is assumed to be in the same zone.
const minuteToTime = minute => new Date(2000, 0, 1, 0, minute).getTime()

const TITLE_ID = /^[0-9A-F]{16}$/
function cleanTitles(list) {
  const titles = new Map()
  for (const item of Array.isArray(list) ? list.slice(0, 2000) : []) {
    const id = String(item?.id || '').toUpperCase()
    const name = String(item?.name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (TITLE_ID.test(id) && name) titles.set(id, name)
  }
  return titles
}

// The upload body: { version: 1, source: 'ptm' | 'file', titles: [{ id, name }], history: base64 }.
// Returns games with their sessions, or an error code.
function parseUpload(body) {
  if (!body || typeof body !== 'object' || body.version !== 1 || typeof body.history !== 'string') return { ok: false, code: 'bad-format' }
  if (body.history.length > Math.ceil(FILE_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.history)) return { ok: false, code: 'bad-history' }
  const raw = Buffer.from(body.history, 'base64')
  const entries = body.source === 'ptm' ? readServiceEntries(raw) : readEntries(raw)
  if (!entries) return { ok: false, code: 'bad-history' }
  const titles = cleanTitles(body.titles)
  const { sessions, skipped } = buildSessions(entries)
  const games = new Map()
  let unnamed = 0
  for (const session of sessions) {
    const title = titles.get(session.titleId)
    if (!title) { unnamed += 1; continue }
    if (!games.has(session.titleId)) games.set(session.titleId, { titleId: session.titleId, title, sessions: [] })
    const start = minuteToTime(session.startMinute)
    games.get(session.titleId).sessions.push({ start, end: start + (session.endMinute - session.startMinute) * 60000, dur: session.minutes * 60000 })
  }
  return { ok: true, entries: entries.length, skipped, unnamed, games: [...games.values()] }
}

module.exports = { parseUpload, readEntries, buildSessions, minuteToTime, FILE_SIZE, MAX_ENTRIES, MAX_SPAN_MINUTES }
