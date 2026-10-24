# PRGLauncher architecture

Code audit updated 24 October 2026. Windows release target: 1.2.8.

## Product boundary

PRGLauncher is an Electron desktop app. The desktop app owns the library UI, native integrations, timers, imports and local privacy-sensitive state. Firebase stores a per-user profile/library snapshot and an optional public Recap snapshot. The Netlify site is a read-only presentation layer; Steam and RAWG search functions are token-validated proxies.

## Runtime map

```text
Electron main process
  Steam process/filesystem detection and launch
  Nintendo OAuth and encrypted token handling
  HLTB hidden BrowserWindow and HTTPS adapter
  local executable launch
  updater, tray, mini-tab and native windows
  IPC handlers
        |
Electron preload (narrow IPC bridge)
        |
Renderer: src/renderer/index.html
  UI, cards, settings, localization
  localStorage profile cache and timers
  Firebase sync and conflict handling
  Steam/Nintendo/RAWG/HLTB imports
  Recap/statistics and account flows
        |
  Firebase users/{uid}/profile/library
  Firebase public-dashboard/{uid} (opt-in)
        |
  web-dashboard/index.html + Netlify functions
```

## Process responsibilities

### Main process

Only native/platform concerns should live here: process detection, Steam hiding/launching, secure storage, OAuth windows, updater lifecycle, tray and IPC. It should not contain library business rules or renderer markup.

### Preload

The preload exposes a deliberately small, named bridge. It must not expose `ipcRenderer`, arbitrary filesystem access or unrestricted shell execution to the renderer.

### Renderer

The renderer now has a roughly 300 KB HTML entry point containing markup and many state/event handlers. Its roughly 86 KB stylesheet is separate in `src/renderer/styles.css`; pure sync/model, integration and UI helpers are also adjacent modules. The remaining JavaScript in the entry point is still the primary refactoring target.

### Web dashboard and functions

The dashboard reads a public, user-selected Recap snapshot. The working version also projects only reviews explicitly marked public in a separate `publicReviews` field; private notes and the full library remain private. The Steam function validates a Firebase ID token before calling Steam. Public data must remain an explicit opt-in and must never expose the private library by default.

## Data model and sync

Game records currently combine identity, status, platform, playtime, sessions, sources, artwork, HLTB metadata and history. Cloud persistence is a backward-compatible schema-v3 snapshot at `users/{uid}/profile/library`: legacy `games[]` remains available, while canonical `profile`, `integrations` and `sessions{gameId:[]}` fields are written alongside it. The client has a queued write/conflict flow: authenticate, load local/cloud, resolve pending changes, show a conflict modal when needed, debounce writes, retry offline and optionally publish Recap.

The long-term model should keep profile settings separate from games, sessions and integrations. Per-game/session documents will reduce overwrite risk when several devices are active.

The 1.2.7 client can migrate the legacy snapshot (or interim `games-v1` documents) into private `users/{uid}/game-records/{gameId}` and `users/{uid}/session-records/{sessionId}` documents. Only after all writes succeed does the root switch to `storageMode: games-sessions-v1`. The root retains the old game array as a recovery copy, while game metadata and session events are updated transactionally. A stored playtime offset preserves imported/manual time that is not represented by sessions. This migration has not yet been manually checked on two real PCs.

## Security boundaries

- Firestore rules are deny-by-default and scope private data to the authenticated UID.
- Public Recap is opt-in and has an explicit delete path.
- Nintendo credentials stay local and use the platform secure store where available.
- Diagnostics export aggregate information rather than secrets or tokens.
- Steam proxy requests require a valid Firebase ID token. The RAWG proxy requires the owner's token and server-side `RAWG_API_KEY` plus `FIREBASE_WEB_API_KEY` in Netlify.
- Multi-launcher and console integrations outside the current Steam/Nintendo scope remain parked in the distant backlog.

## Target module layout

```text
src/renderer/
  app.js
  state/store.js
  state/profile-storage.js
  services/firebase-sync.js
  services/steam.js
  services/nintendo.js
  services/hltb.js
  services/rawg.js
  services/recap.js
  ui/library.js
  ui/game-card.js
  ui/game-detail.js
  ui/settings.js
  ui/import-modals.js
  i18n.js
  styles/
```

This is an incremental destination, not a rewrite requirement. Extract pure functions first, then state and sync, then integrations and UI. Preserve the current renderer entry point until each slice has tests and visual verification.

## R0 verification

- Node syntax checks for main and preload pass.
- `git diff --check` passes for the audit changes.
- The Windows builder has produced the current installer successfully.
- `npm test` runs unit/contract tests, and `npm run test:emulator` covers Firestore rules and a two-client sync scenario. GitHub Actions execution of the new emulator step remains to be verified.
- macOS behavior still requires the CI artifact or tester hardware.
