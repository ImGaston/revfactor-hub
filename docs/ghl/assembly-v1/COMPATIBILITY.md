# Assembly V1 compatibility patch — review artifact

This patch adapts the existing Assembly operational Custom App to an already-accepted GHL V1 onboarding record. It does not change `/start`, signup, checkout, or recreate a customer questionnaire.

## Baseline and deployment provenance

- Source checkout: `/Users/fedezimermacbookpro/Documents/Codex/2026-07-01/hi/work/revfactor-onboarding-app`.
- Git HEAD: `60fd783d8b4c09287ca2914bfd9a236d7aa8f075`, branch `main`, **no Git remote**.
- Current checkout has 63 modified/untracked files. This artifact is based on the three current working files recorded in `compat-baseline.json`, not on a claim that HEAD alone is deployed source.
- Read-only Vercel inspection on 2026-09-04 resolved production to `dpl_F4CSKrTjiyhNuHGJp4y7PXw9nhu7`, project `prj_lUfk2kJlOQUjhmr9qrxLB3zs0Rox`, deployed Aug 25 from CLI. Metadata reports the same Git SHA and `gitDirty=1`; the deployed dirty source contents are **not verified**.
- Project aliases include `onboarding.revfactor.io` and `revfactor-onboarding-app.vercel.app`. Do not deploy a Hub checkout to this project.
- Original working files were not edited. Their captured SHA-256 hashes still match. Only required tracked dependencies were copied; untracked dependency source and node_modules are read-only links used for local verification. Do not publish this working directory or its baseline folder wholesale.

## Why this is necessary

The old client loader only selects `draft_payload`; it fabricates a legacy version-2 form from defaults even when a run is submitted. The old UI then recomputes submission from its legacy questions and keeps Assembly fields editable. A colon in a V1 run key also fails the old run-ID schema. The internal queue likewise tries to parse the V1 snapshot as legacy form state. Finally, GET generates a launch PDF for submitted legacy state.

Simply making the new run key use a hyphen does not fix those problems. Generating dummy legacy answers would misrepresent what the client supplied.

## Changes

- Detect the explicit `rf.onboarding.v1` payload or `ghl-v1-` / `ghl-v1:` run prefix before legacy parsing.
- Validate and project the accepted property/software snapshot into a read-only summary. No form fields or legacy autosave run for this view.
- Return the V1 view before legacy GET PDF generation/upload.
- Reject legacy saves, attachment changes, and old task-verification calls for V1 runs. Owner-assigned software follow-up rows persist in the Hub database; a usable V1 team task UI and verification path remain a separate launch gate.
- Filter V1 runs out of the legacy Assembly internal queue before parsing, preserving legacy rows. The existing Hub `/onboarding` screen also reads legacy progress/templates rather than the new run tasks; do not describe V1 team review as implemented.
- Preserve ordinary legacy onboarding behavior for legacy records.

## Verification and release gate

Passed locally: 12 targeted tests, TypeScript check, and targeted ESLint. Tests cover both key formats, redacted accepted data, no PDF/upload on GET, no legacy mutation RPC, malformed-record fail-closed behavior, mixed internal queues, and a rendered summary with no questionnaire inputs.

A canonical remote and deployed dirty source must be recovered/reconciled before applying this patch to a production release. Apply `assembly-v1-compatibility.patch` only after comparing the baseline hashes; inspect all changes against the actual deployed source. No PR was created because there is no remote. No deployment, Assembly write, or live client action was performed.

The customer summary alone does not finish the team handoff: implement and test the V1 operational task review/verification path before launch.

Before setting `GHL_V1_PORTAL_COMPATIBILITY_VERIFIED=true` in the Hub, test the installed Assembly Custom App with an actual synthetic V1 account: correct company/property visibility, accepted summary, Messages navigation, no re-entry prompts, no PDF side effect, no save POST, and unchanged legacy client/internal experiences. The portal's active deployment must include this compatibility behavior or an independently verified equivalent.
