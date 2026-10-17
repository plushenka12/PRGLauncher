# PRGLauncher agent guidance

PRGLauncher is a Windows-first Electron game tracker. Read `ARCHITECTURE.md` for process and data boundaries and `ROADMAP.md` for current priorities, but verify dated claims against the code. macOS production, new launcher integrations, and Android are not part of ordinary Windows tasks unless the user brings them into scope.

## Working agreements

- Preserve user data, existing worktree changes, and backward compatibility of library snapshots. Do not reset, delete, migrate, or overwrite profiles to make a test pass.
- Do not push, tag, publish a release, deploy, or install an update without an explicit request. A request to build or test is not a request to publish.
- Never put API keys, OAuth tokens, Firebase credentials, account exports, or private library payloads in source, fixtures, logs, or answers. Use demo data in tests.
- Keep Electron main/preload, renderer, Firebase, and Netlify responsibilities separate. Treat Steam/Nintendo/HLTB/RAWG responses and imported files as untrusted input.
- Preserve Ukrainian and English UI. When changing user-visible behavior, check both locales and the supported 90–120% scale range.
- For a bug, establish the failing path before editing, verify the exact regression after the fix, and say what was not verified. Prefer a focused test where practical. Do not claim UI success from unit tests alone.
- Run relevant tests for changed behavior. `npm test` covers the Node suite; `npm run test:emulator` requires a running Firestore emulator; `npm run release:check` is a release gate. Report skipped environment-dependent checks clearly.
- Keep `README.md`, `CHANGELOG.md`, `ROADMAP.md`, checklists, and version references consistent with actual behavior. Do not turn a planned feature into a completed claim.

## Code review rules

- Flag changes that can cross PRG Account boundaries, duplicate or lose sessions/playtime, expose privileged IPC, or publish private data in the public recap.
- Flag release workflows that can publish an installer without tests, a matching version, or accurate release notes.
