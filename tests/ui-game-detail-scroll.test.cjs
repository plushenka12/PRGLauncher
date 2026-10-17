const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'ui-game-detail.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const { scrollWheel } = sandbox.window.createGameDetailUi();

function wheel(deltaY, deltaMode = 0) {
  return { deltaY, deltaMode, prevented: false, preventDefault() { this.prevented = true; } };
}

function overlay(body, height = 600, contentHeight = 600, hidden = false) {
  return {
    classList: { contains: value => value === 'hidden' && hidden },
    querySelector: () => body,
    clientHeight: height,
    scrollHeight: contentHeight,
    scrollTop: 0,
  };
}

test('wheel scrolls game-card body even when cursor is over its cover', () => {
  const body = { clientHeight: 300, scrollHeight: 900, scrollTop: 0 };
  const card = overlay(body);
  const event = wheel(120);
  scrollWheel(event, card);
  assert.equal(body.scrollTop, 120);
  assert.equal(event.prevented, true);
});

test('wheel falls back to the outer card when body itself does not overflow', () => {
  const body = { clientHeight: 300, scrollHeight: 300, scrollTop: 0 };
  const card = overlay(body, 600, 1000);
  const event = wheel(3, 1);
  scrollWheel(event, card);
  assert.equal(card.scrollTop, 48);
  assert.equal(event.prevented, true);
});

test('wheel stops at the card boundaries without scrolling the library behind it', () => {
  const body = { clientHeight: 300, scrollHeight: 900, scrollTop: 580 };
  const card = overlay(body);
  const event = wheel(120);
  scrollWheel(event, card);
  assert.equal(body.scrollTop, 600);
  assert.equal(event.prevented, true);
});

test('wheel does not block native scrolling when card has nowhere to scroll', () => {
  const body = { clientHeight: 300, scrollHeight: 300, scrollTop: 0 };
  const card = overlay(body);
  const event = wheel(120);
  scrollWheel(event, card);
  assert.equal(event.prevented, false);
  assert.equal(body.scrollTop, 0);
});

test('wheel ignores a closed card', () => {
  const body = { clientHeight: 300, scrollHeight: 900, scrollTop: 0 };
  const card = overlay(body, 600, 600, true);
  const event = wheel(120);
  scrollWheel(event, card);
  assert.equal(event.prevented, false);
  assert.equal(body.scrollTop, 0);
});
