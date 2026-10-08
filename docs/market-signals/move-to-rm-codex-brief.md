# Codex brief — move Event Intelligence (Market Signals) from Hub to RevFactor RM

Owner decision (Fede, 2026-10-08): RevFactor RM (`federzimer/revfactor-rm`, `pricing.revfactor.io`) becomes the only home of event intelligence — collection, scoring, review UI, market map feed. Hub (`ImGaston/revfactor-hub`, `hub.revfactor.io`) stops running and showing it. Reuse the same provider keys and configuration.

Read this whole brief before touching either repo. Work in the phases below, in order. Stop and report at every **STOP** gate.

---

## 0. Facts you can rely on (verified 2026-10-08)

**Same database.** Hub and RM already share one Supabase project (`revfactorHub`, ref `xpfjjcwgbjsdxdhyrcxd`). Nothing in the database moves. This is a move of code, cron and UI ownership only. **Do not copy, drop, rename or recreate any table.**

**Live data (approximate row counts):**
- `market_events` 1,883, of which ~870 are upcoming
- `market_event_impacts` 1,015
- `market_event_provider_records` 2,071
- `market_event_versions` and `market_event_evidence` 1,953 each
- `market_signal_jobs` 151, all succeeded; last run 2026-10-08
- `market_signal_briefs` 60
- `market_signal_source_catalog` 15
- `revenue_markets` 9 (impacts exist for only 5 of them)
- `revenue_market_*` registry tables
- Empty tables: `market_event_listing_exposures`, `market_signal_reviews`, `market_event_series*`, `market_event_conditions`

**Migrations already applied in production:**
- `076`, `077`, `078`, `080`–`085`
- `20260902203000_predicthq_reference_recovery`
- `20260902203200_university_event_source_registry`
- `20260902203300_market_event_intelligence_foundation`
- `20260902203400_market_registry_initial_proposals`
- `20260902203500_university_official_page_adapter_configs`

**Not applied:** `089_weather_bot_delivery_queue.sql`. The Weather Bot was never deployed.

**Database functions in use:**
- `claim_market_signal_job`, `enqueue_market_signal_jobs`, `finish_market_signal_job`
- `replace_market_signal_scoring`
- `create_market_signal_adjustment` and `link_market_signal_adjustment`. These two write into Hub **Adjustments**; keep that link working.
- `ensure_` / `replenish_market_event_series_date_watches`
- the sync/validate triggers

RLS uses `has_permission('market_signals', …)`.

**How Hub runs it today.** There is no dedicated Vercel cron. Ingestion is chained onto Hub's existing daily crons:
- `app/api/cron/sync-pricelabs/route.ts` calls `enqueueMarketSignalJobs`
- `app/api/cron/sync-stripe/route.ts` calls `enqueueMarketSignalJobs` and `processMarketSignalJobs`

`app/api/cron/market-signals/route.ts` exists as a manual and secret-protected entry point.

**Hub event footprint:**
- **Module:** `lib/market-signals/*`, plus the untracked `cfbd.ts`, `lib/weather-bot*.ts` and `scripts/weather-signals-worker.ts`
- **UI:** `app/(authenticated)/market-signals/*`
- **APIs:** `app/api/market-signals/*` (submarket review, university preview), `app/api/market-map/route.ts`, and the untracked `app/api/v1/weather-signals/*`
- **Cron:** the two chained crons above, plus `app/api/cron/market-signals`
- **Navigation and permissions:** `components/layout/app-sidebar.tsx`, `lib/command-registry.ts`, `lib/permissions.ts` (`market_signals`)
- **Scripts:** `scripts/{benchmark-market-signal-scale,build-submarket-baseline,build-submarket-review,backfill-market-vulnerability,verify-market-intelligence-foundation}.ts`
- **Tests:** `lib/__tests__/market-signal*`, `market-event-*`, `market-intelligence-*`, `market-registry-*`, `university-pages`, `weather-bot`
- **Docs:** `docs/market-signals/*`, `docs/event-intelligence-design.md`, `docs/analysis/event-intelligence/*`, `docs/market-map/*`
- **Artifacts:** `artifacts/market-registry-review.json`, `artifacts/submarket-*`

**Environment variables read by the module (names only):**
- **Data sources:** `TICKETMASTER_API_KEY`, `CFBD_API_KEY`, `CFBD_INGESTION_ENABLED`, `PREDICTHQ_ACCESS_TOKEN`, `PREDICTHQ_INGESTION_ENABLED`, `NWS_USER_AGENT`
- **Jobs:** `MARKET_SIGNALS_JOBS_PER_RUN`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
- **AI briefs:** `AI_GATEWAY_API_KEY`, or Vercel OIDC through `VERCEL_OIDC_TOKEN`
- **Market map:** `HUB_MARKET_MAP_TOKEN` lives only in the `revfactor-market-map` Vercel project. Hub stores its hash and scope.

**RM today:**
- Static pages (`index.html`, `listing.html`, …) with no build step.
- TypeScript Vercel Functions in `api/*.ts` with helpers in `server/`.
- Functions authenticate the Hub user with `server/http.ts` → `authenticated()`, which runs `auth.getUser` and then `has_permission`, using the anon key plus the user's JWT.
- There is no service-role key and no `vercel.json`, so no crons.
- Deploys go through `scripts/stage-deployment.py`, which only ships allowlisted files and bundles `api/` through `scripts/build-api.cjs`.
- Database changes live in `db/*.sql`.
- Tests: `node --test tests/*.test.cjs && tsx --test tests/backend/*.test.ts`. Typecheck: `pnpm typecheck`.
- Vercel Authentication protects all environments.

---

## Hard rules

1. **Never print, log, commit or echo secret values.** Refer to variables by name only. Fede copies the values in the Vercel dashboard himself.
2. **No destructive database operations.** Don't drop, truncate or rename. Delete rows only if asked. New SQL must be additive and permission-checked, following the RM `db/` pattern. Any production migration is a **STOP** gate for Fede's approval.
3. **No writes to PriceLabs, the PMS or OTAs.** Humans remain the approval boundary.
4. **Hub working tree is shared and dirty.**
   - Do not revert or sweep unrelated changes. The modified `proxy.ts`, `package.json`, `tsconfig.json`, `lib/api-auth.server.ts` and `scripts/create-api-key.ts`, and the untracked commission, support and onboarding files, belong to other work.
   - Stage files explicitly by path, never with `git add -A`.
5. Hub is Gaston's repo. Hub changes go through a PR on `ImGaston/revfactor-hub`. Do not push to its `main`.
6. Keep RM's conventions: missing values stay `—` and never become zero, freshness is shown against the current clock, filters live in the URL, and no secrets go into browser bundles or the staging allowlist.

---

## Phase 1 — Preserve the source (Hub, no behavior change)

The latest event work exists **only on Fede's Mac**.

1. In `~/Documents/RevFactor`, the branch `codex/reservation-alteration-policy` has **13 commits that are not on any remote branch**. They include the university collectors and submarket review, and they also include unrelated commits (`d213866`, `29986f2`). Push the branch as-is to a new remote branch, `archive/market-signals-local-2026-10-08`, so nothing is lost:
   ```bash
   git push origin HEAD:refs/heads/archive/market-signals-local-2026-10-08
   ```
2. Snapshot the uncommitted **event-related** files only into a commit on a fresh branch, `codex/market-signals-export`. Branch from `HEAD`, then use `git stash`-free path staging.
   - **Modified:** `lib/market-signals/{contracts,domain,ingest.server,jobs.server,repository.server,vulnerability.server}.ts`, `lib/__tests__/market-signals-{domain,migration}.test.ts`, `docs/event-intelligence-design.md`
   - **Untracked:**
     - code: `lib/market-signals/cfbd.ts`, `lib/weather-bot.ts`, `lib/weather-bot.server.ts`, `app/api/v1/weather-signals/**`
     - migrations: `supabase/migrations/089_weather_bot_delivery_queue.sql` (not applied in production) and `supabase/migrations/20260902203{200,300,400}_*.sql` (applied in production but untracked in Git). Also check whether `20260902203000_predicthq_reference_recovery` and `20260902203500_university_official_page_adapter_configs` exist as files anywhere. Both are applied in production. If a file is missing, say so; don't recreate it.
     - tests: `lib/__tests__/{market-event-intelligence-foundation-migration,market-intelligence-foundation-verification,market-registry-initial-proposals-migration,market-signals-cfbd,weather-bot}.test.ts`
     - scripts: `scripts/{verify-market-intelligence-foundation,weather-signals-worker}.ts`
     - docs: `docs/market-signals/{foundation-deployment-runbook,grok-rate-protection-handoff,hermes-event-intelligence-executive-summary,market-registry-census}.md`
   - Inspect the diffs to `lib/api-auth.server.ts` and `scripts/create-api-key.ts`. Include only the hunks for the weather-signals API-key scope. Leave everything else unstaged.
   - Push the branch. Do not open a PR to Hub `main` for this branch; it exists only as the port source.
3. Record in RM `docs/event-intelligence-migration.md`:
   - the exact source SHAs (archive branch, export branch)
   - the file list
   - which production migrations each file corresponds to

**STOP:** report the two branch names and SHAs and the list of files you left untouched.

## Phase 2 — Port the engine into RM (no cron yet)

Work in a fresh clone or worktree of `federzimer/revfactor-rm` from `origin/main`. The local `~/Claude/dev/repos/revfactor-rm` checkout is on the stale branch `live-data`; don't build on it. Use the branch `codex/event-intelligence-port`.

1. **Engine.** Port the source from `codex/market-signals-export` into `server/market-signals/`:
   - `contracts`, `domain`, `provider`, `ticketmaster`, `nws`, `cfbd`, `predicthq`, `university-pages`, `university-collector`, `ingest`, `jobs`, `repository`, `vulnerability`, `brief`, `brief-agent`, `briefs`
   - Replace the `@/` imports and `server-only` with RM-relative imports.
   - Add whatever Hub dependencies these need (zod, the AI SDK) to `package.json`, pinned to exact versions.
   - Keep the logic identical. This is a move, not a rewrite.
2. **Privileged client.** Add `server/admin.ts`, which creates a service-role Supabase client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
   - Import it **only** from cron and ingestion entry points.
   - Add a test that fails if any `api/*.ts` other than the cron handler, or any browser file, imports it.
   - Update RM's docs. RM's current claim is "no service-role credential". The new rule is: service role is allowed only in the cron handler; user-facing reads still use the user's JWT.
3. **Cron entry.** Add `api/cron/market-signals.ts`, ported from Hub's `app/api/cron/market-signals/route.ts`.
   - Require `Authorization: Bearer ${CRON_SECRET}`.
   - Use enqueue → process with `MARKET_SIGNALS_JOBS_PER_RUN`.
   - Add a `MARKET_SIGNALS_RM_ENABLED` flag. When it isn't exactly `true`, return 200 with `{ skipped: "disabled" }`.
   - Add `vercel.json` with a daily cron for `/api/cron/market-signals`, scheduled at `45 8 * * *` UTC, after Hub's PriceLabs sync.
   - Confirm three things and report them:
     - the RM Vercel plan allows `maxDuration` 300 and this cron frequency
     - Vercel cron invocations work while Vercel Authentication protects all deployments
     - `scripts/stage-deployment.py` and `scripts/build-api.cjs` bundle the new `api/cron/*` path and `server/market-signals/**`
4. **Tests.** Port the Hub unit tests for the domain, Ticketmaster/NWS, CFBD, PredictHQ, university pages, brief and vulnerability into `tests/backend/`, then run `pnpm typecheck && pnpm test`.
5. **Dry run.** Add `scripts/market-signals-dry-run.ts`.
   - It runs one market through the source adapters with **no database writes** and prints counts only.
   - Run it locally against your own `.env.local`. Don't commit that file. If you don't have the keys, report that and skip this step.

**STOP:** open the RM PR. Don't merge and don't enable the flag.

## Phase 3 — Read-only UI in RM

Build this in RM's vanilla JS style, reusing `core.js`, `app.css`, `theme.js` and the URL-state helpers. Don't port Hub's React/shadcn view.

1. **Read API.** Add `api/signals.ts`, which uses `authenticated()` but checks `has_permission('market_signals','view')`. Add a `resource` parameter to `authenticated()`; don't change existing callers. It should return:
   - **Portfolio queue:** upcoming impacts (`start_at >= now()`) grouped by market and action gate, with event, dates, attendance range and confidence, booking window, evidence freshness and the number of affected listings.
   - **Listing view:** the impacts for one exact Hub listing UUID. Resolve market membership through `revenue_market_listings`, and through `market_event_listing_exposures` once that table is populated.
2. **Pages.**
   - Add `signals.html` + `signals.js` as the portfolio events queue, linked from the Book nav and from "Where to look".
   - Add an **Events** tab to the listing workspace, next to Performance and "Comps & pricing".
   - Add the market map: move `app/api/market-map/route.ts` to RM `api/market-map.ts`. Keep the same redacted response contract and keep the bearer-token check. Create a new token and store its hash the same way Hub did, then document the swap. Don't reuse the old raw token.
3. **Correctness fixes found during the audit.** All twelve current `review_now` impacts are **expired** NWS heat and flood warnings in Tucson from Aug–Sep. Fix both of these:
   - Past events and expired alerts never show as actionable. Filter at read time, and add a scoring rule so their gate decays.
   - Weather disruption and demand events are separate lanes in the UI.
4. **Writes.** Port the review actions (review status, "create Adjustment", "link Adjustment") as permission-checked RPC calls:
   - `market_signals:edit` for reviews
   - `adjustments:create` for creating an Adjustment
   - Adjustment links open `https://hub.revfactor.io/adjustments/<id>`, because Adjustments stay in Hub.
   - If any of these needs a new security-definer RPC, write it as a new `db/` migration file. **STOP** for approval before applying it.

**STOP:** open the PR. Include screenshots from a preview deployment showing the queue, a listing's Events tab and the map.

## Phase 4 — Cutover (requires Fede's go)

Ingestion must run in only one place, because both use the same Ticketmaster key and quota. On the cutover day:

1. **Fede, in the RM Vercel project → Settings → Environment Variables, Production + Preview, server-only:** copy the values from the Hub Vercel project for:
   - `TICKETMASTER_API_KEY`, `CFBD_API_KEY`, `PREDICTHQ_ACCESS_TOKEN`, `NWS_USER_AGENT`, `AI_GATEWAY_API_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`, where the same Hub key is fine since it's the same project
   - Then set `CFBD_INGESTION_ENABLED=false`, `PREDICTHQ_INGESTION_ENABLED=false`, `MARKET_SIGNALS_JOBS_PER_RUN` (Hub's value), a **new** random `CRON_SECRET`, and `MARKET_SIGNALS_RM_ENABLED=false`.
   - Codex: give Fede this checklist; do not handle the values.
2. **Hub PR, on a branch from Hub `origin/main`, titled "Retire Market Signals from Hub (moved to RM)":**
   - Remove the `enqueueMarketSignalJobs` and `processMarketSignalJobs` calls from `sync-pricelabs` and `sync-stripe`.
   - Delete `app/api/cron/market-signals`, `app/api/market-signals/*`, `app/api/market-map`, `app/(authenticated)/market-signals/*`, `lib/market-signals/*`, the market-signal scripts and the tests.
   - Replace the sidebar and command entries with an external link to `https://pricing.revfactor.io/signals.html`, or remove them.
   - **Keep** the `market_signals` entry in `lib/permissions.ts`. RLS depends on it, and admins still grant it in Hub Settings.
   - **Keep** every file in `supabase/migrations/`. They are applied history. Add `supabase/migrations/README-market-signals.md` saying that future market-signal SQL lives in `revfactor-rm/db/`.
   - Move the docs to RM and leave a one-line pointer in Hub `docs/agent/project-map.md` and `docs/agent/decisions.md`.
   - Run `pnpm typecheck` and the Hub tests.
3. **Sequence:**
   1. Merge and deploy the Hub retirement PR.
   2. Confirm the next Hub cron response no longer includes `marketSignals`.
   3. Set `MARKET_SIGNALS_RM_ENABLED=true` in RM and redeploy.
   4. Trigger the RM cron once manually with the secret.
   5. Verify that a new `market_signal_jobs` row reached `succeeded` and that `market_event_provider_records.last_observed_at` advanced.
4. Point the `revfactor-market-map` Vercel project at RM's `/api/market-map` with the new token, redeploy it and verify that the map loads live points.

**STOP:** report the evidence: job rows, cron response, map check.

## Phase 5 — Fill the gaps (after cutover)

Each of these is its own PR. Read `docs/market-signals/hotel-airline-event-rm-research.md` first. These design rules come from it and override anything below that conflicts with them:

- **Pace is the trigger; the event is the explanation.**
  - Raise a recommendation when forward occupancy or pickup for a date beats same-time-last-year (STLY) or comparable days, for the listing or the market. Attach the event as context.
  - An event with flat pickup produces **hold / watch**, never "raise". Hotels lost heavily at Paris 2024 and the 2026 World Cup by pricing in the event without checking pickup.
- **Signals expire.** Every recommendation has a decision date and lapses if nobody acts on it. Event records are re-checked for date changes and cancellations. Event placeholders fade as real bookings come in.
- **Weather is a guardrail, not an opportunity.**
  - NWS alerts may only produce hold, decrease or flexibility notes. Never suggest an increase.
  - Under a declared emergency, SC and TN price-gouging laws apply to lodging. That covers Myrtle Beach and the Smokies.
- **Stay rules as well as price.** For multi-night events, suggest minimum-stay and arrival-day rules. Also suggest relaxing them automatically when pickup lags.
- **Review in steps, not once.**
  - Start with a modest placeholder 90–180 days out, then review at about 60, 30 and 14 days.
  - The 30–7 day window is where most of the decision value is, because STR event bookings come about 30 days out vs. about 11 days normally.
  - Review markets weekly, with a daily exception queue.
- **Log everything to measure who adds value.** For each recommendation, store the system suggestion, the approved value, the approver, a reason code and the outcome. This lets a report compare the system, the human edits and PriceLabs alone. Upward human overrides are the ones that usually hurt.

1. **Listing exposures.** Populate `market_event_listing_exposures` after each run, using the existing table and scoring code, so every impact maps to real listings.
2. **Market coverage.** Impacts exist for only 5 of the 9 `revenue_markets`, while the portfolio has about 244 listings. Produce a coverage report for Fede listing which managed markets have no `revenue_markets` row, then propose additions through the existing `revenue_market_proposals` review flow. Don't activate markets without approval.
3. **Suggested price.** Port the yield math from `federzimer/revfactor-event-pricing` (`packages/yield-os`) into RM as a pure, tested module. The weights are:

   | Evidence available | Suggested lift |
   | --- | --- |
   | Own history on a comparable event | 0.4 × market book + 0.6 × last own lift |
   | No own history, other homes have it | 0.7 × market book + 0.3 × portfolio average |
   | No history at all | market book |

   - Adjust the formula as follows:
     - Treat it as a starting estimate that shrinks toward observed pickup as the date approaches.
     - Cap the weight on own history by how many prior runs of the event exist. A single prior run is noisy.
     - Mark sold-out history as censored, so it doesn't understate the lift.
     - Only produce a "raise" when pace confirms it.
   - Show current price → suggested price, the reason and the confidence on the listing Events tab.
   - Where there's low evidence or no current nightly rate, show "investigate", not a number.
4. **Decisions and outcomes.**
   - Add `rm_event_decisions` following the `rm_comp_reviews` pattern. Each row stores:
     - the system suggestion, including price and stay rules
     - the approved value, the approver and a reason code
     - the decision date and expiry
   - After each stay, record the outcome against the event:
     - actual ADR and occupancy
     - booking lead time
     - gap nights left by stay rules
     - an early-booking flag (booked unusually early, which suggests underpricing)
   - That outcome becomes "own history" next time.
   - Evaluate with a counterfactual. Compare the listing's comparable days, adjusted by an unaffected comparison set (difference-in-differences), not a raw year-over-year. Track the acceptance rate, reversals, and value added by upward vs. downward human edits.
   - Each new SQL file needs approval before it is applied.

## Done means

- Hub has no event code, cron hooks, UI or APIs. Hub permissions and migration history are intact.
- RM runs the daily ingestion with the same keys. The jobs table shows successful runs after cutover.
- RM shows a portfolio events queue and a listing Events tab, and the market map is served from RM.
- No expired event shows as actionable.
- `pnpm typecheck && pnpm test` pass in both repos, and RM docs describe the new service-role boundary.
- Hub `docs/agent/decisions.md` and RM docs record the move, dated 2026-10-08.
