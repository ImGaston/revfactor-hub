# Revenue Manager Persistence Review

**Status:** Draft generated for review; migration 075 has not been applied.

**Migration:** `supabase/migrations/075_revenue_manager_persistence.sql`

This review covers the Phase 1 persistence foundation requested by `REVFACTOR_AI_SPEC.md`. It creates internal records only. It does not seed Ashwood, call an external API, change PriceLabs/PMS/OTA state, or expose an external write function.

## Schema summary

| Table                             | Purpose                                                                         | Primary durability rule                                                              |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `revenue_property_profiles`       | Versioned evidence-backed property profile                                      | One current version per listing; current content is immutable                        |
| `revenue_strategy_versions`       | Versioned objective, constraints, pricing, distribution, and measurement policy | One approved version per listing; approved content is immutable                      |
| `revenue_review_runs`             | Frozen review scope, sources, diagnostics, and workflow state                   | Profile, strategy, source manifest, and diagnostics freeze when the review completes |
| `revenue_recommendations`         | Structured fact/inference/action proposal                                       | One pending item per listing; submitted content is immutable                         |
| `revenue_recommendation_evidence` | Frozen evidence supporting a recommendation                                     | Append-only and idempotent within a recommendation/source/metric/date key            |
| `revenue_decisions`               | Human approve, decline, defer, or request-changes decision                      | Append-only; the insert atomically advances recommendation status                    |
| `revenue_executions`              | Manual Adjustment handoff and intended/before/observed states                   | One execution per recommendation; V1 mode is manual only                             |
| `revenue_outcome_reviews`         | Expected-versus-actual result and inspectable lesson                            | Requires verified execution; completed outcome is immutable                          |
| `revenue_data_issues`             | Idempotent, blocking-aware data-quality registry                                | Stable listing/issue key with explicit resolution state                              |

All top-level client/listing links use `ON DELETE RESTRICT`. Human confirmation, approval, execution, verification, and review actors are retained with restrictive foreign keys. Mutable owner/assignee references may become null.

## Permission mapping

The existing global permission actions are reused instead of adding revenue-only action names:

| Permission        | Revenue meaning                                                             | Admin default |
| ----------------- | --------------------------------------------------------------------------- | ------------- |
| `revenue:view`    | Read Revenue Manager records                                                | Allowed       |
| `revenue:create`  | Create profiles, strategies, reviews, recommendations, evidence, and issues | Allowed       |
| `revenue:edit`    | Manage drafts and non-terminal records                                      | Allowed       |
| `revenue:delete`  | Reserved; no delete policies exist                                          | Denied        |
| `revenue:publish` | Confirm profiles and approve strategy/recommendations                       | Denied        |
| `revenue:control` | Create/verify manual executions and complete outcomes                       | Denied        |

`super_admin` continues to pass through the existing `has_permission()` short circuit. All other existing roles are seeded fail-closed, then `admin` receives only view/create/edit. This deliberately leaves the Ashwood accountable-approver decision unresolved rather than silently granting approval.

## RLS review

- Every Revenue Manager table has RLS enabled.
- Reads require both `revenue:view` and `listings:view`.
- Creates and updates use `has_permission('revenue', ...)` with the mapped action.
- Authenticated create policies require `created_by = auth.uid()` where the table records an author.
- Decisions require `actor_id = auth.uid()` and `revenue:publish`.
- Executions and outcomes require `revenue:control`.
- There are no `USING (true)`, `WITH CHECK (true)`, or DELETE policies.
- Cross-table trigger checks are `SECURITY DEFINER`, use `SET search_path = public`, and have direct execution revoked. This prevents hidden linked rows from bypassing an integrity check.

Service-role/admin-client operations bypass RLS by design. Any later server action using the admin client must still call the server-side permission helper before mutation, following the repository convention.

## Enforced invariants

- A profile client must match the listing's client.
- A strategy profile, review profile/strategy, recommendation review, data issue review, execution Adjustment, and outcome execution must all resolve to the same listing/recommendation chain.
- Profiles and strategies use explicit lifecycle transitions and immutable approved/current versions.
- Review evidence freezes while the workflow state may continue from recommendation through execution and outcome.
- A recommendation cannot enter a human-decision state without a matching append-only decision.
- A decision is timestamped server-side and atomically advances recommendation status.
- Only an approved recommendation with an approved decision can create an execution.
- Execution identity plus intended/before state cannot change after creation.
- A linked Adjustment cannot become `controlled` until observed state is verified.
- Outcome review requires a verified execution.
- Evidence and decisions reject UPDATE and DELETE even through privileged application clients.

## Index review

The migration includes uniqueness and lookup indexes for:

- one current profile, approved strategy, and pending recommendation per listing;
- version history by listing and review;
- pending confirmations, approvals, decision deadlines, and outcome dates;
- affected stay-date lookup;
- evidence source lookup;
- verification queues;
- open blocking data issues and assigned issue owners.

No speculative JSONB GIN index is added before real query patterns exist.

## Dependencies

Migration 075 assumes these earlier migrations exist:

- clients/listings and profiles;
- `has_permission()` and the current action catalog;
- Adjustments;
- `set_updated_at()` from migration 043;
- Agent Studio `agent_runs` from migration 050.

It does not depend on the uncommitted roadmap migration 074 other than using the next migration number.

## Decisions to confirm before applying

1. Confirm that existing `publish` and `control` are the desired stored equivalents of the spec's approve and execute authority.
2. Confirm that only `super_admin` should approve/control during the first pilot; `admin` is intentionally denied both.
3. Confirm creating all nine durable tables now, even though execution/outcome UI arrives in a later phase.
4. Confirm the strict no-delete posture for all Revenue Manager records.
5. Confirm one pending recommendation per listing and one approved strategy per listing.
6. Confirm V1 execution storage must accept `manual` only; a future tool mode requires a separate migration.

## Provisional local implementation defaults

The following conservative defaults are accepted only for continued local,
read-only implementation. They do **not** approve migration 075 for application
to any database.

1. Reuse `publish` for profile/strategy/recommendation approval and `control`
   for manual execution verification and outcomes. This preserves the existing
   global action catalog and avoids a second, overlapping authority model.
2. Keep approval and control limited to `super_admin` during the pilot. Admins
   may inspect and prepare drafts but cannot approve or control them.
3. Keep all nine tables in one persistence foundation so foreign keys,
   append-only history, and end-to-end invariants can be reviewed together.
4. Keep the strict no-delete posture. Corrections use supersession, status, or
   append-only replacement records rather than erasing decision history.
5. Keep one pending recommendation and one approved strategy per listing. New
   work must explicitly resolve or supersede the active record.
6. Keep V1 execution mode manual-only. Any tool execution requires a separate,
   explicitly approved migration and runtime review.

These defaults are intentionally fail-closed and reversible before schema
application. A human must still approve the migration after target-database SQL
validation and a final diff review.

## Validation performed

- Static migration test verifies all nine tables, RLS, permission seeds, append-only triggers, manual-only execution, verification gating, and absence of an external write path.
- Repository TypeScript checking and the full Vitest suite are run before handoff.
- No Postgres parser or disposable local database is installed in this workspace, so the SQL has not been executed. Target-database lint/application remains intentionally pending schema approval.
