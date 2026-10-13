# Ontology: onboarding and the listing review

This is the RevFactor ontology applied to onboarding v2 and the owner listing review (2026-10-12). It follows `codex-brief-phases-0-2.md`:
- **Listing** is the anchor (canonical Airbnb identity).
- State changes only through named, permission-checked actions.
- Every exception follows Exception → Recommendation → Decision → Execution → Outcome.
- Deterministic code computes every number.

Fold this into RM `docs/ontology.md` when phase 0 lands.

## Objects

| Object | Primary key | Source | Links | Read permission | Status |
|---|---|---|---|---|---|
| ListingReview | `listing_optimization_reports.id` | `listing_optimization_reports` | Client (`client_id`), Listing (`listing_id`, `airbnb_room_id`) | `listings:view`; owners only through the portal, published only | built (branch) |
| ReviewCheck | `(report_id, check id)` | `listing_optimization_reports.checks` + catalog `lib/listing-optimization-checks.ts` (`CHECKLIST_VERSION`) | ListingReview | same | built (branch) |
| Suggestion (Recommendation) | `listing_optimization_items.id` | `listing_optimization_items` | ListingReview, ReviewCheck (`check_id`), Adjustment (`adjustment_id`) | same | built (branch) |
| ReviewEvent (Decision/audit) | `listing_optimization_events.id` | `listing_optimization_events` (append-only) | ListingReview, Suggestion | `listings:view` | built (branch) |
| Adjustment (Execution) | `adjustments.id` | `adjustments`, type `listing_content` | Listing/Client | existing | live (type added on branch) |
| AirbnbListingField | `card::field` | `lib/airbnb-listing-fields.ts` (305 editable editor fields, 2026-10-13) | ReviewCheck (`checks[]`) or `recordOnly` reason | code | built (branch) |
| ChannelManager (property of ListingReview) | `listing_optimization_reports.channel_manager` | Airbnb editor settings → property management software | ListingReview; decides where Execution happens | `listings:view` | built (branch) |
| OnboardingRun | `onboarding_runs.id` | `onboarding_runs` | Client | existing | live, not used by GHL-native flow |
| OwnerGoal (per listing) | planned | GHL `revfactor_listings` fields mirrored to Hub | Listing, Client | `clients:view` (financial fields scoped) | planned (wikifactor playbooks/onboarding-v2.md) |

## Actions

| Action | Object | Caller | Tier | Audit | Undo | Implementation |
|---|---|---|---|---|---|---|
| `SubmitListingReviewDraft` | ListingReview | audit agent (API key `listing-optimization:write`) or staff | automatic (draft only) | `SubmitListingReviewDraft` event | Archive the draft | `POST /api/v1/listing-optimization-reports` → `createDraftReport` |
| `PublishListingReview` | ListingReview | staff with `listings:edit` | Fede: publishing approves every suggestion in it; blocked unless every standard check ran | `PublishListingReview` event | `UnpublishListingReview` | `setOptimizationReportStatusAction` |
| `UnpublishListingReview` / `ArchiveListingReview` | ListingReview | staff with `listings:edit` | team review | event | Publish again | same |
| `DecideSuggestion` | Suggestion | owner, via the Assembly portal session token | automatic (publish was the approval) | `DecideSuggestion` event (decision, choice, note) | Owner "Change my answer" until applied | `decideOptimizationItemAction` → `recordOwnerDecision` |
| `MarkOwnerTaskDone` | Suggestion (owner_task) | owner | automatic | event | Owner can undo | same |
| `ApplyListingContent` | Adjustment → Suggestion | team (co-host seat) | team review | adjustment status + `ApplyListingContent` event (trigger) | Re-edit the listing; reopen the adjustment | resolve the adjustment |
| `VerifyListingContentLive` | Adjustment → Suggestion | team with `adjustments:control` | team review | event (trigger) | Reopen | control the adjustment |

No action writes to Airbnb automatically. When `channel_manager` is set, `ApplyListingContent` happens in that PMS (the adjustment message says so), because the PMS sync overwrites direct Airbnb edits.

Skill that produces `SubmitListingReviewDraft` payloads: `~/.claude/skills/revfactor-listing-review/SKILL.md` (Claude), mirrored for Grok from its `listing-score-report` / `revfactor-listing-audit` skills. Agents never call owner or staff actions.

## The chain for the listing review

| Step | Here |
|---|---|
| **Exception** | A standard check with status `fail` or `thin` (e.g. `location.neighborhood` empty). Source `listing_review`, severity from the check's points and section priority. |
| **Recommendation** | The suggestion tied to that `check_id`, with frozen evidence (`current_value`, check note). |
| **Decision** | Publish (Fede), then the owner's accept or decline. Both append-only events. |
| **Execution** | The `listing_content` adjustment, resolved, then controlled. |
| **Outcome** | 1. The 30-day re-audit runs the same checklist. Did the check flip to `pass`? (deterministic)<br>2. Later: the RankBreeze funnel (impressions, CTR, booking rate) vs similar listings, before and after. |

Exception-interface sources to add to `ont_exception` (planned):
- `listing_review.check_failed`, open while the suggestion is pending or not applied.
- `listing_review.partial`: a draft with checks not run.
- `listing_review.owner_pending_7d`: published, no decision after 7 days.
- `listing_review.accepted_not_applied_3d`.

## The chain for onboarding (planned, onboarding v2)

| Step | Example |
|---|---|
| **Exception** | Access not verified by day 4. Goal above market support (from comps). Break-even above market. No booking 7 days after go-live. Setup corrected within 14 days. |
| **Recommendation** | Setup spec drafted from OwnerGoal + comps (numbers from code). Listing review draft. Launch report. |
| **Decision** | Fede approves the spec and target. Owner approves the base target. |
| **Execution** | Setup applied in PriceLabs (human). Go-live stamp (`live_at`). |
| **Outcome** | Pace vs the target curve at day 14 and day 30. RevPAR index vs comps and same time last year. Day-30 re-audit of the listing review. |

## Numbers and text
- Coverage is enforced twice: every Airbnb field maps to a check or an explicit out-of-scope reason (test), and every review must give every check a status before publishing.
- Score, part scores and grades come from `scoreChecks` / `gradeSections` (weights 0.30 / 0.25 / 0.20 / 0.25). Any submitted score is ignored.
- LLMs may write suggestion wording and summaries only.
