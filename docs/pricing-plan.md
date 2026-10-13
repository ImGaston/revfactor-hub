# Pricing plan (listing tab)

Status: v1 shipped read-only (2026-10-13). Phase 2 (saved, approved plans) is proposed below and needs Fede's approval plus a migration.

Prototype the tab was built from: the "RevFactor Pricing Planner" artifact (Jacob Raabe and Kasey Booth drafts, Oct 13). Business rules live in wikifactor (`playbooks/goals-and-targets.md`, `playbooks/onboarding-v2.md` setup spec); this file is the technical mapping.

## v1: what the tab does

`/listings/[id]` → **Pricing plan** tab (needs `reservations:view`). Data loads when the tab opens (`getPricingPlanDataAction`), never with the page.

- **Source:** `pricelabs_reservations_cache` rows for the listing (`hub_listing_id`), stays from the last ~400 days plus everything on the books. No guest names or confirmation codes are selected.
- **Math:** `lib/pricing-plan.ts` (pure, tested in `lib/__tests__/pricing-plan.test.ts`).
  - Payout share = (1 + markup) × (1 − discount) × (1 − channel fee). Airbnb applies one length-of-stay tier, or an early-bird / last-minute deal if larger; Booking.com and coupon promos stack.
  - PriceLabs minimum = owner payout floor ÷ the tightest channel's share with its deepest discounts, rounded up to $5. An owner's minimum is a payout after markups and discounts (Fede, Oct 13).
  - Booking curve = share of stayed nights already booked d days before the night (lead times over 730 days are dropped; some PMS rows carry a 1970 placeholder booking date).
  - Pace = nights on the books ÷ (target nights × curve at the month's lead time). "Behind" is under 80% (draft threshold, goals open question 4).
  - Projected finish = on-the-books revenue + target nights not yet expected to be booked × target nightly rate.
  - Owner economics: target revenue is booked nightly revenue, so payout = revenue × (1 − channel fee), weighted by the channel mix from history.
- **Targets:** start from the same month last year (current month includes its remaining on-the-books nights). Editable on screen; not saved.
- **Suggestions:** deterministic rules in `buildSuggestions` (behind/ahead of pace, near-full months to raise, soft months, high-cancel channels, the channel that sets the minimum). AI is not used.
- **Channel settings:** start from `DEFAULT_PLAN_CHANNELS` (RevFactor markup policy: Airbnb 44% / 15.5% host-only fee, Booking.com 31% / 15%, Vrbo 15% / ~14%, Direct 5% / 2%). Editable on screen.

## Phase 2 (proposal): saved, approved plans

Follows the ontology chain Exception → Recommendation → Decision → Execution → Outcome.

1. **Table `listing_pricing_plans`** (one row per version): `listing_id`, `version`, `status` draft/approved/superseded, `floor_payout`, `base`, `max`, `channels` jsonb (markup, fee, discounts), `seasons` jsonb (dates, PriceLabs min, min stay, check-in/out rules), `targets` jsonb (12 months: occ, nightly rate, open nights), `assumptions` jsonb, `created_by`, `approved_by/at`. RLS on `listings:*` like the listing review tables.
2. **Events** (`listing_pricing_plan_events`, append-only): `ProposePricingPlan`, `ApprovePricingPlan`, `RevisePricingPlan` (reason required), `ApplyPricingPlan`.
3. **Approve creates the work:** every difference from the current PriceLabs/PMS settings becomes a pricing adjustment (existing Adjustments flow), so the team applies it and `resolved → controlled` marks it live.
4. **Nightly job:** recompute pace and suggestions for listings with an approved plan; surface "behind pace" and "empty month" as exceptions on the dashboard.
5. **Market lines:** when the listing is in the Report Builder, add market ADR / occupancy / RevPAR index to the monthly chart and use them for market support (the third goal anchor).
6. **Owner view:** a simple portal page with targets, pace and what changed; no fee math.

Open: where seasons/events come from (owner list, event-intelligence), and whether targets are stored per listing-month for reporting (goals open question 8).
