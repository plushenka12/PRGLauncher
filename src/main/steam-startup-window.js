// This is intentionally narrower than the hide used after launcher-initiated
// installs/launches. An account chooser or install picker must stay usable.
const STEAM_STARTUP_HIDE_SCRIPT = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SteamStartupWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }
'@; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('steam', 'steamwebhelper') -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Steam' } | ForEach-Object { [SteamStartupWindow]::ShowWindowAsync($_.MainWindowHandle, 0) | Out-Null }`

function scheduleSteamStartupHide({ runHide, shouldContinue, schedule = setTimeout }) {
  // Steam and the launcher may start in either order during Windows login.
  for (const delay of [1000, 3000, 6000, 10000, 15000]) {
    schedule(() => {
      if (shouldContinue()) runHide()
    }, delay)
  }
}

module.exports = { STEAM_STARTUP_HIDE_SCRIPT, scheduleSteamStartupHide }
