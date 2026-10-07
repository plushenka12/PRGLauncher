const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const checks = [
  ['package version', Boolean(/^\d+\.\d+\.\d+$/.test(version))],
  ['main entry', fs.existsSync(path.join(root, pkg.main))],
  ['Windows installer', fs.existsSync(path.join(root, 'release', `PRGLauncher-Setup-${version}.exe`))],
  ['Windows blockmap', fs.existsSync(path.join(root, 'release', `PRGLauncher-Setup-${version}.exe.blockmap`))],
  ['macOS tester guide', fs.existsSync(path.join(root, 'MACOS_TESTER_GUIDE.md'))],
  ['Windows smoke checklist', fs.existsSync(path.join(root, 'WINDOWS_SMOKE_CHECKLIST.md'))],
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✔' : '✖'} ${label}`)
  if (!ok) failed++
}
if (failed) process.exitCode = 1
else console.log(`Release gate passed for PRGLauncher ${version}`)
