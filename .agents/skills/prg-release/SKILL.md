---
name: prg-release
description: Prepare or verify a PRGLauncher version, Windows installer, changelog, GitHub release, or auto-update path when the user asks for release work. Not for ordinary feature edits.
---

# PRGLauncher release

Treat building, tagging, pushing, and publishing as distinct actions. Carry out only the release actions the user requested.

- Compare `package.json`, lockfile, changelog, tag, workflow inputs, artifact names, and update metadata before claiming a version is ready.
- Run `npm ci` when validating a clean install, `npm test`, and `npm run release:check`; build the Windows installer if the task requires it. Report any check that cannot run.
- Generate release notes from changes since the last production release, not a copied older release body. Do not advertise untested or unreleased features.
- Confirm the installer and auto-update assets match the tag. A successful build is not proof that updates work on an installed copy; include a manual upgrade check.
- Never create a tag, push, publish, deploy, or replace release assets without explicit authorization.
