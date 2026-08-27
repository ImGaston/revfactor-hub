# RF-AUTO-001 — Server Checkout Boundary (Draft/Test Review)

Status: **Draft/Test only; migration 088 is unapplied; no route, worker, provider client, or feature flag is enabled.**

This slice replaces the unsafe authority model of the existing draft checkout bridge. Browser/GHL values do not select prices or quantities. A short-lived Ed25519-signed entitlement identifies one exact agreement revision; the server compares every commercial claim to its stored record, resolves a versioned allowlisted price book, and lets the database own attempt generations and provider-event replay.

The policies below are fixtures only: **PROVISIONAL — NOT BUSINESS APPROVAL.** The one-time fee is $150; scheduled service collects that fee at checkout and begins recurring billing on the service-start date; immediate service includes the first month; quantity changes require a revised agreement; tax is `policy_blocked` outside isolated fixtures; owned exceptions require a named human and cannot trigger Assembly.

## Architecture

```mermaid
flowchart LR
  GHL[GHL agreement and intake] -->|signed agreement revision| ISSUER[Entitlement issuer]
  ISSUER -->|EdDSA JWS, max 15 min| CHECKOUT[Server checkout boundary]
  BROWSER[Browser] -->|signed token only| CHECKOUT
  CHECKOUT -->|compare all claims| ENT[(Agreement entitlement ledger)]
  CHECKOUT -->|resolve version| BOOK[Server price-book allowlist]
  BOOK -->|inspect exact account, mode, product, amount, cadence| STRIPEAPI[Injected provider adapter]
  CHECKOUT -->|claim generation under row lock| ATTEMPT[(Checkout attempt ledger)]
  STRIPEAPI -->|session IDs only| ATTEMPT
  WEBHOOK[Signed provider webhook] -->|retrieve canonical provider objects| RECON[Reconciliation service]
  RECON -->|one atomic transaction| EVENT[(Provider event ledger)]
  RECON --> ATTEMPT
  RECON --> OUTBOX[(GHL sync outbox)]
  OUTBOX -. worker deliberately absent .-> GHL
  ATTEMPT -->|payment is necessary, not sufficient| FINAL[Final GHL onboarding submitted]
  FINAL -->|guarded idempotent candidate| ASSEMBLY[Assembly handoff]
```

## Process and commit boundary

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server boundary
  participant D as Database
  participant P as Injected provider
  participant W as Signed webhook
  participant G as GHL worker (disabled)

  B->>S: Signed entitlement token only
  S->>S: Verify EdDSA, claims, expiry
  S->>D: Load and compare stored agreement revision
  S->>P: Inspect allowlisted prices
  S->>D: Claim attempt generation (FOR UPDATE)
  S->>P: Create/reuse session with DB idempotency key
  S->>D: Attach canonical session ID
  W->>S: Signed event
  S->>P: Retrieve canonical session/subscription
  S->>D: Atomic event + IDs + verified state + outbox
  D-->>S: Commit
  Note over G: No route/scheduler/worker exists in this stage
```

## Legal checkout states

| State family | States | Allowed purpose |
|---|---|---|
| Policy | `policy_blocked`, `eligible` | Fail closed until policy permits a claim. |
| Session | `session_creating`, `session_open`, `session_expired`, `superseded`, `cancelled` | One active generation per agreement entitlement; safe replacement only when no canonical payment IDs exist. |
| Provider verification | `checkout_completed_unverified`, `provider_reconciling`, `payment_verified`, `payment_verified_scheduled`, `payment_failed` | A checkout callback is not payment truth; signed webhook plus canonical object retrieval is required. |
| GHL and billing | `ghl_sync_pending`, `ghl_onboarding_unlocked`, `service_billing_active`, `service_billing_failed` | Outbox-based GHL projection and explicit service-billing state. |
| Owned exceptions | `identity_conflict`, `provider_conflict`, `manual_review`, `revoked` | Human-owned terminal/review paths; never automatic Assembly handoff. |

Transitions are duplicated intentionally in TypeScript and migration 088. Tests check the application reducer, while the database function rejects transitions not present in the locked transition table.

## Authority and replay guarantees

- The checkout function accepts only `entitlementToken` from the browser. There are no browser price, quantity, account, fee, cadence, or tax parameters.
- The entitlement signature is EdDSA; header algorithm/type/key ID, audience, issuer, maximum lifetime, not-before, expiry, agreement hash/revision, quantities, service start, currency, price-book version, and tax policy are validated.
- Signed fields are then compared one-for-one with `agreement_entitlements`; a valid token with stale or conflicting stored state fails.
- The provider price inspection must match the allowlisted Stripe account, live/test mode, active state, product marker, amount, currency, one-time/recurring kind, and monthly cadence.
- `claim_server_checkout_attempt` locks the entitlement row, returns an existing active generation, and creates a replacement generation only from bounded safe states with no payment/subscription IDs.
- Provider events are unique by provider event ID. Reconciliation, canonical IDs, verified state, and the GHL outbox insert commit atomically.
- The webhook reconciliation module imports no GHL or Assembly client. It cannot perform an external action before database commit.
- Migration 088 creates no Assembly trigger or outbox. `buildAssemblyHandoffCandidate` additionally requires a final onboarding submission and an unlocked/active checkout state.

## RLS and grants

All five new tables enable RLS. Authenticated users receive SELECT only and only `super_admin` passes the policy. `anon` and `authenticated` receive no writes. The service role receives the minimum table rights and exclusive execute rights on claim, attach, transition, and reconciliation functions. Every SECURITY DEFINER function fixes `search_path = public`.

## Test and migration rehearsal plan

1. Run unit/structural tests and TypeScript checks without credentials.
2. Apply migration 088 only to a disposable database cloned through migration 087-or-earlier history; verify forward apply, constraints, RLS, grants, and function signatures.
3. Run two concurrent claim transactions for one entitlement; both must return the same active generation and idempotency key.
4. Replay one provider event; the second call must report duplicate and create no second outbox row.
5. Exercise mismatch cases for signature, stored agreement revision, price/account/mode, quantities, tax policy, provider IDs, and service-start state.
6. Confirm migration rollback is drop-only in the disposable database. Production rollback before activation is code/flag removal plus leaving inert ledger tables in place; destructive table rollback requires separate approval.

## Deliberate limitations

- No public route wires these services.
- No real Stripe adapter or test/live Stripe resource is present.
- The inert server price-book loader names five future server-only variables (`RF_CHECKOUT_STRIPE_ACCOUNT_ID`, `RF_CHECKOUT_STRIPE_MODE`, and the three `RF_CHECKOUT_V1_*_PRICE_ID` values); none is configured or read by a route in this stage.
- No migration has been applied.
- No GHL outbox worker exists; `GHL_CHECKOUT_SYNC_WORKER_ENABLED` is `false`.
- No GHL/Assembly production effect, message, agreement, domain, workflow, card, subscription, invoice, or AI action is included.
- Tax policy and immediate-versus-scheduled commercial policy remain Federico decisions before any integration stage.
