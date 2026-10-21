# PRGLauncher technical debt register

Audit updated 21 October 2026. Priorities describe engineering risk, not user-facing severity. Published version: 1.2.6; newer sync and CI work is not yet released.

## High priority

### TD-001 — Monolithic renderer

`src/renderer/index.html` is roughly 300 KB after its 86 KB stylesheet moved to `styles.css`, but still mixes markup, state and event handlers. Sync/model, integration and UI helpers have been extracted; continue separating remaining state and handlers without changing the product contract.

### TD-002 — Whole-snapshot cloud writes

The released 1.2.6 client writes a whole profile/library snapshot. Unreleased code migrates to per-game and per-session documents and passed unit and two-client Emulator tests. Remaining risk: manual two-PC/offline/conflict checks and release review before this can replace the released sync path.

### TD-003 — UI and real-device coverage

The Node suite covers migrations, merge/conflicts, HLTB matching, Recap and platform normalization. Firestore Emulator covers owner rules and two isolated clients. Visual Electron checks and a real two-PC sync run are still manual.

### TD-004 — Rules deployment is manual

Firestore rules are owner-scoped and Emulator tests are added to local scripts and the Windows workflows. Verify the first GitHub Actions run of the new step; rules deployment and live-account validation remain separate, deliberate operations.

### TD-005 — HLTB is an external dependency

HLTB availability, token capture and site changes can break enrichment. Keep the adapter isolated, cache successful matches, support manual URLs and test retry/backoff behavior with fixtures.

## Medium priority

- TD-006 — The main stylesheet is separate, but large HTML templates and inline style attributes still make visual changes risky; extract them incrementally.
- TD-007 — Schema migrations are now explicit in schema v3; keep adding ordered migrations whenever the canonical model changes.
- TD-008 — Alerts and console errors are scattered; centralize notifications, logging and user-safe error messages.
- TD-009 — Platform-specific behavior is mixed into generic flows; introduce Steam, Nintendo and local-launch adapters behind one interface.
- TD-010 — Release workflow checks the tag against `package.json` and runs a release gate; verify artifact/update metadata and a real installed-client upgrade before publishing.
- TD-011 — Firestore fixtures and rules tests exist; keep their owner-only and public-opt-in boundaries current as the schema evolves.

## Low priority

- TD-012 — Localization coverage is not mechanically checked; add missing-key validation for `UI_COPY`.
- TD-013 — Audit focus management, modal traps, live regions and keyboard navigation.
- TD-014 — Plan deliberate Electron/electron-builder dependency upgrades instead of ad-hoc bumps.

## Already addressed in the current baseline

- UID-scoped local storage and Firebase paths.
- Queued sync writes and an explicit cloud/local conflict flow.
- Backup validation and aggregate diagnostics export.
- Public Recap opt-in and deletion.
- Deny-by-default Firestore rules in the repository.
- Windows build and Node syntax checks.
- Unit/contract tests, Firestore Emulator fixtures and a two-client sync test.

## Suggested order

1. Renderer extraction with no behavior change (TD-001).
2. Schema version plus migration fixtures (TD-007/003).
3. Sync/data model hardening (TD-002/004/011).
4. Integration adapters and HLTB resilience (TD-005/009).
5. CI/release and accessibility cleanup (TD-010/012/013/014).
