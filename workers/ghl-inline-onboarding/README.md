# GHL inline onboarding adapter

This Worker is the same-tab adapter used by the RevFactor GHL start page. GHL remains the client-facing surface and the owner of the agreement/signature experience. The adapter performs only the minimum server-authoritative work that the browser cannot be trusted to do:

- normalize and validate the immediate-start, primary-listings-only request;
- resolve an optional referral code against the server-side allowlist;
- calculate either the standard `$350` or referral `$320` monthly rate with the unchanged `$150` onboarding fee;
- atomically claim one immutable commercial revision per GHL contact;
- write the canonical GHL contact fields only after that claim wins;
- create the matching native GHL agreement at most once and return its signing link.

## Draft/Test bindings

The staging configuration points to these unpublished native GHL templates:

- standard: `6a919f20ede3dcd490eee0c9` (`RevFactor_Service_Agreement_Standard_Immediate_Start_NATIVE_DRAFT_v3`)
- referral: `6a91a6095a4408090a88e8f4` (`RevFactor_Service_Agreement_Referral_320_NATIVE_DRAFT_v1`)

`HIGHLEVEL_ONBOARDING_REFERRAL_CODES` is a comma-separated Worker secret. Never place referral codes in `wrangler.jsonc`, the GHL page, browser JavaScript, logs, or screenshots. A blank code selects standard pricing; an unknown non-empty code fails closed.

The `/quote` route validates the code and returns calculated display totals without calling GHL. The `/` route creates the contact-specific agreement link. Child listings and deferred starts are rejected and require separately approved onboarding paths.

## Replay and concurrency contract

`AGREEMENT_CLAIMS` is a SQLite-backed Durable Object namespace keyed by the GHL contact ID. The stored revision binds the contact and template IDs, template name/version, normalized legal name, primary quantity, pricing program, monthly rate, monthly fee, onboarding fee, and initial checkout total. The resulting SHA-256 fingerprint is the server-owned idempotency identity.

The Durable Object persists each action state before crossing the GHL network boundary:

| Stored stage | Permitted next external operation |
| --- | --- |
| `claimed` | Read-only preflight document scan |
| `preflight_clear` | One commercial-field write |
| `commercial_written` | One native-template generation request |
| `template_reconciling` | Read-only draft lookup; template generation is never repeated |
| `draft_found` | One link-generation request |
| `link_reconciling` | Read-only sent-document lookup; link generation is never repeated |
| `completed` | Return the stored canonical document ID and signing URL without commercial rewrites |

A different revision for the same contact fails before commercial mutation. Ambiguous GHL outcomes remain in reconciliation-only stages and use bounded, redacted result codes; they never reopen the create path. A stale in-flight create state also advances only to reconciliation. The current version deliberately supports one immutable agreement revision per contact; amendments require a separately reviewed lifecycle design instead of overwriting the existing claim.

Executable Worker tests use the Cloudflare Vitest pool and mocked GHL endpoints to prove concurrent identical-request collapse, standard/referral conflict isolation, exact-replay immutability, changed-legal-name rejection, and recovery from a committed-but-unacknowledged and temporarily unlistable GHL draft.

Run them from this directory with:

```sh
../../node_modules/.bin/vitest run --config vitest.config.ts
```

## Release boundary

This source is inert until a reviewed Worker deployment and a separately reviewed GHL custom-code update. A code merge does not authorize deployment, template publication, client submission, agreement generation/send, payment, workflow publication, Hub/Assembly mutation, or AI activation.
