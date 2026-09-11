# Steam library import

In Settings → Steam, paste an HTTPS Steam Community profile URL (`/id/name` or
`/profiles/7656119…`). The PRG login authenticates the request; the URL does not
prove Steam account ownership. Profile and game details must be public.

The Netlify function calls ResolveVanityURL and GetOwnedGames. It requests app
names, played free games and free subscriptions without a 100-game limit.
Games Steam does not expose (private titles, some shared licenses, etc.) cannot
be imported through this endpoint. Missing game_count is treated as unavailable,
not an empty library. A count mismatch is rejected rather than silently truncated.

Cards are unselected initially. Existing games cannot be imported again. Selected
games receive their chosen status and aggregate Steam time; no historical sessions
are fabricated from that total.

## One-time server setup

1. Obtain a Steam Web API key at https://steamcommunity.com/dev/apikey using the
   project owner's Steam account. Never paste it into chat or commit it.
2. In the Netlify project's environment variables, set `STEAM_WEB_API_KEY` for
   Functions (production). Optional `FIREBASE_WEB_API_KEY` overrides this project's
   public Firebase API identifier.
3. Deploy the repository, including `netlify/functions/steam-library.js` and
   `netlify.toml`, using Netlify Git integration or Netlify CLI. Uploading only
   `web-dashboard` via Drop will NOT deploy the function.
4. Fully restart the development launcher (main and preload changed), log in to
   PRG, and test with a public Steam profile.

The function validates the Firebase ID token with Google's accounts:lookup,
accepts only Steam Community profile paths, and fetches fixed official API hosts.
Steam keys and Firebase tokens are not logged or returned. The endpoint remains
subject to Steam quotas; application-level rate limiting is future work before
wider distribution.

Tests: `node --test tests/steam-library.test.cjs` (mocked HTTP, no real accounts).
