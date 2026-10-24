const test = require('node:test')
const assert = require('node:assert/strict')
const { formatNintendoHttpError, createNintendoHttpError, requiresNintendoReauth } = require('../src/main/nintendo-http')

test('Nintendo errors identify the failing stage without exposing response details', () => {
  assert.equal(formatNintendoHttpError('access-token', 400, { error: 'invalid_grant', session_token: 'private-value' }), 'Nintendo access-token HTTP 400 (invalid_grant)')
  assert.equal(formatNintendoHttpError('play-history', 400, { error: 'bad value: private-value', detail: 'private-value' }), 'Nintendo play-history HTTP 400')
  assert.equal(formatNintendoHttpError('unexpected private-value', 400, { error: 'invalid_grant' }), 'Nintendo request HTTP 400 (invalid_grant)')
})

test('only an invalid access-token grant asks for Nintendo reauthorization', () => {
  const revoked = createNintendoHttpError('access-token', 400, { error: 'invalid_grant' })
  assert.equal(requiresNintendoReauth(revoked), true)
  assert.equal(requiresNintendoReauth(createNintendoHttpError('play-history', 400, { error: 'invalid_grant' })), false)
  assert.equal(requiresNintendoReauth(createNintendoHttpError('access-token', 503, { error: 'invalid_grant' })), false)
  assert.equal(requiresNintendoReauth(createNintendoHttpError('access-token', 400, { error: 'invalid_request' })), false)
})
