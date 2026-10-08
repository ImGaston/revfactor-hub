# RevFactor Event Intelligence — Executive Summary

## Purpose

Build an internal, read-only decision layer that finds important demand and disruption signals early enough to review ADR, minimum-stay, and check-in/check-out recommendations. The system combines structured event feeds, official university and government sources, targeted discovery, and RevFactor’s own listing/booking evidence. Humans remain the approval boundary; no source or agent may directly change PriceLabs, PMS, OTA, rates, or stay rules.

## What is built

- **Market and submarket foundation:** governed jurisdictions, markets, localities, radii, locked assignments, and reviewable proposal candidates. Smoky Mountains remains separate from Knoxville; Asheville remains separate from Lake Lure; Eastern Connecticut is treated separately from Washington, DC.
- **Normalized Market Signals pipeline:** provider records are converted into canonical events, versions, evidence, materiality, vulnerability, and review states. Cancellations, postponements, date changes, and recurrence watches are represented.
- **Operational sources:** Ticketmaster Discovery and NWS Alerts adapters are implemented behind the source-neutral pipeline. NWS is US-only and has no API key. CFBD college-football ingestion is implemented but disabled by default.
- **College registry:** pilot institutions and official Family Weekend, commencement, registrar/calendar, and athletics pages are registered as evidence sources. Registry entries are not collectors and do not imply that dates have been ingested.
- **PredictHQ reference archive:** the beta/trial data is retained as a recovery ledger and comparison source, but operational ingestion is disabled by default.
- **PriceLabs location snapshot:** active listings can provide coordinates and safe city/state/map metadata for market mapping. The map feed is authenticated, read-only, redacted, and currently serves 253 coordinate-bearing points in production.
- **Market map:** a private map consumes the Hub feed with a server-only bearer token and falls back to a bundled atlas when unavailable. It does not write to Supabase or expose addresses, client data, Airbnb URLs, provider IDs, or credentials.
- **Review/deployment controls:** migrations are isolated and ordered; source enablement, market activation, listing reassignment, scheduling, pricing, and stay-rule writes remain explicit gates.

## Current status

- Hub production and the private map are deployed and verified.
- `/api/market-map` returns an authenticated, redacted live feed (253 points).
- Four priority submarkets have review-ready definitions: Asheville area, Lake Lure, Knoxville, and Eastern Connecticut.
- Five listing-to-submarket candidates are staged for human review; acceptance records a review decision only and does not activate a market or create pricing actions.
- The next product slice is to complete the candidate-review UI, then build official-page collectors and run a manual, read-only discovery test before any automation.

## Credential locations (names only; never place values in Hermes, chat, source control, or client bundles)

### Local development

Use the ignored repository file `.env.local` (copy `.env.local.example`). Keep all values server-only. The example file documents these variable names:

- `SUPABASE_SERVICE_ROLE_KEY` — controlled local admin operations only; never expose to browser code.
- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` and the corresponding publishable/anon key — Hub connection settings.
- `PRICELABS_API_KEY` — PriceLabs server API and report-builder access.
- `TICKETMASTER_API_KEY` — Ticketmaster Discovery access.
- `CFBD_API_KEY` — College Football Data bearer credential.
- `PREDICTHQ_ACCESS_TOKEN` — retained only for an explicitly audited recovery pull.
- `NWS_USER_AGENT` — identifying contact string, not a secret or API key.
- `CFBD_INGESTION_ENABLED=false` and `PREDICTHQ_INGESTION_ENABLED=false` — required safety flags; keys alone cannot enable those sources.

### Vercel / production

Add the same server-only variables in the **Hub Vercel project** environment settings for Production/Preview as appropriate. Do not use `NEXT_PUBLIC_` or `VITE_` prefixes for secrets. `HUB_MARKET_MAP_TOKEN` belongs only in the private map’s Vercel project as a hidden Production/Preview secret; Hub stores only the one-way hash and scope (`market-map:read`). Never copy the raw token into this document or send it to Hermes.

### Supabase

Supabase stores the event, market, locality, proposal, listing-coordinate, and source records. The map credential is represented by a one-way hash, not a recoverable raw token. Production migrations and service-role operations must be performed by an authorized Hub operator using the controlled runbook.

## Hermes operating boundary

Hermes may perform read-only research, classification, reconciliation, and source-health reporting using sanitized exports or documented public pages. It must not receive credentials, authenticated browser state, guest/client PII, exact street addresses, raw listing/provider IDs, or production database access. It must not submit candidates, activate markets, schedule jobs, or write pricing/stay-rule changes.

## Next steps

1. Add the candidate-review panel under **Hub → Market Signals → Markets** and review the five staged candidates.
2. Resolve any outliers or market-boundary exceptions; keep uncertain records unresolved rather than silently assigning them.
3. Implement official-page collectors for the three pilot colleges/markets and reconcile them against CFBD, Ticketmaster, NWS, and targeted discovery.
4. Run a manual read-only discovery test and measure recall, lead time, duplicates, and false positives.
5. Establish recurring-event and playoff watches, then add market/property ADR baselines.
6. Only after evidence review: consider enabling additional sources or introducing human-approved commercial recommendations. Automated writes remain out of scope for this phase.

## Source of truth

The repository’s `docs/agent/` memory, `docs/event-intelligence-design.md`, market-signals runbooks, migrations, and authenticated Hub endpoints are authoritative. Treat generated summaries or agent notes as advisory and verify them against the current branch and production status.
