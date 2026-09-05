# Native onboarding visual design

The user approved the reference's desktop progress sidebar and spacious white form panel, adapted to RevFactor branding. The presentation lives inside the two existing GHL survey widgets; it does not add a second onboarding application.

## Layout and interaction

- Cedar sidebar, bone page background, white form panel, readable dark labels and quiet borders. The native widget's existing Inter sans-serif is retained when available; no external font or UI library is loaded.
- Desktop shows five stages: Agreement & payment, Your properties, Connect your tools, Final review, Your portal. Mobile collapses these into a compact current-step label and segmented progress rail.
- Current native slide is read from `.ghl-question.ghl-page-current`, not guessed from visible text or attempted button clicks. Completed stages reflect accepted Hub context. A submitted questionnaire does not mark the portal active.
- Known property identity is a separate read-only summary. Redundant native name/address wrappers are hidden only after trusted hydration; the read-only fields remain in the DOM for the existing native flow. Existing property switching and software continuation controls retain their guarded behavior.
- The desktop sidebar content sticks within its existing survey wrapper as the client scrolls. An accessible disclosure explains how to request help, report a property correction, and resume saved work. It does not imply that clicking Help creates a task or books a call. Optional assistance calls remain future scope.
- Native fields, radio IDs, slide containers, form and footer are retained. The footer remains the form's sibling within the guarded `.ghl-form-wrap`. No provider write, payment, workflow or invitation behavior changes.

## Source and validation

`native-presentation.mjs` supplies progress and the sidebar; `native-presentation.css` is scoped to the guarded widgets. `build-native-host.mjs` bundles both into the existing hosts. The runtime accepts no browser-selected endpoint or executable design input.

Twelve guard/session tests, three presentation tests and both adapter scripts pass. Presentation coverage includes prepayment/no-context state, incomplete property requirements, native slide changes, accepted submission versus actual portal activation, and preserved form/footer containment. Native browser installation and visual results are recorded separately in the evidence directory.

## Review findings

- Native slide visibility must remain provider-controlled. Applied: no generic display override on `.ghl-question`.
- The provider footer is outside the form. Applied: sidebar insertion leaves both nodes in the same parent and preserves capture boundaries.
- Small text and disabled controls must remain readable. Applied: dark labels, visible outlines, 16px editable input text, mobile layout and minimum touch-target sizes.
- Progress must not claim that a software connection is operationally verified. The completion marker refers to this questionnaire step; the help copy continues to promise separate team review.

This design is independent of the unresolved real-payment, production-deployment and end-to-end pilot gates.

Keyboard review caught an existing overly broad Enter guard. It now suppresses default Enter only inside the native form, preserving keyboard activation of Help and property navigation outside it. Footer submission interception is unchanged; a regression test covers both boundaries.

## Installed verification

Both final hosts were saved through the GHL builder and cold-reloaded. The recorded hashes match the build; `rf.native.design.1` and the submission guard are present, while synthetic fixtures are absent. Without a personal capability the native fields are disabled and the blank form/footer are hidden. Enter toggles Help. Actual native-widget synthetic checks preserved the saved property address/read-only fields, selected-property indicator and guarded Next; the account sidebar advanced to Final review. Native provider writes reaching transport remained zero. Desktop (1731px) and mobile (390px) checks found no horizontal overflow. See `evidence/native-design-final-proof.json` and `native-design-*-desktop.png` / `native-design-*-mobile.png`.

## Official brand mark

The sidebar uses the user-provided `RevFactor_Favicon_Bone.png`, preserved unchanged at `assets/revfactor-mark-bone.png`. The build embeds the transparent PNG directly in both hosts, avoiding an external image-host dependency. The placeholder RF monogram is removed. The official mark is contained at 38×51px on desktop and 30×40px on mobile, beside the existing RevFactor name.
