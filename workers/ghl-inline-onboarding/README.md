# GHL inline onboarding adapter

This Worker is the same-tab adapter used by the RevFactor GHL start page. GHL remains the client-facing surface and the owner of the agreement/signature experience. The adapter performs only the minimum server-authoritative work that the browser cannot be trusted to do:

- normalize and validate the immediate-start, primary-listings-only request;
- resolve an optional referral code against the server-side allowlist;
- calculate either the standard `$350` or referral `$320` monthly rate with the unchanged `$150` onboarding fee;
- write the canonical GHL contact fields;
- create or reuse the matching native GHL agreement and return its signing link.

## Draft/Test bindings

The staging configuration points to these unpublished native GHL templates:

- standard: `6a919f20ede3dcd490eee0c9` (`RevFactor_Service_Agreement_Standard_Immediate_Start_NATIVE_DRAFT_v3`)
- referral: `6a91a6095a4408090a88e8f4` (`RevFactor_Service_Agreement_Referral_320_NATIVE_DRAFT_v1`)

`HIGHLEVEL_ONBOARDING_REFERRAL_CODES` is a comma-separated Worker secret. Never place referral codes in `wrangler.jsonc`, the GHL page, browser JavaScript, logs, or screenshots. A blank code selects standard pricing; an unknown non-empty code fails closed.

The `/quote` route validates the code and returns calculated display totals without calling GHL. The `/` route creates the contact-specific agreement link. Child listings and deferred starts are rejected and require separately approved onboarding paths.

## Release boundary

This source is inert until a reviewed Worker deployment and a separately reviewed GHL custom-code update. A code merge does not authorize deployment, template publication, client submission, agreement generation/send, payment, workflow publication, Hub/Assembly mutation, or AI activation.
