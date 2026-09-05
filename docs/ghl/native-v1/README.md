# Native GHL V1 onboarding

The property and account hosts are **installed in the two native drafts**, with guarded Hub saves. Production Hub routes remain disabled pending the controlled pilot. Existing commercial and older onboarding assets are preserved.

- Property survey: `VvcWqrwmq7wESZSfFBme` — 22 native controls across two slides; signed address reused; one minimum-stay question.
- Software/final review: `CfTInIn60HazWmPD1Zf9` — native software statuses, guide, expectations and explicit final review.
- Native source: `native-host.mjs`, property/account adapters and `dist/*-host.html`.
- IDs, installed hashes and settings: `native-manifest.json`.
- Current installation, configuration, resume semantics and pilot gates: [INSTALLATION.md](INSTALLATION.md).

## Verified

Eleven DOM/session tests cover native footer interception, provider transport blocking, identity binding, corrupted capability handling, revision conflicts, exact retries, saved-state resume and final acceptance. Both adapter test scripts pass.

Actual native-browser synthetic fixtures verified hydration across slides; real final click, Enter and requestSubmit interception; same-name property switching between units A/B; shared account setup and final `submitted` state. No provider request reached the fixture transport after the final guard. Native Next tracking POSTs were blocked separately by the installed provider guard.

Both final installed hosts were checked without a capability: guard installed, native inputs disabled, no fixture code present. The account’s known email appears as a read-only context summary so it is not requested again.

## Runtime boundary

Native GHL fields remain the client input UI. Hub is the canonical journey/property store. Native GHL form submission and object upsert are deliberately blocked; any future GHL object projection must be a reviewed server worker. Hidden IDs cannot authorize a save.

Resume by reopening the original unexpired link, which loads accepted backend state. The capability stays in memory and is removed from the fragment. Native local drafts, sticky contacts and partial-contact creation are OFF on these two V1 drafts. Unsaved edits do not survive reload.

A real allowed pilot save/resume has not run: it requires the agreed test inbox/contact, accessible reviewed Hub deployment, exact CORS origin and pilot allowlist. Contract/payment and Assembly gates remain owned by the backend release process. No customer record, send, payment or Assembly effect was performed by this lane.

## Evidence

`evidence/native-property-host-proof.json`, `native-account-host-proof.json`, `native-email-summary-proof.json`, and `native-host-installed-proof.json` distinguish synthetic flow proof from final installed state. Screenshots and the earlier schema/feasibility evidence are retained in `evidence/`.

## Visual refresh

The scoped presentation layer adds the approved desktop sidebar, mobile progress rail, known-property summary and help disclosure in RevFactor colors. See [design notes](DESIGN.md). Build includes `native-presentation.mjs` and `native-presentation.css`; run `node --test native-presentation.test.mjs` alongside the existing guard tests. The refreshed host hashes are recorded in `native-manifest.json`; `evidence/native-design-final-proof.json` records cold verification of both installed hosts with no fixture present.
