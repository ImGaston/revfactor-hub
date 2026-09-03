# University event reconciliation handoff

Status: build slice complete, persistence and activation pending (2026-09-03).

## What is implemented

`lib/market-signals/reconciliation.ts` provides a side-effect-free snapshot reconciler for official university observations:

- Groups observations by institution, category, normalized title, year, and quarter.
- Clusters observations within a 14-day date-drift window, keeping separate same-quarter occurrences distinct.
- Chooses the canonical observation by configured source role (`canonical` before `corroborating`), then newest observation time and source ID.
- Retains all observations and reports date, title, and provider-status conflicts.
- Classifies new, unchanged, moved, postponed, canceled, restored, and detail changes through the existing domain classifier.
- Reports missing future occurrences only for sources explicitly marked as complete snapshots; incremental/partial runs cannot create false cancellations.

The accompanying tests cover precedence/conflicts, multiple family-weekend occurrences, date moves, and complete-vs-incremental missing detection.

## Deliberate boundary

This slice does not write Supabase, activate a source, submit Grok candidates, schedule a cron, or change pricing/stay rules. It is safe to review and merge independently of the pending RF-INTEL-001 production migration.

## Required next integration

1. Add a durable reconciliation-run/snapshot-delta record tied to `market_event_series` and provider source IDs.
2. Pass complete-snapshot metadata from each official collector; default unknown/partial runs to no missing detection.
3. Persist canonical selection, corroborating observations, conflicts, and review-required missing deltas transactionally.
4. Replay fixtures for UConn, UTK, and GW before changing any `registry_only` row to enabled.
5. Keep production ingest paused during the foundation migration and run postflight invariants before resuming it.

Open decisions: exact series identity key across source families; retention/expiry policy for stale registrar observations; and which official pages can guarantee complete snapshots.
