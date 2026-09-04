# Native host installation and controlled pilot

This document supersedes the original draft-only feasibility notes. The native GHL surveys remain the client input UI. Hub is the canonical property/journey store; this path deliberately never performs a native GHL form submission or custom-object upsert.

## Hosts

- Property: `VvcWqrwmq7wESZSfFBme`, native HTML source `dist/property-host.html`.
- Software/final review: `CfTInIn60HazWmPD1Zf9`, native HTML source `dist/account-host.html`.
- Source module: `native-host.mjs`, composed with the two native adapters by `build-native-host.mjs`.
- Production-origin endpoint: `https://hub.revfactor.io`. Production routes are still disabled pending the controlled pilot. Installing the script does not turn on Hub, workflows or invitations.

Scripts live in the surveys’ own native HTML elements, in the same document as the native controls. A script in an outer cross-origin funnel cannot replace this installation.

## What the host does

1. Installs event and provider-write guards before fetching context. Captures the native footer’s click/Enter/Space and form submit events at window capture phase. The actual footer is **outside** `form#_builder-form`, in its `.ghl-form-wrap` parent. A form-only containment check is insufficient.
2. Reads the opaque capability from fragment, erases the fragment, keeps it only in memory, and POSTs Authorization Bearer to the exact reviewed Hub origin. Query parameters cannot choose an endpoint. Redirects, cookies and caching are disabled on context/save requests.
3. Hydrates native fields and radios from the authenticated journey. The six property address fields and stable IDs are read-only. User-modified hidden fields never choose a journey/property/revision for a command.
4. Handles fields mounted or replaced by native slide rendering. The native preview keeps all slide controls mounted while hiding later slides. Radio change events are dispatched only for the selected radio; dispatching a change for unchecked radios would corrupt Vue’s model.
5. Saves property identity/status on Next, then replays only native Next. Saves property preferences on final property Submit. Native provider Submit never runs. Account Next saves shared software; final account Submit requires explicit all-properties review, saves the acknowledgement, fetches accepted context/revision, then submits the journey.
6. Shows a read-only email summary from authenticated context. GHL’s standard email control reset its visible value during native rerender, so its original wrapper is hidden by glue. Email is not asked again and is not an identity authority for any backend command. PMS and status controls remain native.
7. Keeps an uncertain command and event ID unchanged for retry. Successful earlier steps in the same submission sequence are not repeated after an uncertain later step. A conflict does not silently overwrite newer state.
8. Provides navigation between native surveys/properties. Same-name properties include ordinal/unit labels. A same-survey property change forces reload with the chosen immutable UUID; only accepted, clean state can navigate.

Native Next sends `POST https://backend.leadconnectorhq.com/forms/form-survey-event` even with partial contact creation disabled. The installed provider-write guard rejects non-read fetch/XHR/beacon requests to the native origin and the known GHL backend/API origins. It also blocks direct `form.submit()`. Those telemetry requests are intentionally suppressed so this path cannot accidentally create native records. The verified Hub endpoint remains separate and allowed.

## Resume semantics

Native **Save progress**, **Create Contact on Partial Submission**, and **Sticky Contact** are OFF on both V1 surveys. Existing older surveys are unchanged. This prevents browser-local drafts from crossing properties.

Resume by reopening the original, unexpired onboarding link. The host fetches the latest accepted backend context. A plain browser reload after the fragment has been erased intentionally asks for the original link; the capability is not persisted in local/session storage. Unsaved field edits are not promised to survive reload. An expired link needs the server’s authenticated reissue path. The adapter does not invent an email-based lookup.

## Verification performed

- 11 DOM/session tests: approved origins and strict context, corrupt token with no request, immutable property binding, mixed-preference rejection, exact retry replay, revision conflicts, native footer boundary, final click/keyboard/requestSubmit interception, accepted Next replay, same-name/unit isolation, saved-state resume, explicit final acceptance and provider transport blocking.
- Actual native property fixture: native hydration survived Next; trusted final click and Enter saved only the bound synthetic property/preferences; requestSubmit was blocked; zero provider bubble handlers and zero provider requests reached the fixture’s outer transport counter. One native tracking request was stopped by the inner provider guard.
- Actual same-survey switch from unit A to unit B: bound UUID and native unit changed together after reload, token fragment erased.
- Actual native account fixture: Next saved software; explicit acknowledgement/review then final Submit produced account → submit with fresh revisions; synthetic final stage was `submitted`; zero provider bubble handlers and zero provider writes reached transport. The provider guard stopped two native requests during the flow.
- Actual native email summary: known synthetic email displayed in the host; original email wrapper hidden.

The native browser fixtures contained only invented data and a fixed synthetic capability. Their mock backend was memory-only and rejected all actual network writes. They were replaced after proof; `dist/*-fixture.html` must never be installed as production hosts. No customer contact, provider onboarding record, payment, message or Assembly invitation was created in this lane.

## Build and deploy

```sh
node build-native-host.mjs
```

For a reviewed preview/staging deployment, set `RF_NATIVE_REVIEWED_API_ORIGIN` at build time to its exact HTTPS origin, rebuild, review the generated output, and replace the native HTML content. No client URL parameter can override that origin. The chosen Hub deployment must allow `https://links.revfactor.io` in its CORS configuration and must be accessible without preview-protection redirects. Do not use a protection bypass token in native client code.

Use GHL **Edit HTML** → paste generated HTML → **Yes, Save** → survey **Save** → script-review **Proceed**. Wait for Save to return, reload the builder and verify the public widget after its saved revision appears. Do not add a second host script to the same survey.

## Remaining controlled-pilot gates

- User-agreed test inbox/contact in `GHL_V1_PILOT_CONTACT_IDS`.
- Accessible reviewed Hub deployment, exact CORS origin, pilot flag/allowlist and issued capability.
- One real allowed pilot save/resume/conflict cycle through Hub; all outside-pilot begin/context/save actions remain rejected.
- Root’s signed-contract/payment evidence and Assembly handoff checks before invitations can run.
- Validated invitation destinations/guide links. Current native copy offers Need help rather than inventing an email, login or setup instruction.

No native GHL custom-object upsert proof is required for this installed path: native writes are deliberately bypassed and guarded. If future design introduces GHL record projection, implement a separate reviewed server-side worker.

## Test commands

```sh
npm install --prefix /tmp/rf-native-host-tests jsdom@26 --ignore-scripts --no-audit --no-fund
node --test native-host.test.mjs
node native-property-adapter.test.mjs
node native-account-adapter.test.mjs
```

The jsdom package is a local test-only runtime. Override its module path with `RF_NATIVE_JSDOM_MODULE` when using another installed runtime.
