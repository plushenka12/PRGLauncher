// Deny by default. Only the launcher's own local page may write to the
// clipboard (copying the profile link); nothing gets the camera, microphone
// or any other permission.
function allowPermission({ permission, url, role }) {
  if (!String(url || '').startsWith('file:')) return false
  if (permission === 'clipboard-sanitized-write') return role === 'main'
  return false
}

module.exports = { allowPermission }
