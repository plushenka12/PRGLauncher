# Firebase rules testing

The repository now contains deterministic fixtures in `tests/fixtures/` and a
rules contract test in `tests/firestore-rules-contract.test.cjs`. The regular
test command runs these checks without network access.

For a full Firestore Emulator run on a development machine or CI worker:

1. Use the repository's Firebase CLI and Java 21 or newer. Run
   `npx.cmd firebase emulators:start --only firestore --project demo-prglauncher`.
2. Run `npm run test:emulator` in a second terminal.
3. The suite checks that only the configured owner UID can access its private
   `users/{uid}/**` records; another authenticated user is denied. The owner's
   published `public-dashboard/{uid}` is readable anonymously, but not writable
   by another user. `gamevault/**` remains closed.
4. The two-client test uses independent authenticated Firestore contexts and
   demo games. It checks migration, offline pending edits, independent sessions,
   an idempotent retry, and a conflicting status edit.

With the emulator running on the standard port, Windows can run the real rule
test directly:

```text
npm run test:emulator
```

The regular `npm test` command skips emulator tests when the emulator is not
running. Passing emulator tests does not replace the two-PC manual check in
[WINDOWS_TEST_CHECKLIST.md](WINDOWS_TEST_CHECKLIST.md).

The launcher never relies on emulator behavior in production; this document is
the release checklist for validating `firestore.rules` before deployment.
The Windows CI and release workflows include this emulator run, but a successful
GitHub Actions execution of the new step has not yet been confirmed.
