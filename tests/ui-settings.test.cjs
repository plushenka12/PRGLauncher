const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const classes = initial => {
    const values = new Set(initial);
    return {
      contains: value => values.has(value),
      add: value => values.add(value),
      remove: value => values.delete(value),
      toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
    };
  };
  const document = { activeElement: null };
  const tabs = ['general', 'appearance', 'integrations', 'data'].map(name => ({
    dataset: { settingsTab: name }, classList: classes([]), attributes: {}, tabIndex: 0,
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() { document.activeElement = this; },
  }));
  const panes = tabs.map(tab => ({ dataset: { settingsPane: tab.dataset.settingsTab }, classList: classes([]), hidden: false, scrollTop: 50 }));
  const integrations = ['steam', 'nintendo', 'gog', 'backloggd'].map(name => ({ id: `integration-${name}`, open: false }));
  const dialog = { scrollTop: 10, focus() { document.activeElement = this; } };
  const overlay = { classList: classes(['hidden']), scrollTop: 10, querySelector: () => dialog };
  document.querySelectorAll = selector => selector === '.settings-tab' ? tabs : selector === '.settings-pane' ? panes : integrations;
  document.querySelector = selector => tabs.find(tab => selector.includes(tab.dataset.settingsTab));
  document.getElementById = id => integrations.find(item => item.id === id) || overlay;
  const opener = { isConnected: true, focus() { document.activeElement = this; } };
  document.activeElement = opener;
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const window = { requestAnimationFrame: callback => callback() };
  vm.runInNewContext(fs.readFileSync('src/renderer/ui-settings.js', 'utf8'), { window, document });
  return { ui: window.createSettingsUi({ storage }), tabs, panes, integrations, overlay, dialog, document, opener };
}

test('settings tabs expose one selected panel and support arrow keys', () => {
  const { ui, tabs, panes, document } = fixture();
  ui.setTab('general');
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal(tabs[1].tabIndex, -1);
  assert.equal(panes[1].hidden, true);
  ui.onTabKeydown({ key: 'ArrowRight', currentTarget: tabs[0], preventDefault() {} });
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(panes[1].hidden, false);
  assert.equal(panes[1].scrollTop, 0);
  assert.equal(document.activeElement, tabs[1]);
});

test('opening a source shows only its integration controls', () => {
  const { ui, integrations } = fixture();
  ui.openIntegration('steam');
  assert.deepEqual(integrations.map(item => item.open), [true, false, false, false]);
  ui.openIntegration('nintendo');
  assert.deepEqual(integrations.map(item => item.open), [false, true, false, false]);
});

test('closing settings returns focus to its opener', () => {
  const { ui, overlay, dialog, document, opener } = fixture();
  ui.open();
  assert.equal(document.activeElement, dialog);
  assert.equal(overlay.classList.contains('hidden'), false);
  ui.close();
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(document.activeElement, opener);
});
