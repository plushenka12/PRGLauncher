// Safe, intentionally small Markdown dialect shared by the launcher and guest site.
// Raw HTML and images are never interpreted. Links must be absolute HTTPS URLs.
(function exposeReviewMarkdown(global) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function inline(source, depth = 0) {
    if (depth > 2) return escape(source);
    const pattern = /(`[^`\n]+`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
    let html = '', cursor = 0, match;
    while ((match = pattern.exec(source))) {
      html += escape(source.slice(cursor, match.index));
      if (match[0].startsWith('`')) html += `<code>${escape(match[0].slice(1, -1))}</code>`;
      else if (match[2]) {
        let safeUrl = null;
        try { const url = new URL(match[3]); if (url.protocol === 'https:') safeUrl = url.href; } catch {}
        html += safeUrl ? `<a href="${escape(safeUrl)}" target="_blank" rel="noopener noreferrer">${escape(match[2])}</a>` : escape(match[0]);
      } else if (match[4]) html += `<strong>${inline(match[4], depth + 1)}</strong>`;
      else html += `<em>${inline(match[5], depth + 1)}</em>`;
      cursor = pattern.lastIndex;
    }
    return html + escape(source.slice(cursor));
  }
  function render(markdown) {
    const lines = String(markdown || '').slice(0, 20000).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [], list = [], quote = [], code = [], fenced = false;
    const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
    const flushList = () => { if (list.length) blocks.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`); list = []; };
    const flushQuote = () => { if (quote.length) blocks.push(`<blockquote>${quote.map(item => inline(item)).join('<br>')}</blockquote>`); quote = []; };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        flushParagraph(); flushList(); flushQuote();
        if (fenced) { blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = []; }
        fenced = !fenced; continue;
      }
      if (fenced) { code.push(line); continue; }
      if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); continue; }
      const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const quoted = line.match(/^\s*>\s?(.*)$/);
      if (heading) { flushParagraph(); flushList(); flushQuote(); const level = Math.min(heading[1].length + 2, 5); blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
      else if (bullet) { flushParagraph(); flushQuote(); list.push(bullet[1]); }
      else if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); }
      else { flushList(); flushQuote(); paragraph.push(line.trim()); }
    }
    flushParagraph(); flushList(); flushQuote();
    if (fenced) blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
    return blocks.join('');
  }
  global.PRGReviewMarkdown = { render };
})(typeof window === 'undefined' ? globalThis : window);
