// Small, bounded timing summary for diagnostics. It never records game names,
// document IDs, account details, URLs or raw library data.
(function exposePerfMetrics(global) {
  const names = new Set(['initialReady', 'cachedLibraryRestore', 'gridRender', 'cloudLibraryRead', 'statsRender']);
  const rounded = value => Math.round(value * 10) / 10;

  function createPerfMetrics(clock = global.performance) {
    const measures = Object.create(null);
    function record(name, duration, itemCount) {
      if (!names.has(name) || !Number.isFinite(duration) || duration < 0) return;
      const previous = measures[name] || { count: 0, totalMs: 0, maxMs: 0 };
      previous.count++;
      previous.totalMs += duration;
      previous.maxMs = Math.max(previous.maxMs, duration);
      previous.lastMs = duration;
      if (Number.isInteger(itemCount) && itemCount >= 0) previous.lastItems = itemCount;
      measures[name] = previous;
    }
    function start(name) {
      const started = clock.now();
      return itemCount => record(name, clock.now() - started, itemCount);
    }
    function snapshot() {
      return { schemaVersion: 1, measures: Object.fromEntries(Object.entries(measures).map(([name, value]) => [name, {
        count: value.count, lastMs: rounded(value.lastMs), averageMs: rounded(value.totalMs / value.count),
        maxMs: rounded(value.maxMs), ...(value.lastItems === undefined ? {} : { lastItems: value.lastItems })
      }])) };
    }
    return { record, start, snapshot };
  }

  global.createPerfMetrics = createPerfMetrics;
})(window);
