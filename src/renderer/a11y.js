// Small accessibility helpers shared by the renderer.
(function exposeA11y(global) {
  function createA11yUi(documentRef = document) {
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKeydown = event => {
      if (event.key !== 'Tab') return;
      const dialog = [...documentRef.querySelectorAll('.modal-overlay:not(.hidden) .modal, #login-overlay[style*="flex"] .login-box')].at(-1);
      if (!dialog) return;
      const nodes = [...dialog.querySelectorAll(focusableSelector)].filter(node => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    documentRef.addEventListener('keydown', onKeydown);
    return {
      destroy() { documentRef.removeEventListener('keydown', onKeydown); }
    };
  }

  global.createA11yUi = createA11yUi;
})(window);
