# Revenue Manager Domain Contracts

This document defines the Phase 0, version 1 contracts used by the RevFactor AI Revenue Manager. The product contract remains `REVFACTOR_AI_SPEC.md`; this file records the implemented formula and schema versions.

## Contract versions

| Contract                 | Version                     | Implementation                     |
| ------------------------ | --------------------------- | ---------------------------------- |
| Property Revenue Profile | `revenue-profile.v1`        | `lib/revenue-manager/contracts.ts` |
| Metric evidence          | `revenue-metric.v1`         | `lib/revenue-manager/contracts.ts` |
| Diagnostic candidate     | `revenue-diagnostic.v1`     | `lib/revenue-manager/contracts.ts` |
| Recommendation           | `revenue-recommendation.v1` | `lib/revenue-manager/contracts.ts` |

Material profile fields carry their value, unit, effective dates, source type/reference, observation time, confidence, verification state, and notes. Metric evidence additionally requires property and stay-date scope, snapshot time, grain, source snapshot, definition version, comparison type, benchmark context, freshness, and exclusions.

## Metric definitions

### `calendar_utilization.v1`

`booked_nights / calendar_nights`

Blocked nights remain in the denominator. A period with zero calendar nights returns `null` rather than zero.

### `sellable_occupancy.v1`

`booked_nights / (calendar_nights - blocked_nights)`

Intentionally blocked nights are excluded from the denominator. Booked and blocked states are mutually exclusive in this version. A period with zero sellable nights returns `null`.

### `minimum_price_exposure.v1`

`available_nights_at_configured_minimum / available_nights`

Booked and blocked nights are excluded. A night is considered at the minimum when its recommended price is less than or equal to the configured minimum. Until PriceLabs availability/status semantics are resolved, source-supplied exposure values remain labeled observations rather than recomputed canonical metrics.

## Reconciliation definitions

### `source_precedence.v1`

Choose among current observations first, then use the source hierarchy from the product specification; within one source tier, use the latest observation. Stale observations remain visible even when superseded.

### `reservation_reconciliation.v1`

An import identity is `source + source_record_id`. Re-importing the same identity replaces its observation rather than appending another record. A semantic fingerprint detects source-native duplicates without erasing them. The fingerprint currently uses raw status, booked date, check-in, check-out, nights, and rental revenue. Duplicate issues use a stable key, so importing the same export twice produces one issue.

Native statuses and revenue measures remain separate. In particular, Hospitable `host_revenue` and PriceLabs `rental_revenue` are never added together or compared with a target that lacks an explicit measure and period.

## Guardrails

- A discount action that overlaps a `discount_prohibited` protected date returns a constraint conflict.
- Invalid inventory counts fail rather than being coerced.
- Missing values remain `null`; absence is not converted to zero.
- The Ashwood fixture is aggregate and sanitized. It contains no address, external listing ID, guest identity, reservation code, contact detail, or credential.

## Verification fixture

`lib/revenue-manager/fixtures/ashwood.v1.json` captures the sanitized Phase 0 evidence and expected reconciliation values. `lib/__tests__/revenue-manager-domain.test.ts` verifies acceptance scenarios C–F plus the protected-date and minimum-price guardrails. The fixture is not a live source and must not supersede a newer direct snapshot.

## Read-only review slice

The first local review slice builds a contract-validated Property Revenue
Profile and four metric-evidence records from the sanitized Ashwood fixture:

- 15-day PriceLabs adjusted occupancy versus its stated market benchmark;
- 15-day minimum-price exposure;
- historical calendar utilization; and
- historical sellable occupancy.

`lib/revenue-manager/orchestrator.ts` applies deterministic materiality and
data-quality gates. Ashwood currently ends in `data_blocked`: its 90% versus
22% close-in pace and 66.7% minimum-price exposure are material, but the
adjusted-occupancy definition/market cohort and forward sellable-inventory
semantics are unresolved. The result explicitly proposes no commercial action
and identifies the next safe evidence work. If those semantics are resolved,
the same inputs advance only to a focused human review of the floor,
last-minute discount, and date overrides; they do not imply a base-price
change.

Persistence boundaries live in `lib/revenue-manager/persistence.ts` and
`repository.server.ts`. Structured recommendation JSON is serialized and
hydrated through an explicit contract rather than an untyped blob. The server
repository is read-only and reports migration 075 as unavailable when its
tables do not exist.

The internal `/revenue-manager` preview uses the sanitized fixture only. It is
permission-gated by `revenue:view`, labels its source mode, exposes Today,
Profile, Decisions, and Evidence views, and has no mutation action or external
write path.
