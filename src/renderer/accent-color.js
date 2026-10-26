// The accent colour of a game: the most vivid colours of its art, averaged
// and brought to a lightness that reads on the dark UI. Used by the main
// process for local Steam art and by the renderer for other covers.
(function exposeAccentColor(root) {
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToHex(h, s, l) {
    const hue = t => {
      t = (t + 1) % 1;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return '#' + [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
  }

  // pixels: RGBA (or BGRA with bgra = true) bytes. Returns '#rrggbb' or null
  // for art with no real colour (greyscale, almost black).
  function pickAccent(pixels, { bgra = false } = {}) {
    const scored = [];
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const r = pixels[bgra ? i + 2 : i], g = pixels[i + 1], b = pixels[bgra ? i : i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const vivid = s * (1 - Math.abs(l - 0.5) * 2);
      if (vivid > 0.12) scored.push({ h, s, vivid });
    }
    if (scored.length < 4) return null;
    scored.sort((a, b) => b.vivid - a.vivid);
    const top = scored.slice(0, Math.max(4, Math.round(scored.length * 0.2)));
    // Hue is circular, so it is averaged as an angle.
    let x = 0, y = 0, saturation = 0;
    for (const item of top) { x += Math.cos(item.h * 2 * Math.PI) * item.vivid; y += Math.sin(item.h * 2 * Math.PI) * item.vivid; saturation += item.s; }
    const hue = ((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1;
    return hslToHex(hue, Math.min(0.9, Math.max(0.5, saturation / top.length)), 0.6);
  }

  const api = { pickAccent, rgbToHsl, hslToHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PRGAccent = api;
})(typeof window !== 'undefined' ? window : globalThis);
