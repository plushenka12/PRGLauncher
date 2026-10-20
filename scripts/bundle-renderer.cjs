const path = require('node:path');
const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'firebase-entry.js')],
  outfile: path.join(__dirname, '..', 'src', 'renderer', 'firebase-bundle.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  logLevel: 'info'
});
