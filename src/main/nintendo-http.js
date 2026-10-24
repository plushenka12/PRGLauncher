function formatNintendoHttpError(stage, status, data) {
  const safeStage = ['session-token', 'access-token', 'play-history'].includes(stage) ? stage : 'request'
  const code = typeof data?.error === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(data.error) ? data.error : null
  return `Nintendo ${safeStage} HTTP ${status}${code ? ` (${code})` : ''}`
}

function createNintendoHttpError(stage, status, data) {
  const error = new Error(formatNintendoHttpError(stage, status, data))
  error.nintendoStage = stage
  error.nintendoStatus = status
  error.nintendoCode = typeof data?.error === 'string' ? data.error : null
  return error
}

function requiresNintendoReauth(error) {
  return error?.nintendoStage === 'access-token' && error?.nintendoStatus === 400 && error?.nintendoCode === 'invalid_grant'
}

module.exports = { formatNintendoHttpError, createNintendoHttpError, requiresNintendoReauth }
