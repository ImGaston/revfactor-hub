# Paid onboarding → Assembly → RevFactor Hub

Production Cloudflare Worker: `revfactor-assembly-payment`.

The published GHL workflow `RF PAYMENTS | Initial invoice paid → Assembly client`
(`eb99eb67-6091-490f-a932-5e13b0fdb97b`) posts native invoice URL and contact ID to
`/ghl/initial-paid`. The Worker independently verifies the first live invoice,
creates or reuses Assembly, and then creates or links a Hub client in Onboarding.

## Development and verification

This Worker is a separate npm package and TypeScript project from the Next.js Hub.
Use Node.js 22 or later.

```sh
cd workers/assembly-payment
npm ci
npm test
npm run typecheck
node runtime-test.mjs
npx wrangler deploy --dry-run
```

The runtime test mocks all provider requests, including Supabase, and checks
concurrent delivery, persisted completion, payment exclusions, and deduplication.

## Deployment

The Worker is deployed independently with `npx wrangler deploy` from this directory.
Pushing the Hub repository does not redeploy the Worker. Its current production
deployment already contains this implementation. The Hub's normal deployment
does not need to compile this separate Worker project.

Required Cloudflare secrets:

- `HIGHLEVEL_API_KEY`
- `ASSEMBLY_API_KEY`
- `WEBHOOK_SECRET` (dedicated random bearer shared only with the GHL webhook)
- `HUB_SUPABASE_URL`
- `HUB_SUPABASE_SERVICE_ROLE_KEY`

Configure secrets through Wrangler; never commit their values. The local secret
file, local runtime state, and dependencies are ignored. `/health` exposes only
configuration booleans. `/status?contactId=...` requires the webhook bearer.

Preserve the existing `ACTIVATED_AT` cutoff and Durable Object storage on normal
redeployments. They prevent historical enrollment and preserve external IDs.
To pause, set the GHL workflow to Draft and/or deploy with `ENABLED=false`.

## Behavior and limits

- Accept only fully paid live USD invoices containing the existing $350 primary
  listing product (quantity 1–5) and one $150 onboarding fee. Pricing changes
  require updating the verified product/amount policy.
- Search Assembly by exact email; create company/client only when absent.
  No portal invitations are sent by this Worker.
- Persist provider IDs and reconcile interrupted requests. Do not blindly repeat
  ambiguous Assembly create calls.
- Match Hub clients by identity, preserve existing lifecycle/financial data,
  and use a deterministic primary key for new automatic Hub records.
- Retry transient failures. `rf-assembly-review` or `rf-hub-review` marks work
  requiring review. Successful completion adds `rf-assembly-created` and
  `rf-hub-created`.
- This creates the client record, not property rows, questionnaire runs, Stripe
  billing associations, or invitation emails.

See `../../docs/agent/integrations.md` for the September 10 verification and
integration record. No real financial transaction was used for end-to-end testing;
live Hub create/replay was verified with a temporary synthetic row and cleaned up.
