// Shared import-modal shell helpers. Fetching and mapping remain in the
// renderer; this module only handles modal visibility and initial UI state.
(function exposeImportModalUi(global) {
  function createImportModalUi({ translate }) {
    function hideSettings() { document.getElementById('settings-modal')?.classList.add('hidden'); }
    function showSteam() {
      const modal = document.getElementById('backlog-import-modal');
      const list = document.getElementById('backlog-import-list');
      const add = document.getElementById('backlog-import-add');
      modal.classList.remove('hidden');
      add.disabled = true;
      list.textContent = translate('Читаємо Steam…');
      return { modal, list, add };
    }
    function showBackloggd(profileUrl) {
      const modal = document.getElementById('backloggd-import-modal');
      const sourceInput = document.getElementById('backloggd-profile-url');
      const urlInput = document.getElementById('backloggd-import-url');
      urlInput.value = profileUrl || sourceInput.value.trim();
      hideSettings();
      modal.classList.remove('hidden');
      document.getElementById('backloggd-import-status').textContent = translate('Встав URL профілю, щоб почати.');
      document.getElementById('backloggd-import-list').innerHTML = `<div class="sr-msg">${translate('Ще не завантажено.')}</div>`;
      document.getElementById('backloggd-import-add').disabled = true;
      urlInput.focus();
      return { modal, urlInput };
    }
    return { hideSettings, showSteam, showBackloggd };
  }
  global.createImportModalUi = createImportModalUi;
})(window);
