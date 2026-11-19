// Switches a monitor's input over DDC/CI (VCP code 0x60, "input source"), so
// the Switch is played on the monitor's own HDMI input at full quality.
// Windows exposes DDC/CI through dxva2.dll; a short hidden PowerShell runs
// each request, as for the full-screen watcher. Nothing here runs unless the
// user asks for it.
const DDC_TYPES = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class PrgDdc {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PHYSICAL_MONITOR { public IntPtr Handle; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX { public int Size; public int L, T, R, B; public int WL, WT, WR, WB; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
  public delegate bool EnumProc(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, EnumProc proc, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("dxva2.dll")] public static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
  [DllImport("dxva2.dll")] public static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PHYSICAL_MONITOR[] list);
  [DllImport("dxva2.dll")] public static extern bool DestroyPhysicalMonitors(uint count, PHYSICAL_MONITOR[] list);
  [DllImport("dxva2.dll")] public static extern bool GetCapabilitiesStringLength(IntPtr handle, out uint length);
  [DllImport("dxva2.dll", CharSet = CharSet.Ansi)] public static extern bool CapabilitiesRequestAndCapabilitiesReply(IntPtr handle, StringBuilder caps, uint length);
  [DllImport("dxva2.dll")] public static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr handle, byte code, IntPtr type, out uint current, out uint max);
  [DllImport("dxva2.dll")] public static extern bool SetVCPFeature(IntPtr handle, byte code, uint value);
  static string Esc(string s) { return (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\""); }
  // Runs fn on every physical monitor: (device, index on that device, bounds, primary, description, handle).
  public static void Each(Action<string, int, int[], bool, string, IntPtr> fn) {
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, dc, rect, data) => {
      var info = new MONITORINFOEX(); info.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
      GetMonitorInfo(monitor, ref info);
      uint count; if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out count) || count == 0) return true;
      var list = new PHYSICAL_MONITOR[count];
      if (!GetPhysicalMonitorsFromHMONITOR(monitor, count, list)) return true;
      try { for (int i = 0; i < list.Length; i++) fn(info.Device, i, new[] { info.L, info.T, info.R - info.L, info.B - info.T }, (info.Flags & 1) == 1, list[i].Description, list[i].Handle); }
      finally { DestroyPhysicalMonitors(count, list); }
      return true;
    }, IntPtr.Zero);
  }
  public static string List() {
    var items = new List<string>();
    Each((device, index, b, primary, description, handle) => {
      uint current = 0, max = 0; bool ddc = GetVCPFeatureAndVCPFeatureReply(handle, 0x60, IntPtr.Zero, out current, out max);
      string caps = ""; uint length;
      if (ddc && GetCapabilitiesStringLength(handle, out length) && length > 0 && length < 65536) { var sb = new StringBuilder((int)length); if (CapabilitiesRequestAndCapabilitiesReply(handle, sb, length)) caps = sb.ToString(); }
      items.Add(String.Format("{{\\"device\\":\\"{0}\\",\\"index\\":{1},\\"bounds\\":[{2},{3},{4},{5}],\\"primary\\":{6},\\"description\\":\\"{7}\\",\\"ddc\\":{8},\\"input\\":{9},\\"caps\\":\\"{10}\\"}}",
        Esc(device), index, b[0], b[1], b[2], b[3], primary ? "true" : "false", Esc(description), ddc ? "true" : "false", ddc ? (current & 0xFF).ToString() : "null", Esc(caps.Length > 4000 ? caps.Substring(0, 4000) : caps)));
    });
    return "[" + String.Join(",", items) + "]";
  }
  public static string Set(string device, int index, uint value) {
    string result = "not-found";
    Each((d, i, b, primary, description, handle) => {
      if (d != device || i != index || result != "not-found") return;
      result = SetVCPFeature(handle, 0x60, value) ? "ok" : "refused";
    });
    return result;
  }
  // The monitor's current input, or "none" when it does not answer.
  public static string Input(string device, int index) {
    string result = "not-found";
    Each((d, i, b, primary, description, handle) => {
      if (d != device || i != index || result != "not-found") return;
      uint current = 0, max = 0;
      result = GetVCPFeatureAndVCPFeatureReply(handle, 0x60, IntPtr.Zero, out current, out max) ? (current & 0xFF).ToString() : "none";
    });
    return result;
  }
}
'@
`

const DEVICE = /^\\\\\.\\DISPLAY\d{1,2}$/

// MCCS input source values. Monitors may use others; the capability string
// lists the ones a monitor accepts.
const INPUT_NAMES = {
  0x01: 'VGA 1', 0x02: 'VGA 2', 0x03: 'DVI 1', 0x04: 'DVI 2', 0x0F: 'DisplayPort 1', 0x10: 'DisplayPort 2',
  0x11: 'HDMI 1', 0x12: 'HDMI 2', 0x13: 'HDMI 3', 0x1B: 'USB-C', 0x1C: 'USB-C 2',
}
const inputName = value => INPUT_NAMES[value] || `0x${Number(value).toString(16).toUpperCase().padStart(2, '0')}`

// "…vcp(02 04 60(0F 11 12) 62…)…" -> [0x0F, 0x11, 0x12]
function parseInputOptions(caps) {
  const match = /(?:^|[\s(])60\s*\(([0-9A-Fa-f\s]*)\)/.exec(String(caps || ''))
  if (!match) return []
  return [...new Set(match[1].trim().split(/\s+/).filter(Boolean).map(hex => parseInt(hex, 16)).filter(value => value > 0 && value < 256))]
}
const modelOf = caps => (/model\(([^)]{1,64})\)/.exec(String(caps || '')) || [])[1] || ''

function cleanMonitor(raw) {
  if (!raw || !DEVICE.test(raw.device) || !Number.isInteger(raw.index) || raw.index < 0 || raw.index > 8) return null
  const options = parseInputOptions(raw.caps)
  const input = Number.isInteger(raw.input) ? raw.input : null
  return {
    id: `${raw.device}#${raw.index}`,
    device: raw.device, index: raw.index,
    name: modelOf(raw.caps) || String(raw.description || 'Monitor').slice(0, 64),
    bounds: Array.isArray(raw.bounds) ? raw.bounds.slice(0, 4).map(Number) : null,
    primary: raw.primary === true,
    ddc: raw.ddc === true,
    input, inputName: input == null ? null : inputName(input),
    options: options.map(value => ({ value, name: inputName(value) })),
  }
}

const parseId = id => {
  const match = /^(\\\\\.\\DISPLAY\d{1,2})#(\d)$/.exec(String(id || ''))
  return match ? { device: match[1], index: Number(match[2]) } : null
}
const validInput = value => Number.isInteger(value) && value > 0 && value < 256

function createMonitorInput({ run }) {
  // run(script) resolves the PowerShell's stdout.
  async function list() {
    const out = await run(`${DDC_TYPES}\n[Console]::Out.Write([PrgDdc]::List())`)
    let raw
    try { raw = JSON.parse(String(out).trim() || '[]') } catch { return [] }
    return (Array.isArray(raw) ? raw : []).map(cleanMonitor).filter(Boolean)
  }
  async function setInput(id, value) {
    const target = parseId(id)
    if (!target || !validInput(value)) return { ok: false, code: 'invalid' }
    const out = String(await run(`${DDC_TYPES}\n[Console]::Out.Write([PrgDdc]::Set('${target.device}', ${target.index}, ${value}))`)).trim()
    return out === 'ok' ? { ok: true } : { ok: false, code: out === 'refused' ? 'refused' : 'not-found' }
  }
  // Which input the monitor shows now: { ok, input } — one quick read, so a
  // toggle follows the monitor even after its own buttons were used.
  async function getInput(id) {
    const target = parseId(id)
    if (!target) return { ok: false, code: 'invalid' }
    const out = String(await run(`${DDC_TYPES}\n[Console]::Out.Write([PrgDdc]::Input('${target.device}', ${target.index}))`)).trim()
    const value = Number(out)
    if (/^\d{1,3}$/.test(out) && validInput(value)) return { ok: true, input: value }
    return { ok: false, code: out === 'not-found' ? 'not-found' : 'no-answer' }
  }
  return { list, setInput, getInput }
}

// Runs one script in a hidden PowerShell and resolves its output.
function powershellRunner({ execFile, timeout = 20000 }) {
  return script => new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

// Saved choice: which monitor, which input the console is on, and which
// input the PC was on before the last switch.
function sanitizeConfig(value) {
  const config = value && typeof value === 'object' ? value : {}
  return {
    monitorId: parseId(config.monitorId) ? String(config.monitorId) : null,
    monitorName: typeof config.monitorName === 'string' ? config.monitorName.slice(0, 64) : '',
    consoleInput: validInput(config.consoleInput) ? config.consoleInput : 0x11,
    pcInput: validInput(config.pcInput) ? config.pcInput : null,
    onConsole: config.onConsole === true,
  }
}

// Where "back to the PC" goes: the input the PC was on before the last
// switch, else DisplayPort 1 if the monitor has it, else its first other input.
function pcInputFor({ pcInput, consoleInput, options = [] }) {
  if (validInput(pcInput) && pcInput !== consoleInput) return pcInput
  const values = options.map(option => option.value).filter(value => validInput(value) && value !== consoleInput)
  if (values.includes(0x0F)) return 0x0F
  return values[0] || (consoleInput === 0x0F ? null : 0x0F)
}

module.exports = { createMonitorInput, powershellRunner, parseInputOptions, cleanMonitor, sanitizeConfig, inputName, parseId, pcInputFor, DDC_TYPES }
