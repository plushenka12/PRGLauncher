// Settings modal navigation and focus management.
(function exposeSettingsUi(global) {
  function createSettingsUi({ storage, key = 'gv-settings-tab', requestFrame = global.requestAnimationFrame }) {
    const tabs = ['general', 'appearance', 'integrations', 'data'];
    let returnFocusTo = null;
    function setTab(tab) {
      const selected = tabs.includes(tab) ? tab : 'general';
      document.querySelectorAll('.settings-tab').forEach(button => {
        const active = button.dataset.settingsTab === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll('.settings-pane').forEach(pane => {
        const active = pane.dataset.settingsPane === selected;
        pane.classList.toggle('active', active);
        pane.hidden = !active;
        if (active) pane.scrollTop = 0;
      });
      storage.setItem(key, selected);
      return selected;
    }
    function onTabKeydown(event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const current = tabs.indexOf(event.currentTarget.dataset.settingsTab);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      setTab(tabs[index]);
      document.querySelector(`.settings-tab[data-settings-tab="${tabs[index]}"]`)?.focus();
    }
    function openIntegration(source) {
      const target = document.getElementById(`integration-${source}`);
      if (!target || !['steam', 'nintendo', 'gog', 'backloggd'].includes(source)) return;
      document.querySelectorAll('.integration-item').forEach(item => { item.open = item === target; });
    }
    function open() {
      if (document.getElementById('settings-modal').classList.contains('hidden')) returnFocusTo = document.activeElement;
      setTab(storage.getItem(key) || 'general');
      const overlay = document.getElementById('settings-modal');
      const dialog = overlay.querySelector('.settings-modal');
      overlay.classList.remove('hidden');
      overlay.scrollTop = 0;
      dialog.scrollTop = 0;
      requestFrame(() => { overlay.scrollTop = 0; dialog.scrollTop = 0; dialog.focus({ preventScroll: true }); });
    }
    function close() {
      document.getElementById('settings-modal').classList.add('hidden');
      const target = returnFocusTo;
      returnFocusTo = null;
      requestFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); });
    }
    return { setTab, open, close, onTabKeydown, openIntegration };
  }
  global.createSettingsUi = createSettingsUi;
})(window);
