# Main-process guidance

- Keep native process, filesystem, window, OAuth, tray, and updater operations in the main process; expose only task-specific IPC through preload.
- Validate IPC senders and arguments, including executable paths and external URLs. Do not hand the renderer generic filesystem, shell, or process-control access.
- Verify Steam launch/install behavior independently: an install dialog must remain usable, and hiding Steam must not steal focus before download starts.
- Update shutdown, tray, mini-bar, and active-timer behavior together when changing the updater lifecycle. Never silently discard pending local sync data.
