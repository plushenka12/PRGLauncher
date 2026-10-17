const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/renderer/ui-game-detail.js', 'utf8');

function fixture() {
  const document = { activeElement: null };
  const makeFocusable = () => ({
    isConnected: true,
    focus() { document.activeElement = this; },
    getClientRects() { return [1]; },
  });
  const opener = makeFocusable();
  const dialog = makeFocusable();
  const first = makeFocusable();
  const last = makeFocusable();
  let hidden = true;
  const overlay = {
    classList: {
      contains(name) { return name === 'hidden' && hidden; },
      add(name) { if (name === 'hidden') hidden = true; },
      remove(name) { if (name === 'hidden') hidden = false; },
    },
    querySelector(selector) { return selector === '.detail-modal-inner' ? dialog : null; },
    querySelectorAll() { return [first, last]; },
  };
  document.activeElement = opener;
  document.querySelector = () => null;
  const window = { document };
  vm.runInNewContext(source, { window, document });
  return { focus: window.createGameDetailUi().createFocusController(), overlay, document, opener, dialog, first, last };
}

test('game detail focuses its dialog and restores the original opener', () => {
  const { focus, overlay, document, opener, dialog } = fixture();
  focus.open(overlay);
  assert.equal(document.activeElement, dialog);
  focus.open(overlay); // Re-rendering an already-open detail must not replace its opener.
  focus.close(overlay);
  assert.equal(document.activeElement, opener);
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('game detail keeps Tab inside the dialog', () => {
  const { focus, overlay, document, first, last } = fixture();
  focus.open(overlay);
  const event = (shiftKey = false) => ({ key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } });
  first.focus();
  const backward = event(true);
  focus.onKeydown(backward, overlay);
  assert.equal(backward.prevented, true);
  assert.equal(document.activeElement, last);
  const forward = event();
  focus.onKeydown(forward, overlay);
  assert.equal(forward.prevented, true);
  assert.equal(document.activeElement, first);
});

test('game detail preserves the opener while moving through an editor', () => {
  const { focus, overlay, document, opener, dialog } = fixture();
  focus.open(overlay);
  focus.close(overlay, false);
  document.activeElement = { id: 'time-editor' };
  focus.open(overlay);
  assert.equal(document.activeElement, dialog);
  focus.close(overlay);
  assert.equal(document.activeElement, opener);
});

test('game detail falls back to a current card when its opener was re-rendered', () => {
  const { focus, overlay, document, opener, first } = fixture();
  document.querySelector = () => first;
  focus.open(overlay);
  opener.isConnected = false;
  focus.close(overlay);
  assert.equal(document.activeElement, first);
});

test('game detail markup exposes a named dialog and labeled notes field', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.ok(/class="detail-modal-inner"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="d-title"/.test(html));
  assert.ok(/<label[^>]*for="d-notes-input"[^>]*>Notes<\/label>/.test(html));
});
