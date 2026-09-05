# Controlled onboarding pilot

Status: preparation in progress; no test journey activated yet. User approved the visual drafts and activation/testing on 2026-09-04. Optional onboarding calls are a future enhancement, not a V1 requirement.

## Verified setup

- Deployed `hub.revfactor.io` public client configuration points to `xpfjjcwgbjsdxdhyrcxd.supabase.co`; authenticated Supabase metadata confirms the existing onboarding tables. All seven V1 migrations are now applied with migration history, in one transaction. Verification found zero journeys/jobs and no anonymous review or verification access; see `pilot-database-deployment.json`.
- GHL RevFactor location and three Discovery Call calendars were read successfully. Personal calendars and podcast recordings are excluded.
- The configured GHL post-payment owner and the Hub team profile both resolve to Federico Zimerman. Exact IDs are in the environment example.
- GHL documents API rejected a 100-record page (422: maximum 21); authenticated lookup with 21 succeeded. The backend now uses 21-record pages with a total lookup deadline.
- Assembly production source was recovered and hash-verified from its current Vercel deployment. The compatibility patch is based on that source; 83 tests and a clean production build pass.

- Both native survey hosts are installed with capability guards and native provider writes blocked. Eleven host tests and both adapter scripts pass; actual native-browser synthetic fixtures verified final acceptance, resume and property-unit isolation. See `native-v1/INSTALLATION.md`. This is not real backend pilot evidence.

## Before creating the test journey

1. The user-controlled test inbox is approved in the task; do not ask for it again. Connect deployment access to `gastons-projects-2e2a16eb/revfactor-hub`. On 2026-09-04, the connector returned 403, the CLI listed only the separate personal team, and the signed-in browser returned 404. Credentials belong in the secret store, not this checklist.
2. Prepare the isolated test data/environment (the seven reviewed Hub migrations are already applied), configure verified native contract field mapping and Stripe test credentials/correlation, and prove the payment screen is in test mode.
3. Create the dedicated test contact and its matching sales appointment/opportunity. Record only its nonsecret contact ID in the server setting `GHL_V1_PILOT_CONTACT_IDS`. `GHL_V1_ROLLOUT_MODE=pilot` is the default; missing/unknown mode or an empty pilot list blocks enrollment.
4. The native hosts are installed, pointing to the disabled Hub production routes. Configure the reviewed Hub endpoint with exact CORS origin `https://links.revfactor.io`, deploy the Assembly compatibility release, and verify both before enabling invitation processing.
5. Keep general entry links and broad enrollment unchanged throughout the pilot. Granola summaries are optional and never block onboarding.

## Walkthrough evidence

| Step | Pass condition | Evidence/status |
|---|---|---|
| Salesperson starts onboarding | Exactly one journey; correct contact, appointment, properties | Pending |
| Agreement | Correct legal business and property scope; client-only signature | Pending |
| Test payment | $500 for one standard property; monthly $350 after one $150 setup fee; authenticated invoice/payment correlation | Pending |
| Property review | Address reused; only missing details requested | Pending |
| Save and return | Saved answers restored from same journey; no cross-property overwrite | Pending |
| Need help | Customer can continue; corresponding owned team task | Pending |
| Final review | Explicit submission; immutable accepted answers | Pending |
| Portal handoff | One owner workspace, one invitation, correct property visibility | Pending |
| First login | Portal active independently from software verification | Pending |
| Team verification | Assigned owner reviews actual context; actor/time/evidence recorded | Pending |
| Repeat/interruption | No duplicate invoice, journey or invitation; recovery preserves state | Pending |

Repeat after the first pass with two referral properties ($790 initially, $640 monthly) and assisted separate businesses/cards with one setup fee across the group. Keep provider IDs and customer information in the private test ledger, not in public screenshots or a PR.

Signed scope update: a separate unrouted Q1 pilot agreement now has required business/property fields and the existing client-only signature. Pricing is unchanged. Known-data prefill, completed-document API IDs/values and actual payment test mode remain unproven; see [pilot contract evidence](pilot-contract-scope-evidence.md). Keep this template unrouted until those checks pass.

## 2026-09-04 continuation evidence

- Assembly compatibility is deployed to protected preview `dpl_VrAMmWj7bd3wMDiScBdkMTUPapJb`; [preview deployment](https://vercel.com/federico-zimermans-projects/revfactor-onboarding-app/VrAMmWj7bd3wMDiScBdkMTUPapJb). All 90 uploaded source files match the reviewed manifest. Runtime uses production session enforcement and the independently confirmed Hub database. Payment, contract-send, GHL mutation and notification credentials are blanked only for this deployment. This restricted preview must not be promoted with those overrides.
- Deployed readiness confirms Hub/schema access; payment/contract/notification readiness is deliberately false. Missing-session `/api/onboarding` returns 401, and the browser displays “Open this app from Assembly.” This is not an authenticated accepted-V1 walkthrough.
- Assembly production alias remains on `dpl_F4CSKrTjiyhNuHGJp4y7PXw9nhu7`; no production promotion occurred.
- The approved inbox matches an earlier GHL pilot contact and an existing Assembly client/company. No contact or workspace was overwritten, enrolled, or invited. No matching Hub client email was found; V1 journeys remain zero. Private pilot preparation stores the candidate identity and one stable invented-property UUID outside the repository. Existing Assembly identity must be reconciled before any invitation.
- A separate unsent, recipient-free GHL draft proves sender-entered property/business values survive save and render in native preview. It does not prove automatic journey-to-document prefill, recipient signature, payment mode or invoice correlation. See the contract evidence document.
