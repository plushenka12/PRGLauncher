// Keeps Steam's main library window out of sight during the moments Steam
// opens it on its own: start-up, a game launch from the launcher, a game
// exiting and the start of a download. It only ever hides the unowned
// top-level window titled "Steam" (class SDL_app) of steamwebhelper; sign-in,
// install, cloud-conflict and other dialogs have their own titles and are
// left alone, and outside these short windows Steam is never touched, so a
// Steam window the user opens later stays open.

const STEAM_GUARD_SCRIPT = `
param([int]$DurationMs)
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PrgSteamGuard {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int cmd);
  public static int HideMain(HashSet<uint> pids) {
    int hidden = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      var t = new StringBuilder(64); GetWindowText(h, t, 64);
      if (c.ToString() == "SDL_app" && t.ToString() == "Steam") { ShowWindowAsync(h, 0); hidden++; }
      return true;
    }, IntPtr.Zero);
    return hidden;
  }
}
'@
$deadline = (Get-Date).AddMilliseconds($DurationMs)
while ((Get-Date) -lt $deadline) {
  $pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
  Get-Process steamwebhelper -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
  if ($pids.Count -gt 0) { [void][PrgSteamGuard]::HideMain($pids) }
  Start-Sleep -Milliseconds 400
}
`

// One PowerShell process watches for the whole period; a new request only
// restarts it when it reaches further than the period already covered.
function createSteamWindowGuard({ spawnGuard, now = Date.now }) {
  let child = null
  let until = 0

  return {
    guard(durationMs) {
      const end = now() + durationMs
      if (child && end <= until) return false
      if (child) { try { child.kill() } catch {} }
      until = end
      const current = spawnGuard(durationMs)
      child = current
      current?.on?.('exit', () => { if (child === current) child = null })
      return true
    },
    stop() {
      if (child) { try { child.kill() } catch {} }
      child = null
      until = 0
    },
    active: () => Boolean(child),
  }
}

module.exports = { STEAM_GUARD_SCRIPT, createSteamWindowGuard }
