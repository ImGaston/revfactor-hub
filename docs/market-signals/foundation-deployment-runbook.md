# Market & Event Intelligence Foundation Deployment Runbook

Status: reviewed local release candidate, 2026-09-02. This runbook covers the database foundation only. It does not authorize a Grok collector, PriceLabs changes, minimum-stay changes, or check-in/check-out restrictions.

## Release Package

Apply these migrations in this exact order:

1. `20260902203000_predicthq_reference_recovery.sql`
2. `20260902203100_college_football_data_source.sql`
3. `20260902203200_university_event_source_registry.sql`
4. `20260902203300_market_event_intelligence_foundation.sql`
5. `20260902203400_market_registry_initial_proposals.sql`

The university registry depends on the CFBD source type, the foundation creates the proposal table, and the final proposal seed depends on that table plus the canonical jurisdiction rows. Do not reorder or apply only part of the package.

## Why an Isolated Manifest Is Required

The repository contains historical numeric migrations whose filenames do not perfectly mirror the linked production migration ledger. A normal bulk push can therefore propose unrelated historical files. Never use `--include-all`, never run a linked bulk `migration up`, and never repair production history as a shortcut.

Create a temporary Supabase directory containing:

- placeholder files for every migration version already present in the linked production ledger; and
- copies of only the five timestamped files above.

Run `supabase db push --linked --dry-run` against that temporary directory. The dry run must list exactly the five files above and no others. Delete the temporary directory after the deployment evidence is saved.

## Preflight Gates

- Confirm the Vercel production environment has the existing Supabase URL, anon key, and service-role key. Never print or copy their values into logs or repository files.
- Confirm the linked Supabase project is the Hub production project.
- Capture read-only counts for markets, listing memberships, sources, events, provider records, versions, evidence, impacts, briefs, and jobs.
- Run the focused Market Signals test suite and targeted lint.
- Run `git diff --check` and verify none of the five SQL files contain provider tokens or HTTP calls.
- Repeat the isolated-manifest dry run and retain its output as deployment evidence.

## Read-Only Verification Utility

After confirming that `.env.local` targets the Hub production Supabase project, capture the aggregate baseline before applying the package:

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-market-intelligence-foundation.ts --baseline-only > /tmp/rf-intel-baseline.json
```

After the isolated-manifest deployment, run the post-deployment invariants against that same baseline:

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-market-intelligence-foundation.ts --baseline /tmp/rf-intel-baseline.json
```

The utility uses the existing server-side Supabase environment, performs bounded reads only, and emits aggregate counts and pass/fail metrics without listing identifiers, source payloads, credentials, or other sensitive fields. It exits nonzero if a required query fails or an invariant is unsafe. Retain the JSON as deployment evidence. This utility does not apply migrations, inspect the browser, or replace the isolated-manifest dry run and focused RLS/static tests.

Use the repository-local binary directly as shown. The repository's pnpm ignored-builds hook blocks this command before `tsx` starts on the current Mac. If `SUPABASE_SERVICE_ROLE_KEY` is absent locally, do not attempt the live verifier; run it only in an approved environment that already holds the Hub server credentials.

## Apply Procedure

1. Schedule a short maintenance window for Market Signals ingestion workers.
2. Pause the relevant event-ingestion schedule; do not pause unrelated Hub functions.
3. Run the isolated-manifest push without `--dry-run`.
4. Run the post-deployment checks below before resuming ingestion.
5. Resume ingestion only after all invariants pass.

## Post-Deployment Invariants

- Existing market, event, evidence, impact, brief, and job counts did not decrease.
- Every active market with canonical geography has exactly one primary jurisdiction membership.
- No approved listing has more than one primary market.
- Every populated listing locality belongs to that listing membership's market; existing memberships may remain locality-null.
- Smoky Mountains contains Sevierville, Pigeon Forge, Gatlinburg, and Pittman Center; Knoxville is not a Smokies locality.
- No Knoxville or Eastern Connecticut market was created by the university registry.
- Exactly 38 census proposals exist with `status = 'needs_review'`, no resolved market, and no proposed center or radius; applying the package created no additional market or listing membership.
- Proposal-to-listing candidates are empty unless explicitly submitted later; any accepted or rejected candidate records reviewer identity and time, and no candidate decision creates a listing membership automatically.
- UConn and UT Knoxville official-page sources are inactive and marketless; GW may reference the existing Washington market.
- PredictHQ provider rows remain available as reference history but are disabled for new ingestion unless the explicit environment override is enabled.
- The source catalog contains Ticketmaster, NWS, CFBD, PredictHQ reference, official university pages, SeatGeek research, and planned discovery-provider records.
- A newly created recurring event series produces unknown-date watches for the current year plus two future years.
- Permission-based RLS is enabled on each new table; no permissive `USING (true)` or delete policy exists.
- `/market-signals` loads and shows the foundation KPIs without an error overlay.

## Rollback Strategy

This package is additive and intentionally preserves existing records. If application behavior regresses, first pause ingestion and deploy the prior application build; the Hub read model is backward-compatible with both the pre-foundation and post-foundation schemas. Do not drop the new tables or columns during incident response. Database removal requires a separately reviewed forward migration after data export and dependency analysis.

## Activation Boundary After Deployment

Deployment makes the registry available; it does not approve the proposed market census or start a Grok automation. The next governed steps are:

1. review and approve the initial market/locality registry;
2. backfill listing assignments with exceptions left unresolved;
3. implement official university-calendar collectors for three pilot institutions;
4. run Grok in planning/read-only discovery mode and compare its candidates against structured sources;
5. add human approval before any pricing or stay-rule execution.
