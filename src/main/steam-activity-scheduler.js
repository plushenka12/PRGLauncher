// Decides how often to ask Windows which Steam game is running. Each check
// starts a `reg` process, so the launcher checks rarely while idle, a little
// more often while a game runs, and quickly for a short burst after a hint
// that something changed (Steam's game-process log, or a launch from here).
const DEFAULT_INTERVALS = { idle: 15000, running: 5000, burst: 1500 }
const DEFAULT_BURST_MS = 45000

function createActivityScheduler({
  poll,
  intervals = DEFAULT_INTERVALS,
  burstMs = DEFAULT_BURST_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null
  let running = false
  let inFlight = false
  let pending = false
  let stopped = true
  let burstUntil = 0
  let polls = 0

  function delay() {
    if (now() < burstUntil) return intervals.burst
    return running ? intervals.running : intervals.idle
  }

  function schedule(ms) {
    if (stopped) return
    if (timer) clearTimer(timer)
    timer = setTimer(tick, ms)
  }

  async function tick() {
    timer = null
    if (stopped) return
    if (inFlight) { pending = true; return }
    inFlight = true
    try {
      polls += 1
      const result = await poll()
      if (result !== undefined) running = Boolean(result)
    } catch {}
    finally {
      inFlight = false
    }
    if (pending) { pending = false; schedule(0); return }
    schedule(delay())
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      schedule(0)
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
    // Something may have started or stopped: check now, then keep checking
    // quickly for a while in case Steam updates the registry a moment later.
    notify() {
      burstUntil = now() + burstMs
      if (inFlight) { pending = true; return }
      schedule(0)
    },
    stats: () => ({ polls, running, nextDelay: delay() }),
  }
}

// Steam appends to logs/gameprocess_log.txt when a game process starts or
// stops ("adding PID", "Remove <appid> from running list").
function isGameProcessLog(filename) {
  return /^gameprocess_log/i.test(String(filename || ''))
}

module.exports = { createActivityScheduler, isGameProcessLog, DEFAULT_INTERVALS, DEFAULT_BURST_MS }
