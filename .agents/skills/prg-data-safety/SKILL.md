---
name: prg-data-safety
description: Change or audit PRGLauncher profiles, game/session schemas, Firebase sync, import merging, backup/restore, account isolation, or public recap data. Not for unrelated UI styling.
---

# PRGLauncher data safety

Read `ARCHITECTURE.md`, the affected canonical-model/sync modules, and `firestore.rules`; trust current code over dated prose. Identify which data is local, private cloud, or opt-in public before editing.

- Preserve per-UID isolation and backward compatibility with existing snapshots. Never silently replace a populated library with an empty or stale copy.
- Treat imports and upstream playtime as separate from tracked sessions unless the model explicitly merges them. Guard against duplicate sessions and non-idempotent retries.
- Use demo IDs and scrubbed fixtures. Do not inspect or export real private account data unless the user asks and the task requires it.
- Cover positive, conflict, offline/retry, and cross-account denial cases as relevant. Run focused tests and Firestore emulator tests when available; report when the emulator was not run.
- Explain migration or rollback implications before a destructive schema change.
