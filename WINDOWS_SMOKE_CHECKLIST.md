# Windows smoke checklist

- Install the generated setup executable over an existing PRGLauncher profile.
- Sign in with account A; verify only account A's library and Steam profile appear.
- Sign out, sign in with account B; verify no games, Steam URL or Nintendo state leaks from A.
- Add one Steam game, edit its status, start/stop a session and relaunch the app.
- Disconnect/reconnect the network while a sync is pending; verify the sync badge and retry.
- Open Game Info, switch Overview/History, edit notes/time and confirm the card remains visible.
- Export and import a backup; verify sessions, settings and ignored Nintendo ids survive.
- Open the public report and confirm Recap updates after a new session.
- Check updater: download an available build and verify PRGLauncher closes before installation.
