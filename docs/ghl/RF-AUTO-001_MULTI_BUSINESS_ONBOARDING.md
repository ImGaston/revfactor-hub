# RF-AUTO-001 Multi-Business Onboarding

Status: **implemented as inert Draft/Test code; not deployed, wired, published, or client-facing**.

## Frozen business rules

- One group represents one signer/session and one consolidated Hub/Assembly onboarding run.
- `single` creates one billing account for 1–5 listings.
- `separate_per_listing` creates one billing account per listing. Mixed groupings are deferred.
- The signer must be authorized for every legal business in the group.
- Regular pricing is `$350.00` per listing/month. A server-approved referral code freezes `$320.00` for every account in the group.
- The group has one `$150.00` onboarding fee. Separate mode allocates it exactly as `$75.00`, `$50.00`, `$37.50`, or `$30.00` for 2, 3, 4, or 5 accounts.
- Every immediate-start checkout contains that account's allocated fee plus its first month.
- Child listings and deferred start are not part of this journey.
- Federico approved no tax collection for this checkout on 2026-09-03. Test and
  live entitlements must use the explicit `configured_no_collection` policy;
  `policy_blocked` remains the default and fails closed.
- Stripe Checkout sets `automatic_tax.enabled=false`; it does not infer tax
  exemption and does not accept a browser-provided tax setting.

## Connected-system clarification

The RevFactor GHL sub-account has Stripe connected and contains the native
`$350` Primary Listing and `$150` Onboarding Fee products. That connection is
valid for GHL-native payment elements, but it cannot provide credentials to the
server-created checkout boundary. The Hub adapter therefore remains disabled
until its own Stripe Test credential, account ID, and allowlisted Price IDs are
configured. Separate billing also needs fixed one-time Price IDs for `$75`,
`$50`, `$37.50`, and `$30`; the browser and GHL Opportunity may never invent
those amounts.

The current GHL Coupons inventory was empty during the 2026-09-03 read-only
audit. Referral-code authority for this journey is the Worker's secret
allowlist, not a GHL coupon and not a client-submitted rate.

## Implemented continuation boundary

- The GHL start adapter stores only an opaque, 24-hour resume token in
  same-origin session storage plus a secure `.revfactor.io` cookie so the
  token can survive the intentional `start.revfactor.io` →
  `links.revfactor.io` signing-domain transition.
- The continuation adapter calls `/v2/groups/resume`; it never submits prices,
  quantities, template IDs, Stripe IDs, or payment state.
- The Worker verifies the exact GHL document ID/name/revision, signed/completed
  status, and the bound Contact recipient's `hasCompleted` result.
- Worker-to-Hub checkout and status calls are HMAC authenticated.
- Hub atomically freezes the group, billing account, and entitlement, issues a
  15-minute Ed25519 token, and creates an idempotent Stripe subscription-mode
  Checkout Session.
- Stripe automatic tax and promotion codes are explicitly disabled. The exact
  monthly Price and allocated one-time fee Price come from the server allowlist.
- A signed Stripe webhook plus canonical Session, Subscription, Invoice,
  InvoicePayment/PaymentIntent, line-item, account, environment, amount, and
  currency retrieval is required before the account can complete.
- The Worker advances to the next agreement only after the Hub ledger reports
  provider-verified completion. The final onboarding URL remains deliberately
  unconfigured, so no group can reach Assembly or Hub provisioning yet.

## Authority boundary

The browser may submit only billing mode, signer/contact data, total listing count, ordered legal-business names, and referral code. It cannot submit prices, amounts, template IDs, Stripe Price IDs, GHL Opportunity IDs, agreement/payment state, or provider identifiers.

`freezeOnboardingGroup()` normalizes and freezes the commercial group. The group fingerprint binds the ordered legal names, account topology, pricing program, quantity, allocated fees, and totals. Any replay with a different fingerprint conflicts before a second commercial write.

The Worker stores group and account stages in the existing SQLite-backed Durable Object coordinator. Every post-await transition compares the expected stage and `state_version`. Stable Opportunity names and read-before-create reconciliation prevent a retry from creating a second Opportunity. Ambiguous Opportunity, template, and signing-link outcomes enter read-only reconciliation; they do not run a fresh create path.

## GHL Draft assets

These assets were created without publishing, generating a document, creating a contact, or enrolling a workflow:

| Asset | Exact Draft identity |
|---|---|
| Standard Opportunity contract | `6a9a1854ea613131e9b35b95` — `RevFactor_Service_Agreement_Standard_Opportunity_NATIVE_DRAFT_v4` |
| Referral Opportunity contract | `6a9a19b9ea613131e9b37b7c` — `RevFactor_Service_Agreement_Referral_320_Opportunity_NATIVE_DRAFT_v2` |
| Pipeline | `FI2x1Yz3C9hcuGjoZibx` — `RevFactor Onboarding Accounts — DRAFT` |
| Agreement Pending | `b50d44c9-784d-443f-8108-082a24270484` |
| Agreement Signed | `5ff9962c-a0de-40e2-b635-c6a4557d1dc1` |
| Payment Pending | `3def9760-87b6-4f38-8625-b716aa0b1281` |
| Payment Verified | `d43772d3-0788-4280-808a-64c9e742550c` |
| Complete | `38eabfe8-bae9-4f87-b118-591d4cc4e057` |
| Manual Review | `f6b26db0-95a9-4fe1-b2da-b69c5c8c3ca4` |

Opportunity-field IDs and merge keys:

| Value | Field ID | Merge key |
|---|---|---|
| Legal business name | `Y6JLSEd8m8rfp7dmHFoB` | `{{opportunity.rf_billing_legal_business_name}}` |
| Listing quantity | `OUC3SpR7bGyOpIBKSCL3` | `{{opportunity.rf_billing_listing_quantity}}` |
| Pricing program | `EuJWEDOHBylSTlWP4RQF` | `{{opportunity.rf_billing_pricing_program}}` |
| Monthly rate | `dQHVi4SMhOeCHl3TtULl` | `{{opportunity.rf_billing_monthly_rate}}` |
| Monthly amount | `Gl5XLcEwuHOQFQvxP4aN` | `{{opportunity.rf_billing_monthly_amount}}` |
| Allocated onboarding fee | `N0W3kTwV3jnheKyI36Eo` | `{{opportunity.rf_billing_allocated_onboarding_fee}}` |
| Initial checkout total | `TtHK79VnFpkIvfWYBvn6` | `{{opportunity.rf_billing_initial_checkout_total}}` |

Each template must use non-editable Opportunity merge fields for legal business name, listing quantity, pricing program, monthly rate, monthly amount, allocated onboarding fee, and initial checkout total. Template generation always supplies `opportunityId`; no commercial value is written to the shared Contact.

The template keeps a client-only signature and native GHL audit trail. Its post-sign redirect points to a secured continuation surface. The continuation surface must retrieve the exact GHL document and verify completed/signature provider truth before it asks the checkout boundary to create a session.

## Sequential state flow

```text
Capture signer + group
  -> Account 1 Opportunity
  -> Agreement 1 verified
  -> Checkout 1 provider-verified
  -> Account 1 complete
  -> Account 2 ...
  -> every account complete
  -> one consolidated GHL onboarding submission
  -> one Hub client + N listings + N billing relationships
  -> one run-stable Assembly handoff
```

An abandoned or failed account remains at its current stage. Earlier completed accounts and their provider IDs are immutable. No later account can be skipped.

## Database model

`20260903190000_server_checkout_boundary.sql` is the renamed, canonical-tip-compatible RF-AUTO-001 checkout foundation. `20260903200000_multi_business_onboarding.sql` adds:

- `onboarding_commercial_groups` — one signer/group and final Hub/Assembly binding.
- `onboarding_billing_accounts` — one legal business, GHL Opportunity, agreement entitlement, Stripe customer, and subscription.
- Per-account legal state transitions and immutable commercial authority.
- Per-account active-entitlement uniqueness instead of per-contact uniqueness.
- Billing-account links on onboarding-run listings and final Hub listings.
- A disabled GHL outbox projection enriched with group/account/Opportunity identity.
- An Assembly gate that requires every expected account to be current, exception-free, payment-verified, mapped to its Stripe customer/subscription, and represented by the consolidated onboarding run.

The migration is unapplied. The disposable PostgreSQL rehearsal covers checkout + multi-business forward, transactional rollback, forward-again, 20 concurrent claims, RLS/grants, account isolation, fee allocation, immutability, outbox atomicity, and all-accounts Assembly gating.

## Stripe price allowlist

The server price book now requires two recurring prices (`$350`, `$320`) and five one-time onboarding-fee allocation prices (`$150`, `$75`, `$50`, `$37.50`, `$30`). The signed entitlement and stored billing account select one exact allowlisted allocation. Provider retrieval must match the account, environment, Price IDs, amounts, currency, customer, subscription, Invoice, and PaymentIntent before the account advances.

## Remaining cutover gates

1. Legal review of the allocated-onboarding-fee wording.
2. Configure the approved `configured_no_collection` policy in the isolated
   Stripe Test environment and verify that no tax is added.
3. Configure staging-only secrets and deploy only an isolated Worker with non-production credentials.
4. Run generated-document QA with isolated GHL contacts and Stripe Test resources under a separately approved scope.
5. Capture desktop/mobile evidence for 1–5 single and 2–5 separate flows, standard and referral.
6. Obtain structured review approval for the exact head.
7. Only then replace the old funnel endpoint and publish the new templates/flow.

Production GHL, Stripe, Hub, Assembly, domains, and the current client-facing funnel remain unchanged by this implementation.
