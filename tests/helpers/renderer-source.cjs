const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', '..', 'src', 'renderer');

// The launcher page and its main script as one text, for contract tests that
// look up functions or markup without caring which file holds them.
function rendererSource() {
  return `${fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')}\n${fs.readFileSync(path.join(renderer, 'app.js'), 'utf8')}`;
}

module.exports = { rendererSource };
