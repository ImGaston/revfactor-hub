# RevFactor event rate protection — Grok build handoff

Prepared 2026-09-10 from direct read-only inspection of Sage via SSH, Hermes source code and SQLite aggregates, and the existing RevFactor Hub repository.

## 1. The outcome to build

Build a working rate protection automation with this sequence:

1. Create shared geographic submarkets and assign each property to its correct submarket.
2. Pull events from configured sources on a recurring cron schedule.
3. Automatically apply event-impact-based markups in PriceLabs to eligible property nights.
4. Log every markup so a revenue manager can inspect, adjust, dismiss, or remove it.

The purpose is to protect available nights from selling too cheaply when an event creates accommodation demand. Human adjustment follows normal automated execution; the normal path must not end at a recommendation awaiting approval for every event.

This is the user's updated product direction. Older Hub and Hermes documents intentionally limited work to read-only research and proposals. Those limits explain the previous implementation's stopping point; they are not the target behavior for this build. This handoff itself does not enable a cron, deploy code, or change live prices.

Keep the initial scope to event rate markups. Minimum stays, arrival/departure restrictions, client messages, and a broader AI research platform are separate work.

## 2. What Hermes actually built on Sage

Sage source root: `/Users/federicozimerman/.hermes/revfactor/event_safeguard/`.

| Component | Files | Observed behavior |
|---|---|---|
| Property inventory | `sync_properties.py`, `classify_portfolios.py`, `pricelabs.py` | Local inventory with PriceLabs listing/PMS identity, lifecycle, coordinates, and portfolio classification |
| Geographic mapping | `market_mapping.py`, `submarket_mapping.py`, `geo.py` | Geographic market clustering and city/state submarkets; proposed assignments and metadata flags |
| Persistence | `schema.sql`, `db.py`, `event_safeguard.sqlite3` | SQLite property, market, submarket, event, evidence, impact, exposure, and dry-run action tables |
| Event ingestion | `event_ingest.py` | Canonicalization, evidence association, heuristic materiality and watch/review/unwind gates |
| Pricing prototype | `pricing_pilot.py` | Read-only PriceLabs calendar fetch; hypothetical percentage markups persisted locally |
| Diagnostics | `event_quality_report.py`, `portfolio_priorities.py` | Coverage, noise, duplicate, cap-hit and priority reports |
| Tests | `tests/` | Mapping/property/geometry tests and smoke tests; overnight report records four passing smoke tests, not comprehensive production verification |

Scripts under `/Users/federicozimerman/.hermes/scripts/`:

- `revfactor_collect_events_dry_run.py`: Ticketmaster and NWS collection.
- `revfactor_event_safeguard_run.py`: optional collection → ingestion → quality/priorities → read-only pricing pilots → digest.
- `revfactor_event_safeguard_mvp.py`: earlier MVP script; inspect before reuse.

Additional source material:

- `/Users/federicozimerman/revfactor-event-intelligence/hermes-events.md` and `hermes-events.json`: earlier snapshots.
- `/Users/federicozimerman/.hermes/overnight_revfactor_event_goal.md`: previous local-only work brief.
- `/Users/federicozimerman/.hermes/revfactor/event_safeguard/overnight_goal_report.md`: partial overnight work report.
- `/Users/federicozimerman/.hermes/cron_artifacts/event_safeguard/all_market_event_pull/latest.json`: collection artifact.
- `/Users/federicozimerman/.hermes/cron_artifacts/event_safeguard/quality_reports/latest.md`: September 7 collection diagnostics.

### Verified local state on September 10

| SQLite entity | Count |
|---|---:|
| Property records, including inactive/channel records | 599 |
| Markets | 118 |
| Submarkets | 166 |
| Property/submarket assignment rows | 355 |
| Canonical events | 24,140 |
| Market/event impacts | 29,997 |
| Dry-run action rows | 243 |

All 166 submarkets are inactive drafts. The 355 assignment rows must not be presented as 355 approved unique physical properties. Dry-run actions comprise 99 proposed 10% rows, 119 proposed 15% rows, and 25 skipped 0% rows. These are not live markups.

The September 7 quality artifact reports 35,686 event/market records, 29,026 provider-unique events, 17 cap-hit markets, 6,312 noisy-category records, zero source errors and three NWS geographic skips. Zero errors does not mean complete coverage: the caps and source limitations still apply.

Hermes's current cron registry has an enabled **RevFactor active property/market refresh**, every 2,880 minutes (48 hours). No dedicated event collection/pricing runner job was found in that registry. The runner source exists, but its expected `runner/latest.md` artifact was absent. Do not claim the end-to-end runner is operating continuously. Other operating-system schedulers were not audited.

### Prototype pricing logic, for reference only

The pilot requires at least five exposed listings, then chooses:

| Event materiality | Maximum listing vulnerability | Proposed markup |
|---|---|---:|
| ≥85 | ≥70 | 25% |
| ≥75 | ≥70 | 15% |
| ≥65 | ≥55 | 10% |
| Otherwise | Any | 0% |

An exposed listing has prototype vulnerability ≥45. That score mainly reflects open nights, PriceLabs Good/High demand, open rate exposure, and proximity to the cheapest sampled event-night price. It is not a validated revenue model. Earlier market-level vulnerability is a placeholder based on the number of active listings.

## 3. Required business logic

### Step 1 — Submarkets and property assignments

- Start with active RevFactor properties, verified coordinates, timezone, and exact PriceLabs listing ID plus PMS identity. Keep physical-property identity separate from channel/listing identity to prevent duplicate writes. Portfolio candidates require resolved inclusion before live execution.
- A submarket is a shared accommodation-demand area, not one new submarket per property. Use coordinates and local demand patterns; city labels alone are insufficient.
- Generate sensible initial groups, then persist stable IDs. Every eligible physical property has exactly one primary submarket. Optional secondary event influence must be explicit and must not create duplicate property/date actions.
- Preserve reviewed boundaries and manual assignment overrides across refreshes. Missing coordinates, contradictory metadata, or ambiguous assignments enter an exception queue.
- Keep Smoky Mountains distinct from Knoxville, Asheville distinct from Lake Lure, and Eastern Connecticut distinct from Washington, DC.
- Refresh inventory and mappings as properties arrive, move, or leave. Deactivated properties immediately stop receiving new actions. Do not erase approved mapping history during refresh.

### Step 2 — Scheduled source collection

Keep a source registry per submarket: provider, query/venue/team mapping, geography, timezone, enabled state, cadence, horizon, last success, next due, cursor, and error/cap status.

| Source | Recovered status | Role in the new build |
|---|---|---|
| Ticketmaster | Collector exists | Ticketed concerts, sports and festivals; filter routine attractions and verify accommodation relevance |
| NWS | Collector exists, US only | Disruption context; not an automatic positive-markup trigger |
| College Football Data | Hub adapter exists; disabled in prior configuration | Home-game schedules after exact team/submarket mapping |
| Official university, venue, organizer and tourism pages | Hub registry/plans; no completed collector verified | Graduation, Family Weekend, conventions and other long-lead events |
| PredictHQ | Prior trial/reference, operationally disabled | Optional only; do not make the rebuild depend on it |
| SeatGeek/news discovery | Planned in Hub docs | Later coverage additions; discovery requires source evidence |

Suggested starting configuration, not an existing or approved operational schedule: inventory daily; Ticketmaster every three hours with a 180-day horizon; official calendars daily with up to 12–24 months where published. Weather can run separately every 15 minutes if retained. Tune to provider limits and actual coverage.

For every source item: preserve provider ID and evidence URL; normalize dates/status/location; match or create a canonical event; append changes; calculate affected submarkets and accommodation nights. The same event found through several sources or nearby queries stays one event with multiple impacts. A date change updates an existing event rather than silently creating an unrelated replacement.

Store event timezone and convert to local stay dates before choosing nights. Distinguish performance time, event dates, and accommodation impact dates, including configurable arrival/departure shoulder nights. Unconfirmed dates are watch items. Missing from one pull is not proof of cancellation.

Use durable jobs, overlap locks, bounded pagination, retries with backoff, and per-source failures. Record partial/capped runs. A failed or incomplete source refresh must not delete events or remove live protection.

### Step 3 — Impact-based PriceLabs markup

Evaluate **event × submarket × property × stay date**, then resolve all applicable events into one final property/date target.

1. Confirm the event and accommodation relevance using source evidence, category, venue reach, duration, attendance when actually known, and local demand context. Do not invent attendance or use title keywords alone as proof.
2. Select only correctly assigned, active properties and eligible open nights. Fetch fresh rates, availability, and existing date-specific overrides. Unknown availability is not open inventory.
3. Map the impact tier to a deterministic, versioned percentage policy. Make tiers, percentages, caps and exceptions editable. Hermes's 10/15/25% ladder is a candidate starting point, not a user-approved pricing policy.
4. Do not require five properties: a single eligible property can need protection. Do not require demand pickup as a prerequisite for an authoritative early event; that would miss the rate-protection window. Use pacing to calibrate the policy, not to erase early protection.
5. Resolve overlapping events once per property/date. Proposed default: strongest applicable percentage, no additive or multiplicative stacking. Preserve all contributing event IDs.
6. Apply only the managed event adjustment, respecting manual locks and stronger existing protections. Never overwrite unrelated minimum stays or other fields as a side effect.
7. Persist a pending action before sending, write through a dedicated PriceLabs adapter, then read back and reconcile. An API success response alone is not verification of the resulting rate state.

PriceLabs write endpoints, supported override fields, account access, percentage semantics, merge behavior, and reset behavior have **not** been verified in this investigation. The implementation must verify them against current official documentation and a controlled test before live activation. The prototype's `POST /listing_prices` is a calendar read, not a rate mutation.

The intended formula is conceptually `unmodified baseline × (1 + event markup / 100)`. Do not repeatedly multiply an already marked-up price on each cron run. If using a native percentage override, establish what baseline it applies to. If using absolute prices, maintain baseline provenance and reconciliation when PriceLabs recalculates.

### Step 4 — Action log and human adjustment

Create an operational queue showing event, evidence, submarket, property, stay dates, impact/tier, automatic percentage, previous/target/observed state, policy version, run, timestamps, status, reason and errors.

Support: filter by event/submarket/property/date/status; change a percentage or date range; remove an automation-owned markup; lock a property/date against automation; dismiss an event; restore automatic control explicitly. Every human edit records actor, reason, timestamp and before/after values.

Human changes must persist across cron runs. A manual override has precedence until explicitly released or its recorded expiry is reached. Do not label a hypothetical, failed, or unverified action as applied.

Suggested execution states: `pending → applying → applied_unverified → verified`; exceptions: `skipped`, `conflict`, `failed`, `manual_locked`, `superseded`, `reverted`. Track human review status separately from execution status.

## 4. Failure and lifecycle rules

- Stable action identity includes property, local stay date and managed adjustment type. Event/policy versions describe a desired-state revision; retry attempts must not create another markup.
- On timeout, read back before retrying: the first request may have succeeded. Resume safely after a crash between provider write and local acknowledgment.
- On cancellation or changed dates, recompute protection from remaining valid events. Remove only the adjustment owned by this automation, preserving human edits and unrelated settings.
- Past nights expire from execution. Booked or blocked nights receive no new markup. Missing calendar data or conflicting overrides produce a visible exception.
- Use an automation enable/disable control and per-submarket rollout. Runtime authentication belongs on the server. Never place credentials, property addresses, client records, or raw database exports in a Grok prompt or this handoff.

## 5. Concrete gaps to fix instead of carrying forward

1. Hermes's pilot reads `property_markets`, not `property_submarkets`, so it does not implement submarket-specific application.
2. All recovered submarkets remain drafts. The mapping code deletes and recreates generated submarkets/assignments; replace that behavior with stable upserts and preserved manual decisions.
3. City/state majority normalization can hide a geographic contradiction; flag and resolve it rather than treating the majority as truth.
4. Market vulnerability is a cohort-size placeholder, and the pricing ladder excludes cohorts with fewer than five exposed listings.
5. The pilot uses event start/end dates with a 14-day evidence cap, while proposal ranges use the full dates. Replace this mismatch with explicit per-night accommodation impacts and completeness checks.
6. The pilot limits proposals to 25 exposed listings per impact. That must not silently cap production protection.
7. Canonical fingerprints include date/category, making changed dates or cross-provider category differences a reconciliation risk.
8. Dry-run rows lack real before/after states, override conflict checks, a live writer, manual lock handling and verified rollback.
9. An enabled inventory refresh is not an enabled event-to-price automation. Build and observe the actual scheduled path.

## 6. Smallest complete implementation

Reuse the recovered code as reference. Choose one durable owner for the operational data: the existing Hub/Supabase is the natural integration option, while Sage can run the scheduled worker. Do not silently create competing SQLite and Supabase sources of truth. This hosting choice is a proposal, not a verified deployment arrangement.

Deliver one complete vertical slice: one reviewed submarket, its properties, one real source, deterministic event impact, actual PriceLabs adapter, durable action log, and working human adjustment. Expand coverage after that path works. Avoid spending the first iteration rebuilding maps, dashboards or broad research agents.

Acceptance scenarios:

1. New property maps to a stable submarket; a manual mapping survives refresh.
2. One event from two providers yields one canonical event and one effective property/night markup.
3. A confirmed event protects an eligible night even in a one-property submarket.
4. Identical reruns change nothing; rates never compound from repeated execution.
5. Overlapping events resolve deterministically and retain both reasons.
6. A human changes or locks a markup; the next cron preserves that decision.
7. Cancellation/date movement removes only obsolete automation-owned protection.
8. Booked nights, stale/missing data, partial pulls and API failures are handled without false success or unintended removal.
9. A timeout after a successful provider write reconciles without duplication.
10. Every applied row has provider read-back evidence; every failure is visible and retryable.

Unresolved configuration to make explicit during implementation: final impact thresholds/percentages/caps, exact source coverage per submarket, accommodation shoulder nights, manual-lock expiry policy, and verified PriceLabs override semantics. Do not silently inherit prototype values as settled business decisions.

## 7. Related Hub material

- `docs/event-intelligence-design.md`: older read-only architecture and source roadmap.
- `docs/market-signals/hermes-event-intelligence-executive-summary.md`: prior foundation summary, not the later Sage runtime.
- `docs/agent/integrations.md`: implemented Hub source adapters and historical activation flags.
- `docs/market-signals/foundation-deployment-runbook.md`: pending foundation deployment considerations.

Hub production/schema status was not reverified for this handoff. The repository contains substantial unrelated local changes; do not overwrite them. No credentials or raw property data were copied into this document, and no PriceLabs mutations or external messages were sent during its preparation.
