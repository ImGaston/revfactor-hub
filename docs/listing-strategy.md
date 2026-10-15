# Listing strategy tabs

Status: shipped 2026-10-14. The listing page has top-level tabs: **Legacy** (the original page), **Strategy**, **Goals**, **Comps**, **Events**, **Listing Audit**. Each new tab loads its data when opened.

## Tabs
- **Strategy:** open questions (owner / Fede / ops; choice, number or text; answers become decision lines; `feeds = 'floor_payout'` updates the plan's payout floor), the payout floor → PriceLabs minimum, plan vs live table, plan basics (base, max, booking window), seasons editor, suggestions and channel math (`PricingPlanTab mode="strategy"`), and **Approve plan**.
- **Approve plan** needs every `required_for_approval` question answered. It marks the plan approved and creates one `setup` adjustment (origin internal) whose message lists every change from live plus the decisions. Editing an approved plan reopens it as a new draft version.
- **Goals:** break-even and owner goal anchors, then KPIs, revenue by month with expected pickup, booking curve, owner economics and editable monthly goals with pace (`PricingPlanTab mode="goals"`). "Save goals to the plan" stores `targets`.
- **Comps:** comp-set rule, Report Builder market rows for the listing (market nightly, occupancy, RevPAR, index), editable data points.
- **Events:** event / dates / rule / status rows stored on the plan.
- **Listing Audit:** the latest non-archived listing review for the listing: score, parts, grades, published / sent dates, owner decisions and apply status, link to the review.

## Data
Migration `20261014120000_listing_strategy_plans.sql`: `listing_pricing_plans` (one row per listing, versioned, jsonb channels/seasons/targets/anchors/comps/events/rules), `listing_plan_questions`, `listing_plan_events` (append-only: ProposePricingPlan, UpdatePricingPlan, AnswerPlanQuestion, AddPlanQuestion, ApprovePricingPlan, ReopenPricingPlan). RLS on `listings:*`. Actions: `app/(authenticated)/listings/[id]/strategy-actions.ts`. Helpers: `lib/listing-strategy.ts`.

## Pricing math (shared by Strategy and Goals)

Prototype the tab was built from: the "RevFactor Pricing Planner" artifact (Jacob Raabe and Kasey Booth drafts, Oct 13). Business rules live in wikifactor (`playbooks/goals-and-targets.md`, `playbooks/onboarding-v2.md` setup spec); this file is the technical mapping.

Strategy and Goals need `reservations:view` (they read synced reservations via `getPricingPlanDataAction`); editing needs `listings:edit`.

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

## Next (proposal)

Follows the ontology chain Exception → Recommendation → Decision → Execution → Outcome.

1. ~~Table `listing_pricing_plans`~~ (shipped) (one row per version): `listing_id`, `version`, `status` draft/approved/superseded, `floor_payout`, `base`, `max`, `channels` jsonb (markup, fee, discounts), `seasons` jsonb (dates, PriceLabs min, min stay, check-in/out rules), `targets` jsonb (12 months: occ, nightly rate, open nights), `assumptions` jsonb, `created_by`, `approved_by/at`. RLS on `listings:*` like the listing review tables.
2. ~~Events~~ (shipped as `listing_plan_events`)
3. Approve creates one setup adjustment today; later split it into one adjustment per change so each can be marked live.
4. **Nightly job:** recompute pace and suggestions for listings with an approved plan; surface "behind pace" and "empty month" as exceptions on the dashboard.
5. **Market lines:** when the listing is in the Report Builder, add market ADR / occupancy / RevPAR index to the monthly chart and use them for market support (the third goal anchor).
6. **Owner view:** a simple portal page with targets, pace and what changed; no fee math.

Open: where seasons/events come from (owner list, event-intelligence), and whether targets are stored per listing-month for reporting (goals open question 8).
