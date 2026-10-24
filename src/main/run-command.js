const { execFile } = require('child_process')

// Runs a system tool without a shell and without blocking the main process.
// Resolves instead of rejecting: callers only need the output or a failure,
// and a missing registry key is an ordinary non-zero exit for `reg query`.
function runCommand(file, args, { timeout = 5000, maxBuffer = 8 * 1024 * 1024, exec = execFile } = {}) {
  return new Promise(resolve => {
    exec(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') })
    })
  })
}

module.exports = { runCommand }
