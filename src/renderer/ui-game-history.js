// History timeline renderer. Event shaping remains in the renderer because it
// knows the library schema; this module only renders already-shaped events.
(function exposeGameHistoryUi(global) {
  function renderGameHistory(events, options) {
    const { list, emptyText, formatEvent, formatDate } = options;
    if (!list) return;
    if (!events.length) {
      list.innerHTML = `<div class="history-item"><div class="history-item-title">${emptyText}</div></div>`;
      return;
    }
    list.innerHTML = events.map(event => `<div class="history-item"><div class="history-item-title">${formatEvent(event)}</div><div class="history-item-time">${formatDate(event.at)}</div></div>`).join('');
  }
  global.createGameHistoryUi = () => ({ renderGameHistory });
})(window);
