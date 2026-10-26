// Watches whether a full-screen program (a game) is in front, so the
// always-on-top mini-tab can step aside while it covers the same monitor.
// One hidden PowerShell asks Windows every 2 s (SHQueryUserNotificationState)
// and prints a line only when the answer changes, so it costs next to nothing.
const FULLSCREEN_SCRIPT = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class PrgFullscreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
}
'@
$last = ''
while ($true) {
  $state = 0
  [void][PrgFullscreen]::SHQueryUserNotificationState([ref]$state)
  $line = 'none'
  if ($state -eq 2 -or $state -eq 3 -or $state -eq 7) {
    $window = [PrgFullscreen]::GetForegroundWindow()
    $owner = [uint32]0
    [void][PrgFullscreen]::GetWindowThreadProcessId($window, [ref]$owner)
    $rect = New-Object PrgFullscreen+RECT
    [void][PrgFullscreen]::GetWindowRect($window, [ref]$rect)
    $line = "full $owner $($rect.Left) $($rect.Top) $($rect.Right) $($rect.Bottom)"
  }
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Seconds 2
}
`

// "full <pid> <left> <top> <right> <bottom>" or "none".
function parseLine(line) {
  const match = /^full (\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/.exec(String(line).trim())
  if (!match) return null
  const [pid, left, top, right, bottom] = match.slice(1).map(Number)
  if (right <= left || bottom <= top) return null
  return { pid, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
}

function createFullscreenWatch({ spawn, onChange, log = () => {}, setTimer = setTimeout }) {
  let child = null
  let stopped = true
  let restarts = 0
  let buffer = ''

  function run() {
    buffer = ''
    // Encoded, so the quotes in the C# signatures survive the command line.
    const encoded = Buffer.from(FULLSCREEN_SCRIPT, 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      for (const line of lines) if (line.trim()) onChange(parseLine(line))
    })
    child.on('exit', () => {
      child = null
      onChange(null)
      // A crashed watcher is restarted a few times, then left off.
      if (!stopped && restarts < 3) { restarts += 1; setTimer(() => { if (!stopped && !child) run() }, 5000 * restarts) }
      else if (!stopped) log('[Fullscreen] Watcher stopped after repeated exits')
    })
    child.on('error', error => log('[Fullscreen] Watcher failed:', error.message))
  }

  return {
    start() { if (!stopped) return; stopped = false; restarts = 0; run() },
    stop() { stopped = true; if (child) { child.kill(); child = null } },
  }
}

module.exports = { FULLSCREEN_SCRIPT, parseLine, createFullscreenWatch }
