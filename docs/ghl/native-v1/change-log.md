# 2026-09-04 — Native V1 additive property draft

- Business/location: RevFactor / `ErABPRqWbMyIicvzvCFt`.
- Actor: Codex implementation lane, user-approved V1.
- Previous state: older listing/account survey drafts; 21 listing custom fields.
- Changes: added 15 versioned listing fields (36 total), created new survey `VvcWqrwmq7wESZSfFBme`, inserted 23 native controls, hid four routing fields, required property confirmation and cleaning guidance, edited customer copy in the new draft.
- Reason: structured property addresses and stable journey/property identity; reuse confirmed details without the knowledge quiz.
- Verification: official schema API reread, hosted preview without submission, synthetic query prefill, desktop/mobile screenshots, local adapter identity/transport tests.
- Expected impact: additive draft assets only; no published workflow or production routing changes. GHL saved widget URLs are accessible by ID, so DRAFT naming is not protection.
- Rollback: leave assets unlinked and workflows unchanged; preserve fields/evidence. No record/customer effects occurred.
- Related code: root agent's RevFactor Hub V1 journey ledger; local adapter is not installed.
- Remaining work/owner: root implementation lane owns secure hydration, guarded native submit/upsert proof, final slide/conditional UX, native account guide, contact association and E2E release tests. See README limitations.

- Follow-up: grouped the survey into two native slides, required four essential radio choices, added/tested Live→hide launch date and Not live yet→hide listing URL conditions. Created five additive contact progress fields; exact IDs in `evidence/contact-progress-fields.json`. No contact records were written.

### Account guide, same-document proof and simpler minimum stay

- Created five additive contact setup/review fields, IDs in `evidence/account-fields.json`.
- Created account survey `CfTInIn60HazWmPD1Zf9`, two native slides, software guide HTML, required tool statuses, expectations acknowledgement and explicit all-properties final review.
- Verified native custom HTML script persistence and same-document native-input access; detached synthetic submit cancellation only. Saved screenshot/probe source. Replaced diagnostic script with guide text afterwards.
- Added property field `BiJOXBKZzLWgWtJ05iLb` and replaced two weekday/weekend controls only in the new V1 draft with one minimum-stay input. Old schema/surveys preserved.
- Updated both adapters, tests, manifest and deployment gates. No provider record, send, payment, workflow or Assembly write.

### Native host implementation and installation

- Built and installed `rf.native.host.1` into both existing V1 native HTML blocks. Production-origin routes remain disabled pending the allowed pilot.
- Added guarded context hydration, immutable address/ID binding, software reuse, step saves, final acceptance, exact uncertain retries and original-link resume.
- Real browser fixture found footer outside form and GHL Next tracking POST. Corrected guard to native form wrapper, added provider fetch/XHR/beacon/direct-submit blocking; final controlled fixture reached no provider transport writes.
- Verified native click/Enter/requestSubmit interception, native slide values, same-name unit A/B switching, account submitted state, and read-only context email summary.
- Turned native Save Progress OFF in both new V1 surveys. Partial Contacts and Sticky Contact remain OFF; old surveys untouched.
- Replaced all temporary no-network fixture scripts with final production-origin scripts; verified both final widgets have installed guards, disabled inputs without a capability, and no fixture script.
- Added 11 DOM/session tests; both prior adapter test scripts still pass. Copied native artifacts to root worktree `docs/ghl/native-v1` for review. No commit/push.
- No real customer record, provider form submission, charge, message, invitation or Assembly write.
