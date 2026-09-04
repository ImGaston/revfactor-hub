# Native GHL V1 deployment and recovery

Production remains disabled. No production migrations, production deployment, customer entry links, payment setup or live invitations have been changed by this branch. The GitHub draft PR has a successful protected Vercel preview build; its deployment protection prevents unauthenticated browser endpoint testing. GHL provider changes are additive native draft assets documented in the separate GHL workspace.

## Credential/deployment discovery

The connected Vercel account exposes `revfactor-onboarding-app` with Assembly and Stripe production secrets already configured (values were not read). Granola is absent there. Vercel refuses export of the production Secret values. The Hub project is `gastons-projects-2e2a16eb/revfactor-hub`, outside the connected account, so its deployment/secret access remains unresolved. Do not relink this Hub checkout to the existing onboarding app: that would replace a different application.

## Configuration and deployment

1. Review/apply new migrations in filename order to an isolated staging database with the legacy Hub schema present. Run the rollback SQL suite in `scripts/tests/ghl-onboarding-v1.sql`. Never use a production DB for destructive fixture bootstrap.
2. Configure server secrets and IDs from `onboarding-v1.env.example`. Set the real post-payment GHL owner and Hub team profile (Fede fallback) deliberately. Do not infer a person from their name.
3. Keep all enablement flags false on initial deployment. The Hub is on Vercel Hobby, which rejected five-minute cron definitions during the first preview attempt. The branch preserves existing daily crons and provides `scripts/ghl-onboarding-v1-tick.mjs` for an external deterministic scheduler (for example, the existing Atlas operations host). Configure that runner every five minutes only after credentials and gates are ready. No external schedule is installed yet; inactive handlers do not access provider/customer state.
4. Prove real native agreement field IDs for legal name and every property address. `GHL_V1_CONTRACT_FIELDS_JSON` is `{legalNameFieldId,propertyAddressFieldIds}`. If IDs vary across templates, implement a reviewed template-specific map before launch. No unverified aliases are accepted.
5. Prove the actual Stripe PaymentIntent metadata key correlating to the bound GHL invoice, initial invoice item amounts/quantity/price IDs, exact USD totals and test/live modes. A native draft/template label does not make a payment a test payment.
6. First deploy/test the Assembly Custom App compatibility change: the legacy app reads only `draft_payload`, can reconstruct blank answers, reopen old questions, and trigger PDF publication. V1 must render accepted data read-only, reject legacy writes, and keep the internal queue usable. Leave `GHL_V1_PORTAL_COMPATIBILITY_VERIFIED=false` until that is proven; the worker will not claim/invite without it. Prepare Assembly company text custom fields for the owner external key and itemized property identity. Configure their API keys, plus the correct portal. Existing email/company ambiguity goes to review. Do not bypass that review to force a match.
7. Use exact native GHL host origins for CORS. Mount the secure adapter where it can safely hydrate/intercept the native controls. Keep token in fragment only until POST exchange, then memory; no URL query PII or browser storage. No raw note/contract/customer payload logging.
8. Enable in staging only after the native host/submit interception is proven. Run all pilot cases in `PROJECT-PLAN.md`, then cut over the agent SMS entry link and approved native workflow routers. Existing published flows remain untouched until this evidence exists.
9. Only enable Granola after private API keys and the trusted appointment mirror are ready. See `granola-importer.md`. A workspace key may not cover private rep notes. No folder filing is required.

## Private integration commands

POST `/api/webhooks/highlevel/onboarding-v1` with `Authorization: Bearer GHL_V1_WEBHOOK_SECRET`. Strict schemas are in `service.server.ts` and `control.server.ts`.

- `begin`: verify CRM contact email/name, opportunity/contact/location/pipeline, and assigned sales appointment first; create once for contact+appointment, confirmed properties and initial legal business. A repeat returns existing identity; it never creates a second onboarding. Save the original capability server-side securely for the native link. Lost links can be renewed after payment.
- `assisted_billing`: before binding, split properties into distinct legal/billing accounts. Each property exactly once, exactly one fee-bearing account.
- `bind`: bind account to exact document, invoice and PaymentIntent IDs. Never select “latest invoice.”
- `verify_payment`: authenticated provider reads; all accounts must pass before questionnaire writes are allowed.
- `property` also permits pre-signature corrections while still in signup with no bound agreement. After binding, signed address changes require review.
- `property`, `preferences`, `account`, `submit`: revisioned/idempotent changes; explicit final submission is the only invitation trigger.
- `status`: return client-safe state and current revision.
- `pause`: human takeover, opt-out, cancellation or signed-scope correction. Invalidates the capability and stops queued work. Already-issued provider requests cannot be unsent.
- `renew_link`: rotate a capability for an unpaused, paid onboarding using expectedRevision; old links stop working. It does not send the new link.

POST `/api/public/highlevel/onboarding-v1/context` or `/save` with capability bearer and allowed Origin. Browser commands cannot bind/verify payment, operate another journey, change stable IDs, or edit signed addresses. A hidden property ID is data, never authority. On 409 refresh and review, rather than overwriting.

## Native recovery workflow to wire before cutover

The schedule below is the approved policy; native reminder assets/entry wiring are not yet installed by this branch.

- After 24h without progress: remind about the current incomplete step, using the same journey and a valid secure resume link.
- After 72h without progress: second and final automated reminder. Maintain a durable journey-scoped delivery receipt; reopening a form must not reset the two-message cap.
- At 7 days: create a human follow-up for the current GHL owner. Salesperson owns prepayment; configured post-payment owner/Fede fallback owns later stages.
- Before each send re-read authoritative stage, human takeover, channel opt-out and delivery receipts. Stop on cancellation/opt-out/takeover/completion. Never resend a contract, create a new payment or resend an Assembly invitation as a generic reminder.
- No Granola note is a reason to block signup. Ambiguous/late matching is an internal review case.

## Observability and recovery

Inspect journey revision/stage/exception, event receipts, worker jobs, portal checkpoints and owned exception records using authorized server access. Raw commercial payloads are super-admin only; client endpoints never expose them. Contact progress fields are projections only.

Worker jobs lease for five minutes. Successful bounded provisioning phases do not consume the failure budget; five failures create review. Unknown POST/invite results persist intent and require exact reconciliation. Activation polling is read-only and opens a human exception after seven days.

For a stuck case: check the exact bound commercial references, immutable accepted snapshot, checkpoint intent and actual Assembly identity before retry. Preserve receipt/job IDs. Repair the cause and deliberately requeue only the failed step. Never clear a checkpoint to “try again.”

Rollback: disable the relevant feature gates, restore the prior agent entry link, leave ledger/checkpoints intact for reconciliation, and preserve the new GHL drafts. Do not delete state for an invitation/payment that may already exist.

## Future agents

The versioned journey and event log provide context for later Grokbot/LLM steps. Start with internal suggestions (missing information, drafted follow-up, mismatch explanation). Any accepted action must pass the same schema, identity, expectedRevision, permission and provider-truth checks. No LLM is used in this V1 runtime path.

## Provider references

- [HighLevel document list and fillable fields](https://marketplace.gohighlevel.com/docs/ghl/proposals/list-documents-contracts/)
- [HighLevel contact appointments](https://marketplace.gohighlevel.com/docs/ghl/contacts/get-appointments-for-contact/index.html)
- [HighLevel opportunity](https://marketplace.gohighlevel.com/docs/ghl/opportunities/get-opportunity/)
- [Assembly OpenAPI](https://assembly.com/docs/api-reference/openapi.json)

## Assembly application review artifact

See [compatibility provenance and release gates](assembly-v1/COMPATIBILITY.md) and [patch](assembly-v1/assembly-v1-compatibility.patch). The patch is against captured current working files in the separate app, not a verified production source snapshot. It has 12 passing targeted tests plus TypeScript/ESLint. Reconcile the deployed source before release. The existing team screens do not yet support V1 operational tasks; implement and test team review/verification before launch. Keep `GHL_V1_PORTAL_COMPATIBILITY_VERIFIED=false` until the deployed client experience passes the documented synthetic pilot.
