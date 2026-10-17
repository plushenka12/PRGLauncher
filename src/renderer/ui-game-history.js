// History timeline renderer. Event shaping remains in the renderer because it
// knows the library schema; this module only renders already-shaped events.
(function exposeGameHistoryUi(global) {
  function renderGameHistory(events, options) {
    const { list, emptyText, formatEvent, formatDate } = options;
    if (!list) return;
    const makeItem = (titleText, timeText) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = titleText;
      item.appendChild(title);
      if (timeText) {
        const time = document.createElement('div');
        time.className = 'history-item-time';
        time.textContent = timeText;
        item.appendChild(time);
      }
      return item;
    };
    if (!events.length) {
      list.replaceChildren(makeItem(emptyText));
      return;
    }
    list.replaceChildren(...events.map(event => makeItem(formatEvent(event), formatDate(event.at))));
  }
  global.createGameHistoryUi = () => ({ renderGameHistory });
})(window);
