# PRGLauncher technical debt register

Audit baseline: 3 October 2026. Priorities describe engineering risk, not user-facing severity.

## High priority

### TD-001 — Monolithic renderer

`src/renderer/index.html` is roughly 343 KB and mixes markup, styles, state, persistence, integrations and event handlers. Changes are hard to review and regressions are easy to introduce. Extract pure utilities, then store/sync services, then platform adapters and UI components without changing the product contract.

### TD-002 — Whole-snapshot cloud writes

The profile/library snapshot at `users/{uid}/profile/library` is convenient but can overwrite another device's edits. Schema v3 now separates profile/integrations/session data inside a backward-compatible payload; the remaining work is moving to per-game/session documents with revision metadata.

### TD-003 — Thin automated test coverage

There is a Steam-library test but no project test script and no renderer/state/integration fixtures. Add deterministic tests for migrations, merge/conflict resolution, HLTB matching, recap aggregation and platform import normalization.

### TD-004 — Rules deployment is manual

Firestore rules exist locally but deployment and emulator verification are not part of the release gate. Add Firebase Emulator/Rules Playground checks and a documented deploy command before production changes.

### TD-005 — HLTB is an external dependency

HLTB availability, token capture and site changes can break enrichment. Keep the adapter isolated, cache successful matches, support manual URLs and test retry/backoff behavior with fixtures.

## Medium priority

- TD-006 — Inline CSS and HTML strings make visual changes risky; move styles and new templates into dedicated modules.
- TD-007 — Schema migrations are now explicit in schema v3; keep adding ordered migrations whenever the canonical model changes.
- TD-008 — Alerts and console errors are scattered; centralize notifications, logging and user-safe error messages.
- TD-009 — Platform-specific behavior is mixed into generic flows; introduce Steam, Nintendo and local-launch adapters behind one interface.
- TD-010 — Version/tag/artifact drift is possible; CI should assert package version, tag and published artifact names agree.
- TD-011 — No Firebase emulator fixture set exists; add seeded private/public documents and rules tests.

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

## Suggested order

1. Renderer extraction with no behavior change (TD-001).
2. Schema version plus migration fixtures (TD-007/003).
3. Sync/data model hardening (TD-002/004/011).
4. Integration adapters and HLTB resilience (TD-005/009).
5. CI/release and accessibility cleanup (TD-010/012/013/014).
