---
name: prg-ui-check
description: Design, implement, or verify PRGLauncher Electron UI changes to game cards, detail panels, modals, settings, statistics, or navigation. Not for backend-only changes.
---

# PRGLauncher UI check

Use the existing design and requested direction as the baseline. Preserve deliberate interactions instead of redesigning adjacent screens without authorization.

- Inspect the actual rendered state when possible, not just CSS selectors. Check hover, focus, modal open/close, wheel scrolling, and keyboard actions.
- Include long game names, missing or unusually shaped covers, empty data, Ukrainian/English copy, and 90%, 100%, and 120% scale in the relevant verification matrix.
- Avoid layout shifts and clipped controls. A polished static screenshot does not prove interaction works.
- Reuse established tokens/components where appropriate. If the task calls for a broader visual redesign, use the available `impeccable` skill; do not require it for small UI fixes.
- Show the result or describe the exact screen and state verified; separate visual checks from automated tests.
