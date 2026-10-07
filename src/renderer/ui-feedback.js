// Non-intrusive feedback for users and assistive technologies.
(function exposeFeedback(global) {
  function createFeedbackUi(documentRef = document) {
    function announce(message, options = {}) {
      const region = documentRef.getElementById('app-live-region');
      if (!region) return;
      region.dataset.kind = options.kind || 'status';
      region.textContent = '';
      requestAnimationFrame(() => { region.textContent = String(message || ''); });
    }

    function setBusy(element, busy, label) {
      if (!element) return;
      element.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (label) element.setAttribute('aria-label', label);
      if ('disabled' in element) element.disabled = Boolean(busy);
    }

    function renderState(container, state, { title, detail = '', icon = '✦' } = {}) {
      if (!container) return;
      const safeTitle = String(title || (state === 'loading' ? 'Завантаження…' : state === 'error' ? 'Щось пішло не так' : 'Поки порожньо'));
      const safeDetail = String(detail || '');
      container.innerHTML = `<div class="ui-state ui-state-${state}"><span class="ui-state-icon" aria-hidden="true">${icon}</span><strong>${safeTitle}</strong>${safeDetail ? `<small>${safeDetail}</small>` : ''}</div>`;
      container.dataset.state = state;
    }

    return { announce, setBusy, renderState };
  }

  global.createFeedbackUi = createFeedbackUi;
})(window);
