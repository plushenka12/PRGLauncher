const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('expired Nintendo grant stops retries and offers a new sign-in', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8')
  const start = html.indexOf('let nintendoSyncTimer=null,nintendoProfileReady=false,nintendoAuthRequired=false;')
  const end = html.indexOf('function startNintendoAutoSync()', start)
  assert.ok(start >= 0 && end > start)
  const button = { textContent: '', dataset: { checking: '2' }, disabled: true }
  const cleared = []
  let status = ''
  const context = {
    nintendoConnectBtn: button,
    clearInterval: value => cleared.push(value),
    setNintendoSyncStatus: value => { status = value },
    t: value => value
  }
  const state = vm.runInNewContext(`${html.slice(start, end)}\nnintendoSyncTimer=17;requireNintendoReconnect();({authRequired:nintendoAuthRequired,timer:nintendoSyncTimer})`, context)
  assert.equal(state.authRequired, true)
  assert.equal(state.timer, null)
  assert.deepEqual(cleared, [17])
  assert.equal(button.dataset.checking, '0')
  assert.equal(button.disabled, false)
  assert.equal(button.textContent, 'Повторно увійти в Nintendo')
  assert.match(status, /ігри й час залишаться/)
})
