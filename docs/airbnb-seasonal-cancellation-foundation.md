# RF-AUTO-002 — Airbnb Seasonal Cancellation Policies

Status: data foundation only. The Grok Bot skill, schedule, Slack escalation,
gap detection, Adjustments, and every Airbnb mutation are out of scope until a
separate authoring/release task.

## Production baseline audited 2026-09-01

- PostgreSQL 17.6, project `revfactorHub`.
- 291 listings: 257 active and 34 inactive. Every active listing currently has
  `client_id`; production has no Blackbird (`client_id IS NULL`) listing row yet.
- 124 Adjustments: 23 portfolio and 101 single-listing. No current row has a
  missing client, missing single-listing reference, or listing/client mismatch.
- `pricelabs_reservations_cache` is the local materialized read source over
  `pricelabs_reservations_bq`. It held 35,478 rows / 35,294 reservation keys at
  audit time. The only matching pg_cron job runs as `postgres` at minute 30 of
  every hour; the latest 16 inspected runs all succeeded in roughly 9–13
  seconds. The future skill must require a successful cache refresh in the
  preceding 90 minutes. `source_fetched_at` describes the separately managed
  daily BigQuery feed and is not a substitute for local refresh-run evidence.
- Listings, clients, Adjustments, and Adjustment status history retain their
  permission-based RLS. The reservations cache is a materialized view and uses
  grants rather than RLS: authenticated/service-role SELECT, no anonymous
  access. Migration 091 changes none of those existing policies or grants.
- The deployed migration ledger ended at the timestamped application of 087 at
  audit time. Repository migrations 089 and 090 were not in the production
  ledger and must not be swept into this release; 091 is applied independently
  as the exact reviewed additive SQL.

## Data contract

Migration `091_airbnb_seasonal_cancellation_foundation.sql` adds nullable
`listings.default_cancellation_policy` and `listings.timezone`. NULL means
unverified and must block later automation. Policy values are bounded to:

`flexible`, `moderate`, `limited`, `firm`, `strict`, `super_strict_30`, and
`super_strict_60`.

Timezone values must exist in PostgreSQL's installed IANA timezone database.
The settings listing editor labels clientless rows as Blackbird and lets an
authorized listing editor maintain both fields. The deterministic read-only
inventory is:

```bash
pnpm report:airbnb-foundation
pnpm report:airbnb-foundation -- --json
```

It reads only active `listings` plus `clients_basic`, sorts by stable Hub UUID,
and emits account classification, client identity, Airbnb identifiers/links,
the two foundation fields, and every missing/blocked reason. It never reads a
reservation relation and has no mutation client call.

`listing_airbnb_settings_audit` is an append-only field-change ledger written
only by a database trigger. API roles receive SELECT only; authenticated reads
require `listings:view`. A transaction may set
`app.listing_policy_change_source` to a bounded release/evidence identifier.

## Adjustment ownership invariant

- Portfolio scope: `client_id` required and `listing_id` NULL.
- Single-listing RevFactor scope: `listing_id` required and `client_id` must
  exactly equal the referenced listing's non-NULL `client_id`.
- Single-listing Blackbird scope: `listing_id` required and `client_id` may be
  NULL only when the referenced listing's `client_id` is also NULL.
- A listing client change is rejected if it would invalidate a referenced
  Adjustment. The two constraint triggers are deferrable so an explicitly
  controlled transaction can update both sides together.

The `resolved → controlled` permission/status workflow and public Adjustment
projection are unchanged.

## Inventory and population release procedure

1. Export the Hub report and record its SHA-256.
2. In each already-authorized Airbnb account, inspect only the listing identity,
   base short-term cancellation policy, and property timezone. Never change a
   setting or enter reservation/calendar/messaging flows.
3. Match on stable Airbnb room identity plus exact Hub UUID/account/client
   classification. Names are corroboration, never the primary key.
4. Report ambiguous/unmatched rows without guessing. In particular, Airbnb
   listings with no active clientless Hub row remain blocked; this release does
   not create listings or a fake client.
5. Produce a dry-run diff. Reject duplicate room IDs, account/client conflicts,
   inactive Hub rows, and any non-NULL conflicting existing value.
6. In one transaction, set `app.listing_policy_change_source` to the evidence
   artifact ID and update only the two new fields for positively matched rows.
7. Record before/after ready/missing counts, audit-row IDs, exact SQL/result,
   timestamps, and SHA-256 checksums outside version control. Re-run the Hub
   report to prove unmatched items remain NULL.

## Preserved future skill decisions (documentation only)

- Discover gaps from `pricelabs_reservations_cache`, sourced from
  `pricelabs_reservations_bq`; require a successful local refresh within 90
  minutes.
- Target only Sunday–Thursday check-in dates, never Friday/Saturday. Include
  one-night gaps when the listing permits them.
- 0–14 days: Flexible, or the most flexible available substitute.
- 15–30 days: one level more flexible than the listing default; choose the
  closest available substitute and record the substitution.
- Never change availability or open blocked dates.
- Preserve identical/more-flexible overrides; conflicting manual overrides
  require review.
- One Adjustment per contiguous applied gap segment: type
  `pricing_flexibility`, suggested action `flexible_cancellation`, status
  `resolved`, never auto-controlled.
- A future onboarding process must detect active listings missing either
  foundation field and may later escalate to Slack. This foundation sends no
  Slack message.
- The first production run is manually double-verified. Only after that may the
  owning bot create a daily 4:00 AM `America/New_York` routine. This foundation
  creates no cron or automation.
