# Ontology: listing revenue setup (proposal, 2026-10-15)

Status: **approved model (Fede, 2026-10-15)**. Migration `20261015120000_listing_revenue_setup.sql` applied to production and HK332 backfilled (2026-10-15); the read-only Setup tab sits on the listing page next to Strategy and Goals. It came out of the Jacob Raabe / HK332 takeover (Oct 14–15), where every pricing decision (cleaning fee, markups per channel, discounts, min stays, check-in/out, promotions, sync) lived only in a scratchpad change log. This maps those decisions onto the Listing so the Hub can answer: *what is set, where, why, who approved it, and is it still true on the channels?*

It follows `listing-review.md`: the Listing is the anchor, state changes only through named actions, every change follows Exception → Recommendation → Decision → Execution → Outcome, and code computes numbers.

## What exists today (reuse, don't duplicate)
- `adjustments` already has setup-family types: `setup`, `price`, `min_price`, `max_price`, `min_stay`, `checkin_checkout`, `discount`, `markup_fees`, `availability`, `cancellation_policy`, `pricing_flexibility`. Statuses run open → resolved → controlled, with `adjustment_status_history` append-only. This is the **Execution** object.
- `listings.pl_*` columns mirror PriceLabs (base/min/max, cleaning fee, push). They're read-only sync, so they're **observed** state, not decisions.
- `listing_airbnb_settings_audit` (old/new pairs by trigger, `change_source`) and `listing_optimization_events` (append-only action log) are the audit precedents.
- `revenue_strategy_versions`, `revenue_decisions` and `revenue_executions` exist in migration 075 but were **never applied to production**. They're JSON-blob versions; useful ideas (before/intended/observed state), wrong granularity for per-setting tracking.
- `lib/adjustments.ts` `SETUP_CONTROL_CHECKLIST` (markup, min/base, LOS, promotions, sync, access) isn't persisted.

## Objects

| Object | Key | Notes |
|---|---|---|
| **Listing** (anchor) | `listings.id` | Gains nothing but links. `clients.pms_name` gives the channel manager. |
| **SettingKey** (catalog, code) | `key` string, versioned like the review checklist | One entry per decision type (table below): system of record, unit, scope (listing / channel / date range), how to observe it. |
| **ListingSetting** (intended, current) | `(listing_id, key, channel, date_from, date_to)` | The value we *decided*. One current row per scope. Status: `planned` → `applied` → `verified`, or `drift`. |
| **SettingChange** (append-only) | `id` | Every transition of a ListingSetting: old → new, action, actor, approver, reason, evidence, links. **This is the "map" per decision.** |
| **ChangeSet** | `id` | One approved batch (e.g. "Batch A", "Airbnb discounts", "cleaning fee + Vrbo 20%"). Groups SettingChanges and links to the plan document and the adjustment(s). |
| **Observation** | `(listing_id, key, observed_at)` | What a system actually shows (PriceLabs API, Guesty, a channel quote). Compared to ListingSetting to flag `drift`. |

### SettingKey catalog (first version, from HK332)

| Group | Keys (scope) | System of record | Observed by |
|---|---|---|---|
| Pricing | `price.min`, `price.base`, `price.max`; `price.seasonal_min` (date range); `price.dso` (date range) | PriceLabs | PL API (automatic) |
| Stay rules | `stay.min_stay_profile`; `stay.min_stay` (date range, incl. lead-time fallback); `stay.orphan_gap` (min stay + price premium); `stay.checkin_checkout_default`; `stay.checkin_checkout` (date) | PriceLabs (pushed to the PMS) | PL API; PMS calendar |
| Fees | `fee.cleaning` (amount, per stay, channel); `fee.extra_guest` | PMS (Guesty) | manual / channel quote |
| Markups | `markup.<channel>` (airbnb, booking, vrbo, direct) and which level (listing vs account) | PMS | channel price ÷ PL price |
| Discounts | `discount.airbnb.trip_length` (tiers), `.weekly`, `.monthly`, `.last_minute`, `.early_bird`, `.top_rated`; `discount.booking.genius`, `.non_refundable`; `discount.vrbo.*` | Channel or PMS (varies, so record which) | channel panel / quote |
| Promotions | `promotion.<channel>.<name>` (active/inactive, %, dates) | PMS promotions | PMS list |
| Availability | `availability.booking_window`, `.advance_notice`, `.prep_time` | PMS | PMS settings |
| Sync / tools | `sync.pricing_tool` (PriceLabs on / Guesty PriceOptimizer off); `sync.pl_push`; `sync.pms_token` (valid/expired) | PL + PMS | PL API |
| Policies & tax | `policy.cancellation.<channel>`; `tax.collected_by.<channel>` | PMS / channel | manual |

## Actions

| Action | Caller | Tier | Audit |
|---|---|---|---|
| `ProposeSettingChange` | staff or agent (from a setup spec) | automatic (draft) | SettingChange `proposed` |
| `ApproveChangeSet` | Fede (or the owner for owner-facing items like the cleaning fee or children) | approval | SettingChange `approved` (approver, reason) |
| `ApplySetting` | staff (or an agent with the API, e.g. PriceLabs) | team | SettingChange `applied` + evidence (API response, PATCH 200, screenshot) and the adjustment resolved |
| `VerifySetting` | staff with `adjustments:control`, or the observer job | team / automatic | SettingChange `verified`; adjustment controlled |
| `FlagDrift` | observer job | automatic | SettingChange `drift` + exception |
| `RevertSetting` | staff | approval | SettingChange `reverted` (back to old value) |

## The chain for a setting

| Step | Example (HK332) |
|---|---|
| **Exception** | Guesty PriceOptimizer still pricing during a PriceLabs takeover; PL token expired; Airbnb price ≠ PL × markup; cleaning cost not recovered; Booking.com 38% cancellations; drift after a PMS sync. |
| **Recommendation** | The setup spec (`pricing-strategy/<client>.md`) as a list of proposed SettingChanges with the reason (owner minimum = payout rule, payout per channel). |
| **Decision** | `ApproveChangeSet` by Fede; owner decision where it's theirs. |
| **Execution** | `ApplySetting`, linked to a setup-family adjustment (`markup_fees`, `min_stay`, `discount`, …) that is resolved. |
| **Outcome** | `VerifySetting` on the channel (e.g. Airbnb $274 → $395 = ×1.44), then performance: pace at day 14/30 vs target, payout per night vs floor. |

## Tracking changes: what each SettingChange records
`listing_id`, `key`, scope (`channel`, `date_from`, `date_to`), `old_value`, `new_value` (JSON), `action`, `actor_type` / `actor_id`, `approved_by`, `reason` (one line; e.g. "covers cleaning after Vrbo markup cut"), `change_set_id`, `adjustment_id`, `system` (where it was executed), `evidence` (JSON: request id, status code, screenshot path), `created_at`. Append-only, readable by `listings:view`; writes only from server actions. Financial-sensitive keys (none so far) would follow the `super_admin` rule.

## Hub surfaces
- **Listing → "Setup" tab**: groups above, each row shows the current value, where it lives, status (applied / verified / drift), last change (who, when, why) and a link to the change history.
- **Change history**: timeline by ChangeSet; each change expands to old → new, approver, reason, evidence.
- **Adjustments**: a setup ChangeSet creates or links adjustments, so the existing resolve/control flow and the team queue keep working.
- **Exceptions**: drift and the "setup not verified within X days" checks feed the planned `ont_exception`.

## Rollout
1. Agree on this model and the key catalog (this doc).
2. ✅ Migration: `listing_settings`, `listing_setting_changes`, `listing_setting_change_sets` (permission-based RLS, no `USING (true)`). Applied 2026-10-15.
3. ✅ Setup tab with HK332 backfilled (2026-10-15), then the write path (2026-10-15): Record change, Mark verified, Flag drift (staff, `listings:edit`).
4. ✅ PriceLabs check (2026-10-15), daily inside the PriceLabs cron and on demand ("Check PriceLabs now"). Checks `price.min/base/max`, `sync.pl_push`, and dated `price.seasonal_min` / `stay.min_stay` (overrides API). Rules: applied or drift + match → Verified; applied or verified + mismatch → Drift (once, no repeats); planned/retired untouched; notes (`{text}`) and non-PriceLabs keys are left to people. Missing overrides inside a lead-time fallback window (a min stay with `fallback_after_days` on the same dates) are expected, not drift.
5. Agent path: setup skills write `ProposeSettingChange` drafts; humans approve; agents apply only PriceLabs (API) items.
6. Performance after changes (Outcome step): next.

## Open questions
- HK332 is `managed_by = hostpricing` in the Hub. Should it be `revfactor`?
- Should owners see the Setup tab in the portal (read-only), or only a summary in the monthly report?
- One ChangeSet per approval message, or per plan section?
