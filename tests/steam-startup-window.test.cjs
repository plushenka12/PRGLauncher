const test = require('node:test')
const assert = require('node:assert/strict')

const { STEAM_STARTUP_HIDE_SCRIPT, scheduleSteamStartupHide } = require('../src/main/steam-startup-window')

test('startup hide targets only the Steam main window, not account or install dialogs', () => {
  assert.match(STEAM_STARTUP_HIDE_SCRIPT, /ProcessName -in @\('steam', 'steamwebhelper'\)/)
  assert.match(STEAM_STARTUP_HIDE_SCRIPT, /MainWindowTitle -eq 'Steam'/)
  assert.match(STEAM_STARTUP_HIDE_SCRIPT, /ShowWindowAsync/)
  assert.doesNotMatch(STEAM_STARTUP_HIDE_SCRIPT, /ProcessName -like 'steam\*'/)
})

test('startup hide retries briefly and stops once the launcher becomes visible', () => {
  const queued = []
  const delays = []
  let visible = false
  let hides = 0
  scheduleSteamStartupHide({
    runHide: () => { hides += 1 },
    shouldContinue: () => !visible,
    schedule: (callback, delay) => { queued.push(callback); delays.push(delay) },
  })

  assert.deepEqual(delays, [1000, 3000, 6000, 10000, 15000])
  queued[0]()
  assert.equal(hides, 1)
  visible = true
  queued.slice(1).forEach(callback => callback())
  assert.equal(hides, 1)
})
