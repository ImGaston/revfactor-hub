# GHL inline onboarding adapter

This Worker is the draft same-tab adapter for the RevFactor GHL start page. GHL remains the client-facing surface and the owner of the agreement/signature experience. The legacy `/` and `/quote` routes remain unchanged for recoverability. The new, unwired `/v2/groups/start` and `/v2/groups/quote` routes add one-business and separate-business-per-property groups.

- normalize and validate the immediate-start, primary-listings-only request;
- resolve an optional referral code against the server-side allowlist;
- calculate either the standard `$350` or referral `$320` monthly rate with the unchanged `$150` onboarding fee;
- atomically freeze one immutable commercial group per signer/contact;
- create one GHL Opportunity and agreement per billing account without writing shared Contact commercial fields;
- preserve a separate agreement, Stripe customer, subscription, and card boundary per account while withholding consolidated onboarding until all accounts verify.

The browser submits only billing mode, signer/contact information, total listing count, ordered legal-business names, and referral code. Rates, fee allocations, totals, template IDs, Opportunity field IDs, Stripe Price IDs, and provider state are server-owned.

## Draft/Test bindings

The legacy route still points to these unpublished native GHL templates:

- standard: `6a919f20ede3dcd490eee0c9` (`RevFactor_Service_Agreement_Standard_Immediate_Start_NATIVE_DRAFT_v3`)
- referral: `6a91a6095a4408090a88e8f4` (`RevFactor_Service_Agreement_Referral_320_NATIVE_DRAFT_v1`)

`HIGHLEVEL_ONBOARDING_REFERRAL_CODES` is a comma-separated Worker secret. Never place referral codes in `wrangler.jsonc`, the GHL page, browser JavaScript, logs, or screenshots. A blank code selects standard pricing; an unknown non-empty code fails closed.

The `/v2/groups/quote` route calculates all per-account values without calling GHL. `/v2/groups/start` creates only the currently actionable Opportunity/agreement and returns an HMAC-authenticated one-hour resume token plus a server-controlled `nextAction`. Child listings, deferred start, and mixed billing groups are rejected.

The V2 staging variables now record the exact unpublished Opportunity-native template, pipeline/stage, and seven Opportunity-field IDs listed in `docs/ghl/RF-AUTO-001_MULTI_BUSINESS_ONBOARDING.md`. The HMAC resume secret and referral-code allowlist remain absent; `/v2/groups/start` therefore fails closed until separately authorized staging secrets are configured.

## Replay and concurrency contract

`AGREEMENT_CLAIMS` is a SQLite-backed Durable Object namespace. Legacy calls remain keyed by contact. V2 groups use `group:<contactId>` and persist one group claim plus ordered account claims. The group SHA-256 fingerprint binds billing mode, ordered normalized legal names, total quantity, pricing program, monthly rates/amounts, and the exact `$150` fee allocation.

For separate mode the allocations are exactly `$75`, `$50`, `$37.50`, or `$30` for 2, 3, 4, or 5 accounts. The first incomplete account alone is actionable. Provider-verified progress must move it through agreement, payment, and completion before the next account can be prepared; the public handler cannot call that trusted progress RPC.

The Durable Object persists each action state before crossing the GHL network boundary:

| Stored stage | Permitted next external operation |
| --- | --- |
| `claimed` | Read-only preflight document scan |
| `preflight_clear` | One commercial-field write |
| `commercial_written` | One native-template generation request |
| `template_reconciling` | Atomically claim `template_reconcile_scanning`; only that generation performs the read-only draft lookup |
| `draft_found` | One link-generation request |
| `link_reconciling` | Atomically claim `link_reconcile_scanning`; only that generation performs the read-only sent-document lookup |
| `completed` | Return the stored canonical document ID and signing URL without commercial rewrites |

A different revision for the same contact fails before commercial mutation. Every transition is a SQLite compare-and-swap over fingerprint, expected prior stage, and monotonic `state_version`. Post-I/O results therefore apply only while their exact operation generation still owns the row. Ambiguous GHL outcomes remain in reconciliation-only stages and use bounded, redacted result codes; they never reopen the create path. A stale takeover rotates `state_version`, so the original late response cannot regress state or claim a new completion. The current version deliberately supports one immutable agreement revision per contact; amendments require a separately reviewed lifecycle design instead of overwriting the existing claim.

Every preflight and reconciliation scan paginates the complete GHL location document inventory with `limit=50` and increasing `skip`. It requires a stable, safe-integer `total`, caps the scan at 20 pages / 1,000 documents, rejects missing or drifting totals, incomplete pages, over-counts, and duplicate/missing document IDs, and fails closed before commercial mutation whenever completeness cannot be proven. Read-only `preflight_scanning` may be safely restarted after 15 seconds; the mutation-bearing `commercial_writing` stage remains fail-closed/manual.

The conflict-only legacy inventory is intentionally explicit:

| Historical GHL template ID | Recognized document/template name |
| --- | --- |
| `6a88b36bf6fb5d14abd2fbfe` | `RevFactor_Service_Agreement` |
| `6a89a4cff6fb5d14abe08d13` | `RevFactor_Service_Agreement_With_Child_Listings` |
| `6a91927a8217f6dcbf68b3f9` | `RevFactor_Service_Agreement_Standard_Immediate_Start_DRAFT_v2` |

An exact historical name or the Worker-generated form `<name> — …` blocks a new claim in draft, sent, viewed, completed, signed, or accepted state. These templates are conflict evidence only and can never be selected for new generation.

Executable Worker tests use the Cloudflare Vitest pool and mocked GHL endpoints to prove concurrent identical-request collapse, standard/referral conflict isolation, exact-replay immutability, changed-legal-name rejection, page-two conflict/reconciliation discovery, incomplete/drifting/duplicate page-set rejection, all inventoried legacy agreement classes and open/completed states, barrier-synchronized template/link reconciliation, single semantic completion/tagging, stale-owner fencing, stale preflight recovery, and recovery from a committed-but-unacknowledged and temporarily unlistable GHL draft.

Run them from this directory with:

```sh
../../node_modules/.bin/vitest run --config vitest.config.ts
```

## Release boundary

This source is inert until a reviewed Worker deployment and a separately reviewed GHL custom-code update. A code merge does not authorize deployment, template publication, client submission, agreement generation/send, payment, workflow publication, Hub/Assembly mutation, or AI activation.
