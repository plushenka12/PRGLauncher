const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'assets', 'icon-256.png'))
const header = Buffer.alloc(8)
header.write('icns')
header.writeUInt32BE(header.length + 8 + source.length, 4)

// `ic08` is the native PNG-backed 256×256 ICNS representation. macOS scales
// it for the dock, window and tray; the source asset remains the single brand
// source of truth for Windows and macOS.
const chunk = Buffer.alloc(8)
chunk.write('ic08')
chunk.writeUInt32BE(chunk.length + source.length, 4)
fs.writeFileSync(path.join(root, 'assets', 'icon.icns'), Buffer.concat([header, chunk, source]))
