# RF-AUTO-001 — Federico commercial approval packet

**Status:** Decision required. Nothing in this document is business approval until Federico records an explicit choice.

**Scope:** These four decisions are the only commercial-policy blockers before a separately approved Stripe Test integration stage. PR #42 remains Draft, inert, and unwired.

## Decision brief

| # | Decision | Recommended choice | What approval means |
|---|---|---|---|
| 1 | Billing timing | **Collect the $150 onboarding fee at checkout.** For a future service-start date, start recurring billing on that signed date. For immediate service, collect the first recurring month at checkout as well. | Scheduled checkout proves a paid $150 invoice plus a trialing subscription whose `trial_end` exactly matches the signed service-start date. Immediate checkout proves a paid invoice for $150 plus the exact signed first month and an active subscription. |
| 2 | Quantity changes | **Require an amended and re-signed agreement for every primary or child quantity change.** | No operator or client can change checkout quantities directly. A new agreement revision creates a new signed entitlement and supersedes the prior revision. |
| 3 | Tax treatment | **Keep checkout blocked until RevFactor's accountant or tax counsel approves the treatment and the required Stripe tax configuration.** | The system does not infer tax-exempt status, enable automatic tax, or create a checkout when the tax policy is unresolved. Approval must specify taxable products/services, jurisdictions/nexus, customer evidence, and whether Stripe Tax will be used. |
| 4 | Exception approver | **Federico is the sole named approver initially; delegation requires a later written policy change.** | Exceptions enter an owned-exception state, never trigger Assembly automatically, and require an auditable approval tied to the agreement revision and onboarding run. Approval does not permit price/quantity substitution or bypass payment truth. |

## Federico response

Federico can approve the recommended package with:

> I approve RF-AUTO-001 decisions 1–4 as recommended in `RF-AUTO-001_FEDE_COMMERCIAL_DECISIONS.md`.

Or record changes in this exact form:

1. Billing timing: **Approve recommended / Change to:** …
2. Quantity changes: **Approve recommended / Change to:** …
3. Tax treatment: **Approve fail-closed pending professional determination / Professional determination attached:** …
4. Exception approver: **Federico / Named approver and backup:** …

## Guardrails that do not change with these choices

- GHL remains the client journey for agreement, intake, and reminders.
- Stripe remains payment truth; browser-supplied prices or quantities are never authoritative.
- RevFactor Hub owns idempotency, audit, guarded synchronization, and the final Assembly gate.
- Assembly cannot start until payment is verified, onboarding is finally submitted, the current agreement revision is active, and no conflict or exception is open.
- Approval of this packet does **not** authorize merge, deployment, migration application, Stripe Test/Live resource creation, public routes, messages, agreements, GHL/Assembly workers, or production effects. Each requires a new approved implementation scope.
