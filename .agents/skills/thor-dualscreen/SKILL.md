---
name: thor-dualscreen
description: Plan, prototype, implement, or test PRGLauncher for the AYN Thor dual-screen Android handheld. Not for ordinary Electron or generic phone UI tasks.
---

# AYN Thor dual-screen Android

Use `AYN_THOR_DESIGN.md` and `design/ayn-thor/` as visual starting points, not as proof of platform behavior. Keep Android implementation separate from Electron UI; share only deliberate domain contracts such as game identity, sessions, and sync semantics.

- Design upper and lower screens as distinct surfaces with a meaningful single-screen fallback. Avoid controls across the hinge or dependence on an emulator-specific display assumption.
- Account for touch and built-in gamepad focus/navigation, orientation or screen-state changes, app background/resume, and offline usage.
- Verify display/window APIs against current official Android guidance before implementation. Record what is simulator-tested versus tested on a physical AYN Thor.
- Do not promise emulator playtime/session tracking until each emulator's observable integration path and permissions have been validated.
