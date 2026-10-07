// Settings modal navigation and focus management.
(function exposeSettingsUi(global) {
  function createSettingsUi({ storage, key = 'gv-settings-tab', requestFrame = global.requestAnimationFrame }) {
    const tabs = ['general', 'appearance', 'integrations', 'data'];
    function setTab(tab) {
      const selected = tabs.includes(tab) ? tab : 'general';
      document.querySelectorAll('.settings-tab').forEach(button => {
        const active = button.dataset.settingsTab === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.settings-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.settingsPane === selected));
      storage.setItem(key, selected);
      return selected;
    }
    function open() {
      setTab(storage.getItem(key) || 'general');
      const overlay = document.getElementById('settings-modal');
      const dialog = overlay.querySelector('.settings-modal');
      overlay.classList.remove('hidden');
      overlay.scrollTop = 0;
      dialog.scrollTop = 0;
      requestFrame(() => { overlay.scrollTop = 0; dialog.scrollTop = 0; dialog.focus({ preventScroll: true }); });
    }
    return { setTab, open };
  }
  global.createSettingsUi = createSettingsUi;
})(window);
