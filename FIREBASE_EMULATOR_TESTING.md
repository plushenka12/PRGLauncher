# Firebase rules testing

The repository now contains deterministic fixtures in `tests/fixtures/` and a
rules contract test in `tests/firestore-rules-contract.test.cjs`. The regular
test command runs these checks without network access.

For a full Firestore Emulator run on a development machine or CI worker:

1. Install the Firebase CLI and run `firebase emulators:start --only firestore`.
2. Run the rules-unit tests against the emulator with authenticated contexts
   for `user-a` and `user-b`.
3. Verify that `user-a` can read/write `users/user-a/**`, `user-b` cannot read it,
   anyone can read `public-dashboard/user-a`, and only `user-a` can write it.
4. Verify that `gamevault/**` and all unmatched paths reject reads and writes.

With the emulator running on the standard port, Windows can run the real rule
test directly:

```text
npm run test:emulator
```

The regular `npm test` command skips this test when the emulator is not running.

The launcher never relies on emulator behavior in production; this document is
the release checklist for validating `firestore.rules` before deployment.
