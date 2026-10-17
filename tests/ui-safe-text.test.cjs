const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element() {
  return {
    children: [], dataset: {}, attributes: {}, textContent: '',
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
}

test('history renders game-supplied text without HTML parsing', () => {
  const document = { createElement: element };
  const window = {};
  vm.runInNewContext(fs.readFileSync('src/renderer/ui-game-history.js', 'utf8'), { window, document });
  const list = element();
  const malicious = '<img src=x onerror=alert(1)>';
  window.createGameHistoryUi().renderGameHistory([{ at: 1 }], {
    list, emptyText: '', formatEvent: () => malicious, formatDate: () => 'today',
  });
  assert.equal(list.children[0].children[0].textContent, malicious);
  assert.equal(list.children[0].innerHTML, undefined);
});

test('feedback renders API error text without HTML parsing', () => {
  const document = { createElement: element };
  const window = {};
  vm.runInNewContext(fs.readFileSync('src/renderer/ui-feedback.js', 'utf8'), { window, document });
  const container = element();
  const malicious = '<svg onload=alert(1)>';
  window.createFeedbackUi(document).renderState(container, 'error', { title: malicious, detail: malicious });
  assert.equal(container.children[0].children[1].textContent, malicious);
  assert.equal(container.children[0].children[2].textContent, malicious);
  assert.equal(container.innerHTML, undefined);
});
