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
      const wrapper = documentRef.createElement('div');
      wrapper.className = `ui-state ui-state-${['loading', 'error', 'empty', 'success'].includes(state) ? state : 'empty'}`;
      const symbol = documentRef.createElement('span');
      symbol.className = 'ui-state-icon';
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = icon;
      const heading = documentRef.createElement('strong');
      heading.textContent = safeTitle;
      wrapper.append(symbol, heading);
      if (safeDetail) { const description = documentRef.createElement('small'); description.textContent = safeDetail; wrapper.appendChild(description); }
      container.replaceChildren(wrapper);
      container.dataset.state = state;
    }

    return { announce, setBusy, renderState };
  }

  global.createFeedbackUi = createFeedbackUi;
})(window);
