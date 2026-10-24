const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

require('../src/renderer/ui-library-grid.js');
const { createLibraryGrid } = globalThis;

// Just enough of the DOM for the grid: ordered children, insertBefore, remove.
class FakeNode {
  constructor(label) {
    this.label = label;
    this.parentNode = null;
    this.children = [];
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
    this.listeners = {};
  }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  insertBefore(node, ref) {
    node.remove();
    const index = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    this.inserts = (this.inserts || 0) + 1;
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}

function setup() {
  const built = [];
  const prepared = [];
  const grid = new FakeNode('grid');
  const library = createLibraryGrid({
    signature: game => `${game.title}|${game.status}`,
    createCard: game => { const card = new FakeNode(game.id); built.push(game.id); return card; },
    prepareCard: card => prepared.push(card.label),
  });
  const render = (list, ids) => library.render(grid, list, ids && new Set(ids));
  const order = () => grid.children.map(node => node.label);
  return { grid, library, render, order, built, prepared };
}

const games = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id.toUpperCase(), status: 'Backlog' }));

test('first render builds every card once and marks them as entering', () => {
  const { render, order, built, prepared, grid } = setup();
  assert.deepEqual(render(games), { created: 4, reused: 0, moved: 0, removed: 0 });
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(built, ['a', 'b', 'c', 'd']);
  assert.deepEqual(prepared, ['a', 'b', 'c', 'd'], 'new cards are translated once');
  assert.ok(grid.children.every(card => card.classList.contains('is-entering')));
  grid.children[0].listeners.animationend();
  assert.equal(grid.children[0].classList.contains('is-entering'), false);
});

test('an unchanged re-render touches no cards', () => {
  const { render, grid, built } = setup();
  render(games);
  grid.inserts = 0;
  assert.deepEqual(render(games.map(game => ({ ...game }))), { created: 0, reused: 4, moved: 0, removed: 0 });
  assert.equal(grid.inserts, 0);
  assert.equal(built.length, 4);
});

test('a changed game rebuilds only its own card in place', () => {
  const { render, order, grid, built } = setup();
  render(games);
  const untouched = grid.children[2];
  grid.inserts = 0;
  const next = games.map(game => (game.id === 'b' ? { ...game, status: 'Playing' } : game));
  assert.deepEqual(render(next), { created: 1, reused: 3, moved: 0, removed: 1 });
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
  assert.equal(grid.children[2], untouched);
  assert.equal(grid.inserts, 1, 'only the rebuilt card is inserted');
  assert.deepEqual(built.slice(4), ['b']);
});

test('filtering removes cards and restoring the filter reuses them', () => {
  const { render, order, built } = setup();
  render(games);
  assert.deepEqual(render([games[1], games[3]]), { created: 0, reused: 2, moved: 0, removed: 2 });
  assert.deepEqual(order(), ['b', 'd']);
  assert.deepEqual(render(games), { created: 0, reused: 4, moved: 0, removed: 0 });
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
  assert.equal(built.length, 4);
});

test('sorting reorders existing cards without rebuilding them', () => {
  const { render, order, built } = setup();
  render(games);
  const stats = render([...games].reverse());
  assert.equal(stats.created, 0);
  assert.equal(stats.reused, 4);
  assert.deepEqual(order(), ['d', 'c', 'b', 'a']);
  assert.equal(built.length, 4);
});

test('empty-state markup is replaced and duplicate ids still render', () => {
  const { render, order, grid } = setup();
  grid.appendChild(new FakeNode('empty-state'));
  render([games[0], games[0], games[1]]);
  assert.deepEqual(order(), ['a', 'a', 'b']);
  assert.notEqual(grid.children[0], grid.children[1]);
});

test('deleted games are evicted from the cache', () => {
  const { render, library } = setup();
  render(games, games.map(game => game.id));
  assert.equal(library.size(), 4);
  render([games[0]], ['a']);
  assert.equal(library.size(), 1);
});

test('renderer wires the keyed grid and a card signature covering what a card shows', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const grid = html.slice(html.indexOf('function renderGrid()'), html.indexOf('function resetLibraryFilters()'));
  assert.match(grid, /libraryGrid\.render\(grid,list,new Set\(games\.map\(game=>game\.id\)\)\)/);
  assert.doesNotMatch(grid, /grid\.innerHTML=''/);
  const signature = html.slice(html.indexOf('function gameCardSignature(game)'), html.indexOf('\n}', html.indexOf('function gameCardSignature(game)')));
  for (const field of ['currentLanguage', 'activeGameId', 'game.title', 'game.cover', 'game.status', 'game.platform', 'game.rating', 'game.playtime', 'game.sessions', 'game.steamAppId', 'game.gogGameId']) {
    assert.ok(signature.includes(field), field);
  }
  const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
  assert.match(css, /\.game-card\.is-entering\{animation:cardIn/);
  assert.doesNotMatch(css, /\.game-card\{[^}]*animation:cardIn/);
});
