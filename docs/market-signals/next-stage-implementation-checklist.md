# Market & Event Intelligence — next-stage operating checklist

This checklist records the criteria for moving the four draft submarkets into
the event-capture stage. It is operational guidance only; it does not activate
markets or authorize commercial writes.

## Submarket gate

- [x] Draft records exist for Asheville area, Lake Lure, Knoxville, and Eastern Connecticut.
- [x] Canonical localities are recorded for each draft.
- [x] Suggested centers and bounded radii are generated from Hub coordinates.
- [x] Every relevant listing is classified inside, outside, or unresolved.
- [ ] Human review confirms outliers and approves listing memberships.
- [ ] Markets are activated only after assignment review.

## Source readiness

| Source | Purpose | Current policy | Next action |
|---|---|---|---|
| Ticketmaster | concerts, sports, venues | enabled where credential exists | validate coverage per market |
| NWS | weather disruption | enabled/read-only | retain alerts and cancellations |
| CFBD | college football | disabled by default | enable only after market review |
| University official pages | graduation/family weekend | registry-only | build collectors for approved institutions |
| PredictHQ | recovery/reference | isolated, non-operational | reconcile against independent sources |
| Grok discovery | announcements/world events | read-only candidate intake | manual test before any schedule |

## Event review gate

- Verified/current evidence is required.
- Materiality must be at least 65.
- Booking vulnerability must be present and at least 45.
- A Tier-1 source or two independent sources are required.
- Recurring events retain a series identity and watch dates for future years.
- Playoff signals remain evidence-only until team performance and dates are confirmed.

## Commercial-action gate

- The intelligence layer may produce a bounded recommendation.
- Human approval is required before ADR, minimum-stay, check-in, or check-out changes.
- PriceLabs/PMS/OTA writes remain disabled until a separate rollout decision.
- Every action must preserve the event snapshot, evidence, reviewer, and outcome.

## Baseline gate

- [ ] Compute property-level ADR and booking-window baselines for each approved listing.
- [ ] Compute market-level ADR and occupancy baselines for each market.
- [ ] Compare recurrent-event periods with prior-year comparable windows.
- [ ] Store baseline provenance and sample-size warnings.
- [ ] Never use a thin sample as an automatic markup floor.

## Morning deliverable

The next implementation PR should add assignment-review UX and baseline read
models, while keeping provider activation, scheduled Grok discovery, and all
commercial mutations off.
