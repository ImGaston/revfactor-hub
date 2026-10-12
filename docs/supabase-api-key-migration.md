# Supabase API-key migration for Gaston

Shared Hub project only; no JWT signing-key change. Keep legacy API keys enabled through the cutover verification.

1. Merge the prepared consumer-header/public-key code change and deploy Hub.
2. Set server-only `SUPABASE_SECRET_KEY` to the `revfactor-hub` secret key in Production, Preview and Development where Hub runs. Mark Production/Preview Secret. Do not set any secret under `NEXT_PUBLIC_*`.
3. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `revfactor-browser` in those environments (public config). Keep `NEXT_PUBLIC_SUPABASE_URL` unchanged.
4. Build/redeploy: public values are compiled into the browser bundle. Test real Hub login, user-RLS reads and a normal privileged integration read/write. Preserve existing Hub crons and paid-model flags.
5. After verification, remove `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from those environments. Confirm there are no branch-specific legacy overrides. Redeploy if anything changed.
6. The deployed `pricelabs_get_reservation_data` Edge Function also needs migration from its platform legacy variable to its own named secret. Its caller inventory must be confirmed before the owner disables legacy keys. Its explicit service auth must remain enforced.

Code accepts the old variable names during transition, while new names take precedence. New keys travel only on `apikey`; real user JWTs remain on Authorization. Names-only hosted Hub environment inventory could not be obtained from the currently accessible Vercel team; Gaston must confirm environment/branch scopes before removal. Repository and Production/Preview GitHub Actions secret inventories are empty.
