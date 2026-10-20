function parseRunningSteamAppId(output) {
  let currentAppId = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    const keyMatch = line.match(/\\Apps\\(\d+)\s*$/i);
    if (keyMatch) { currentAppId = keyMatch[1]; continue; }
    if (currentAppId && /\bRunning\b\s+REG_DWORD\s+0x1\b/i.test(line)) return currentAppId;
  }
  return null;
}

module.exports = { parseRunningSteamAppId };
