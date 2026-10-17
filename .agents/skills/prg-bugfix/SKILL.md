---
name: prg-bugfix
description: Diagnose and fix a PRGLauncher defect when the user reports broken behavior, a regression, a screenshot, or a runtime error. Not for feature planning or general code review.
---

# PRGLauncher bugfix

Trace the observed behavior through the relevant Electron process, UI module, and tests before changing code. Record the concrete failing state and distinguish confirmed causes from hypotheses.

- Preserve unrelated worktree changes and saved game/profile data.
- Prefer the smallest behaviorally complete fix. Add a focused regression test when the failure can be reproduced deterministically.
- For UI defects, verify the failing interaction in the running app when possible. If only static or unit verification is available, explicitly say so.
- Check adjacent edge cases implicated by the cause, especially account switching, offline/retry, game-card scrolling, Steam install/launch, and long game titles.
- End with the root cause, changed behavior, test results, and any remaining manual check in plain language.
