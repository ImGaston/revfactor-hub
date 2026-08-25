# Sessions — RevFactor Hub

## 2026-08-21 — GHL-native onboarding draft wired through payment

- Rebuilt the client-facing GHL funnel shell and form as a saved, unpublished RevFactor experience: official text wordmark treatment, Cormorant Garamond/Inter typography, accessible warm-stone-on-forest contrast, compact responsive spacing, progress cue, desktop two-column/mobile one-column inputs, checkbox cards, branded focus/button states, and security reassurance. A fresh preview with `rf_primary_listing_quantity=1&rf_child_listing_quantity=0` confirmed the visible defaults, conditional child/date fields, no save-progress modal, and no horizontal overflow; no form was submitted.
- Created the GHL Conversation AI agent `RevFactor Onboarding Guide` as the inactive primary agent with status Off. Added and trained the dedicated `RevFactor Onboarding Bible` knowledge base and a 9,364-character canonical guide covering process, pricing, listing types, contracts, Stripe, Assembly, Airbnb/PMS/PriceLabs access, security, corrections, troubleshooting, and escalation. Added the agent personality/goal/guardrails, enabled conversation summaries, and attached the KB trigger. Knowledge retrieval and the internal bot trial passed the intentional `Hospitabel` typo plus Airbnb host/editor URL normalization case. Human-handover ownership and any live channel activation remain explicit review gates.
- Inspected the existing six-step GHL `Revfactor` funnel and extracted its actual page CSS, fonts, and palette. Applied the same Cormorant Garamond/Inter typography and forest/stone/sage/rust system to the unpublished onboarding funnel and embedded form, including the form surface, labels, checkbox cards, help text, focus treatment, and uppercase forest CTA. Verified the saved public form CSS and parent preview styling; nothing was published.
- Refined the native signup form so listing count is labeled `Number of listings`, prefills to 1 through the funnel URL, and is rejected below 1 by a saved native form rule. Child listings now begin at zero behind an `Add child listing` checkbox with explanatory help; service starts immediately unless `Start service at a later date` is checked, which reveals the date picker. Public-preview behavior was verified without submitting the form.
- Updated and saved the Draft signup workflow to map the new service-start controls into the existing mode/date fields and branch between scheduled and immediate starts. Both branches retain the internal notification and send the same GHL agreement. The workflow remains Draft; no funnel, form, workflow, document, payment, or production URL was published or executed.
- Fixed the native GHL form order so every quantity/legal/start field precedes the submit button. Added and saved the agreement's GHL product list with required editable primary quantity (1–5), optional/default-off editable child quantity (1–5), required $150 onboarding fee, monthly first-at-signing invoicing, direct payment, invoice email, autopay, and no stop date.
- Removed the obsolete pilot-tag trigger from `RF NATIVE | Signup → GHL Agreement`; the Draft workflow now enrolls only from the native form. Added the protected `Provision Assembly onboarding` custom-webhook action to the Draft payment workflow before its paid tag and internal notification. No workflow, funnel, or document was published or sent.
- Deployed the payment receiver to Vercel Preview with Preview-only bearer authentication and a protection-bypass header. The receiver now treats the paid first-invoice total as authoritative and uniquely derives 1–5 primary plus 0–5 child listings from the approved $350/$50 monthly prices and fixed $150 onboarding fee. Seven focused tests, TypeScript, local production build, Vercel build, and preview auth/invalid-payload checks pass; no client, Hub run, Assembly identity/invite, or charge was created.

## 2026-08-21 — Isolated GHL onboarding pilot preview

- Added a separate `/start/ghl-pilot` signup path in the onboarding app; the production `/start` route and `onboarding.revfactor.io` were not changed.
- Added Preview-only GHL signup and completed-document callbacks. Signup freezes standard pricing, prepares an uninvited Assembly identity, stores the Hub signup intent, and upserts GHL. Checkout requires a matching signup/email plus a per-signup HMAC token and refuses non-test Stripe keys.
- Created the GHL pilot signup ID, signup token, and derived webhook-token fields plus `rf-ghl-pilot`. Renamed and isolated the two workflows as `RF PILOT | Signup → GHL Contract` and `RF PILOT | Contract Signed → Stripe Test Checkout`; both remain Draft pending the final browser confirmation to publish and send an internal test agreement.
- Deployed only to Vercel Preview and verified the non-secret readiness gate reports Stripe test mode, configured GHL/Assembly, and `productionSignupChanged: false`. The complete onboarding app check passes: lint, typecheck, 63 tests, and production build.

## 2026-08-21 — GHL agreement and Stripe checkout draft chain

- Uploaded the revised agreement as `RevFactor_Service_Agreement`, configured required client and RevFactor signature/date fields, and added sender-completed pricing fields for the primary/child quantities, rates, monthly service fee, onboarding fee, and initial checkout total. The native product-list block was removed because it conflicted with the fixed PDF layout and dynamic-quantity requirements.
- Built and saved two inactive GHL workflows: `RF Standard | Signup → Contract → Stripe` creates the agreement as an internally reviewed draft after the `rf-standard-contract-ready` tag; `RF Standard | Contract Signed → Stripe Checkout` listens for that template's completed status, calls the Hub checkout endpoint, and emails the returned Stripe link. The second workflow still contains a deliberately invalid key-vault placeholder and uses a premium custom-webhook action.
- Kept the polished `onboarding.revfactor.io/start` experience as the planned signup UI instead of recreating it as a native GHL form. Added the authenticated Hub signup bridge, GHL legal-name/pricing/service-start fields, standard pricing calculation, contact upsert without tag loss, and the contract-ready trigger. The separate onboarding app has not been cut over from its Assembly endpoint yet.
- Added the authenticated `POST /api/webhooks/highlevel/onboarding-checkout` route, quantity-aware Stripe Checkout/customer helpers, HighLevel v3 contact updates, checkout URL/session custom fields, and the `rf-standard-checkout-ready` tag. Scheduled service starts preserve the current behavior: onboarding is charged at checkout and Stripe delays recurring billing to the agreed date. The full test suite (121 tests), TypeScript, and diff checks pass. No workflow was activated, document sent, checkout published, customer charged, deployment changed, or external migration applied.

## 2026-08-21 — GoHighLevel standard onboarding pricing foundation

- Configured the non-referral GHL product catalog for standard onboarding: renamed the existing $350/month product to `RevFactor - Primary Listing`, added `RevFactor - Child Listing` at $50/month, and added the one-time `RevFactor - Onboarding Fee` at $150. The products are excluded from the online store; no document was sent, workflow activated, payment link published, or customer charged.
- Created the `RevFactor Standard Onboarding` contact-field folder with separate Number fields for primary quantity, child quantity, final onboarding-fee amount, calculated monthly service fee, and calculated initial checkout total. Listing quantities remain signup data; GHL's `Available QTY` inventory field is not used.
- Kept referral pricing outside this flow for a separate future form, contract, products, and pipeline. The revised service-agreement PDF is ready locally, but Chrome blocked the GHL file chooser until the ChatGPT browser extension receives file-URL access.

## 2026-08-21 — Onboarding date order and PMS typo confirmation

- Reordered live launch, planned launch, and one-off event capture so the guided chat asks year before month without changing the migration-042 payload shape.
- Added conservative PMS-name interpretation: exact known names are normalized to canonical capitalization, close unique spellings such as `Hospitabel` produce a client confirmation for `Hospitable`, and unknown/niche PMS names remain valid if the client keeps the original response.
- Nine focused onboarding tests, TypeScript, targeted ESLint, and diff checks pass. Signed-in browser verification covered the exact year-before-month and `Hospitabel → Hospitable` confirmation paths. The onboarding behavior passed; the shared application shell still emitted its pre-existing Radix ID hydration warning during the development-browser run. No database, Assembly, PriceLabs, PMS, OTA, email, invitation, deployment, or other external change occurred.

## 2026-08-20 — Zero-write conversational onboarding study

- Added the authenticated `/agent-studio/onboarding-study` prototype with a method choice between the unchanged Assembly form and a guided conversation. The chat asks one contract-bound question at a time, explains access steps, tracks progress, supports backward navigation plus direct edits to any saved response, and previews the normalized onboarding payload.
- Added a pure shared question/payload module with conditional branch cleanup, credential-pattern rejection, URL/year/numeric validation, deterministic property-name correction detection, canonical Airbnb public-link extraction from hosting/editor URLs, migration-042 listing/software/task/pricing/event/comp/readiness/knowledge keys, and JSON plus transcript exports. URL and correction interpretations require client confirmation; submission is explicitly simulated in browser state.
- Added eight focused deterministic tests plus a route-shaped loading skeleton. Targeted tests, TypeScript, ESLint, the production build, and diff checks pass. Signed-in browser verification covered method selection, the credential guard, property-name correction while answering the URL question, the exact Airbnb hosting-to-public URL confirmation path, in-place answer editing, a complete conditional conversation, ready-state controls, and the simulated-submission boundary with no console errors. No migration, Supabase mutation, Assembly/PriceLabs call, email, invitation, deployment, or other external change occurred. The separate Assembly app's exact question copy is not present in this repository and remains a required pre-client-study parity review.

## 2026-08-20 — Revenue Manager read-only Ashwood workspace

- Documented the six migration-075 choices as conservative local defaults only: existing publish/control mapping, super-admin approval/control, all nine tables, no deletes, one active strategy/recommendation, and manual-only execution. The migration remains unapplied and still requires human approval.
- Added contract-validated Ashwood evidence/profile adapters, deterministic review orchestration, typed recommendation persistence serialization/hydration, and a server-only read repository for the future applied schema. The review correctly ends `data_blocked` with no commercial action while adjusted-occupancy and forward-inventory semantics remain unresolved.
- Added the permission-gated `/revenue-manager` internal preview with Today, Profile, Decisions, and Evidence views, read-only fixture labeling, disabled action state, loading UI, sidebar/command navigation, and responsive behavior.
- Validation: all 93 tests across 15 files, TypeScript, targeted ESLint for the new Revenue Manager and navigation code, and the production build pass. Signed-in browser verification covered all four tabs, desktop and mobile layouts, and found no console errors. The existing `top-bar.tsx` synchronous-effect lint finding remains unchanged and is unrelated to its route-label addition. No database migration, seed, deployment, PriceLabs/PMS/OTA mutation, credential change, or external communication occurred.

## 2026-08-20 — Revenue Manager Phase 1 persistence draft

- Generated review-only migration 075 with all nine Revenue Manager tables, targeted indexes, JSON/date/status constraints, actor-preserving foreign keys, explicit permission seeds, permission-based RLS, and no delete policies or external write path. The migration was not applied.
- Reused the existing permission action catalog: admin receives `revenue:view/create/edit`; `publish` (approval) and `control` (manual execution verification/outcomes) remain fail-closed to super_admin until the Ashwood approver decision is confirmed.
- Added security-definer integrity triggers with fixed search paths and revoked execution for version immutability, frozen evidence, append-only decisions, atomic recommendation decisions, listing-chain validation, approved-only execution, Adjustment verification gating, and outcome completion. Added a static migration regression suite and `docs/revenue-manager-persistence-review.md` for pre-application review.

## 2026-08-20 — Revenue Manager Phase 0 domain contracts

- Implemented the first `REVFACTOR_AI_SPEC.md` work package: versioned Zod contracts for profiles, metric evidence, diagnostic candidates, and recommendations, plus deterministic inventory, minimum-price exposure, revenue-goal compatibility, source-precedence, reservation-reconciliation, and protected-date helpers.
- Added the aggregate sanitized `ashwood.v1` fixture without address, external listing IDs, guest data, reservation codes, contacts, or credentials. It preserves the pilot's source counts, incompatible revenue measures, direct/cache base-price conflict, permit blocks, protected dates, and a synthetic duplicate fingerprint case.
- Added 13 focused tests covering Ashwood acceptance scenarios C–F, strict contract presence checks, and two additional Phase 0 guardrails. `pnpm vitest run lib/__tests__/revenue-manager-domain.test.ts` and `pnpm typecheck` pass. No database migration, UI, external write, or live pricing change was included.

## 2026-08-19 — RevFactor AI Ashwood pilot handoff

- Added the canonical `REVFACTOR_AI_SPEC.md` product and implementation handoff for the internal, read-only first release of the RevFactor AI Revenue Manager.
- Grounded the spec in current Hub primitives (Agent Studio, onboarding runs, PriceLabs/report snapshots, reservations, permissions, audits, and Adjustments) and the supplied Ashwood pilot evidence rather than designing a greenfield system.
- Defined evidence and metric contracts, smart onboarding, human approval boundaries, data-quality gates, proposed persistence, Ashwood acceptance scenarios, evaluation criteria, phased implementation work packages, and explicit prerequisites for any future PriceLabs write path.
- Recorded Ashwood owner strategy inputs as test-fixture constraints while keeping historical costs non-audited and leaving unresolved revenue, inventory, policy, and source-semantics questions visible. No application code, database schema, external system state, or live pricing was changed.

## 2026-08-18 — Chief of Staff business and operating brief

- Added `docs/revfactor-chief-of-staff-brief.md`, a comprehensive internal orientation document synthesizing the current Hub architecture with the private Flight Deck RevFactor business record and executive-dashboard metric definitions.
- Covered the managed-service model, target customer, pricing discrepancies, revenue-management doctrine, service lifecycle, roles, systems of record, explicitly estimated business baseline, scale constraints, recommended scorecard and cadence, 30/60/90-day mandate, open questions, AI authority boundaries, glossary, and source register.
- Kept implemented facts, recorded decisions, historical estimates, and recommendations visibly separate; no secrets, credentials, account details, or raw client conversations were copied into the repository.

## 2026-08-10 — GHL post-call onboarding email

- Created the branded GoHighLevel template `Sales - Post-call - Start onboarding` for qualified leads after a completed sales call. The template personalizes the greeting, links to the production onboarding start flow with campaign UTMs, and explains the agreement, payment, portal, and future service-start path.
- Verified the template through the GHL v3 API and its hosted HTML preview. Recorded the template ID and manual-send decision in `docs/agent/integrations.md` so it can be wired into a later sales workflow without sending to every completed-call outcome.
## 2026-08-21 — Reservations Header Stats and Booked/Check-in Date Filter

Added a 4-card stats header to `/reservations` (USD rental revenue sum, nights-weighted ADR, average booking window, nights sum) computed DB-side by the new `reservation_page_stats` RPC (migration 077, applied to prod; SECURITY INVOKER with the `IS NOT TRUE` permission gate from the wins pattern). With no date range chosen, stats default to the **last 30 days by booked date** while the table still shows everything; with a range chosen, stats follow the table's filters exactly. Money figures are USD-only by product decision (the cache carries 103 CAD + 32 EUR rows) and the caption discloses the excluded count. The date-range filter gained a Check-in/Booked field selector (`df` URL param, check-in remains the default and keeps old URLs stable). Verified the RPC end-to-end with simulated authenticated sessions (gate rejects no-profile sessions with 42501; all filter paths return correct aggregates — last 30d: 2,154 reservations, $3.46M, ADR $482.69). Typecheck and lint clean; in-browser visual check pending a login session.

Follow-ups same day: compacted the stat cards (`py-0` on `Card` — its base `py-6` made them tall — content `px-4 py-3`, value `text-xl`). Added CSV export: `GET /reservations/export` route handler with the page's exact searchParams contract, `getAllReservationsFiltered` (chunked fetch-all, 50k cap) sharing `applyReservationFilters` with the browser query, and pure `lib/reservations-csv.ts` (BOM + CRLF, table columns + currency, ADR rounded to cents) with unit tests. 229 tests pass. Moved the Export CSV button up next to the page title. Replaced the paired native `type="date"` inputs with the new shared `components/date-range-picker.tsx` (shadcn `calendar.tsx` added via CLI — declined the `button.tsx` overwrite prompt to keep the liquid-glass delta; deps `react-day-picker` v10 + `date-fns` added). Mobile pass: filter controls go full-width under `sm`, and the picker popover flips at `md`/768px (matching `useIsMobile`) to one calendar month with presets as a wrap row on top, `max-w-[calc(100vw-1rem)]` so it never overflows a phone viewport.

Saved views (product decisions: team-shared, relative ranges): extended the URL contract with `?range=<preset>` resolved server-side (`lib/date-range-presets.ts`, shared with the DateRangePicker so a saved "Last 30 days" always re-resolves), migration 078 `reservation_views` (RLS probed live: creator inserts, another admin sees it, non-creator delete affects 0 rows), pure `lib/reservation-views.ts` (sanitize/canonicalize/match, unit-tested), server actions, and a chip bar UI with save popover + AlertDialog delete. 241 tests pass.

## 2026-08-20 — Wins Dashboard Built and Verified Against Production Data

Planned and implemented `/wins` end to end. Phase 0 resolved every open question against the live database rather than assuming: `report_metrics` covers calendar 2026 (not a rolling window); STLY equals LY for closed months but diverges for future ones, confirming STLY is same-time-last-year *pace*; reservations carry CAD/EUR as well as USD, though every Hub-mapped reservation is USD; 177 reservation keys fan out across 3 PriceLabs listings; `source_fetched_at` gives real freshness instead of a proxy.

Reconciled the pickup maths against the reference workbook **to the cent** (`Rabbit Run`: W2 $5,335.97, W3 $36,794.12, Δ $31,458.15, median lead 70.5d) and confirmed the ±15% trend cuts empirically across its 239 rows.

Shipped: migration 075 (5 tables, 14 policies, 1 RPC, permission seeds), `lib/wins.ts` / `lib/wins-message.ts` (pure, fully unit-tested), `lib/wins-detection.server.ts`, `lib/wins-queries.ts`, the `/wins` route with queue + evidence drawer + message composer, and `lib/clipboard.ts` extracted from the one existing copy path that degraded properly. 193 tests pass.

Three real defects surfaced only by running it: the candidate unique key collided on fanned-out listings; delete-then-insert orphaned already-copied drafts; and the in-function permission guard used a bare `NOT` against a function that returns NULL for unidentified sessions. All three are fixed, documented in `conventions.md`, and covered by regression tests. Negative RLS probes as the `authenticated` role confirm zero rows visible, the RPC raising `42501`, and the append-only tables refusing UPDATE/DELETE.


## 2026-08-20 — Liquid Glass visual refresh (foundation, shell, primitives)

- Added the visual foundation in `app/globals.css`: glass tokens, a four-step elevation scale that bundles the specular rim, spring easings compiled to CSS `linear()`, and the first `prefers-reduced-motion` / `prefers-reduced-transparency` guards in the repo.
- Glassed the chrome: sticky top bar, mobile drawer, popover, dialog, sheet, alert-dialog, command palette, and toasts via the previously-dead `.cn-toast` hook. Deduplicated the hardcoded glass recipe from `dropdown-menu`/`select` into the shared `glass-chrome` utility.
- An ambient gradient wash was added and then removed at the user's request (they wanted a neutral background). Consequence: the desktop sidebar reverted to solid `bg-sidebar` — with a flat page background there is nothing behind it to blur, so glass there was pure cost. Kept the default sidebar variant throughout (`floating` costs usable width on dense tables).
- Content surfaces stayed opaque and moved to the elevation scale; added a shimmer skeleton, spring press feedback on buttons, and a travelling spring-animated sidebar nav pill positioned from the item index (rows are a uniform 38px, so no measurement is needed).
- Implemented the liquid-gooey filter, measured it in the browser, and removed it — merge distance ~5.6px against a 38px row pitch, so it never bridged. See `decisions.md`.
- Fixed several pre-existing bugs found on the way: four dead `hsl(var(--token))` fallbacks (the tokens are bare `oklch()`, so those declarations were being discarded entirely) in `kanban-board`, `kanban-card`, `sidebar`, and `monthly-pacing-chart`; an invisible dashed border in `empty.tsx`; and missing `routeLabels` entries that made the breadcrumb render lowercase route slugs.
- Caught and fixed a token-inheritance bug of my own: `--glass-surface: var(--popover)` declared only in `:root` inherits already-substituted, so the forced-`dark` menus over a light page rendered grey-on-grey. `.dark` now re-declares it. Dark-glass opacity also had to rise from 62% to 82% to hold AA contrast over light content.

## 2026-08-10 — Revenue Brief prospect intake and AirROI draft enrichment

- Added a short prospect intake for prepared-for name, property address, Airbnb URL, owner goals, and known constraints, with a manual apply path that leaves the existing full analyst form intact.
- Added an optional server-only AirROI listing integration. One explicit import pre-fills public listing facts and owner-safe draft language while showing TTM modeled metrics only in an internal source callout; demand drivers and RevFactor benchmarks remain human-reviewed.
- Kept the workflow stateless and permission-gated, added missing-key graceful degradation, strict Airbnb ID extraction, response validation, tests, and durable integration/evidence-boundary documentation.
## 2026-08-10 — Project-based roadmap workspace

- Reworked `/roadmap` into Projects and Task board tabs. Project cards show completion counts, upcoming deadlines, a task preview, and a detail dialog with every attached task; each project can open a pre-filtered Kanban.
- Added and applied migration 074 with permission-scoped `roadmap_projects`, required `posts.project_id`, project deadlines, and a General-project default that preserves every existing roadmap post, vote, comment, tag, category, and task date. The legacy `posts.eta` field remains storage-compatible while the UI presents it as Deadline.
- Task creation now requires a project, the Kanban switches between all projects and one project, and task detail supports project reassignment and inline deadline editing. Added the route loading skeleton and updated navigation terminology.

## 2026-08-10 — Client Revenue Brief Builder

- Added a Pipeline-gated `/revenue-briefs` workflow with structured Property / Opportunity / Evidence tabs, live narrative preview, bounded cover-photo upload, a synthetic demo, and validation feedback.
- Added a server-only `@react-pdf/renderer` generator and authenticated POST download route for a branded six-page US Letter brief covering executive fit, property/demand context, revenue levers, first 30 days, anonymized managed benchmarks, evidence boundaries, and the final data request.
- The v1 workflow is intentionally stateless: no prospect data or PDFs are saved. Added schema/PDF tests, a safe filename helper, sidebar navigation, and durable architecture/decision notes.

## 2026-08-06 — Managed adjustment-type visibility per creator group

- Migration 073 (applied to prod): `adjustment_type_settings` with `internal_enabled`/`hostpricing_enabled` per type, seeded from the old hardcoded rule (everything on; `setup` off for HostPricing). SELECT via `adjustments:view` OR `settings:edit`, writes via `settings:edit`.
- New Settings → Adjustment Types tab (`settings:edit`): two-column checkbox grid (RevFactor / HostPricing) with optimistic toggles and a "Hidden for everyone" warning badge when both are off.
- `adjustmentTypeOptions()` now takes the fetched settings (via `getAdjustmentFormOptions`, which the dialog already lazy-loads) and filters by creator group (`lockOriginToHostpricing`); falls back to `INTERNAL_ONLY_TYPES` when unloaded. Edit mode keeps the current type selectable; server still accepts any valid type.

## 2026-08-06 — Minimal hostpricing role scope

- hostpricing now has only `adjustments` view/create/edit + `listings:view`; revoked `clients:view` and `reservations:view` directly in prod (`role_permissions` is UI-managed data, no migration). Sidebar shows just Adjustments and Listings for them.
- `getAdjustmentFormOptions` (create-dialog client/listing picker) no longer queries `clients` — it reads `clients_basic` + `listings` flat and groups in JS, so roles without `clients:view` can still pick a client.
- Listings list/detail/export embeds switched from `clients(...)` to `clients:clients_basic(...)` (same `id, name, status` fields) so client names render without `clients:view`. Verified PostgREST resolves the view relationship and `clients_basic` is granted to `authenticated`.

## 2026-08-06 — Roles & Permissions fix: broken checkboxes and stale grid

- Root cause of "checkboxes don't save": `togglePermission`/`bulkToggleResource` used `update`, which no-ops on missing rows. Roles created before newer resources/actions existed had gaps (`admin` 63/84 rows, `hostpricing` and `marketing` 10/84).
- Migration 072 (applied to prod): backfilled every role × resource × action row (super_admin `allowed=true`, others `false`) and deleted stale `calendar`/`notes` rows. All 5 roles now have 84 rows.
- Server actions now `upsert` on `(role_name, resource, action)` and validate resource/action against the canonical lists.
- `roles-manager.tsx` redesign: grid template was hardcoded for 4 actions while `ACTIONS` has 6 — `publish`/`control` columns rendered unlabeled and misaligned. Added labels/colors for both, a shared 6+All column template with horizontal scroll on narrow widths, optimistic checkbox state (instant flip, revert + toast on error), and counts derived from `RESOURCES × ACTIONS` instead of raw DB rows.

## 2026-08-06 — Adjustments as the bidirectional HostPricing ticket channel

- Applied migration 071: type CHECK widened to 16 values (+`visibility`, `blocked_dates`, `pricing_flexibility`), new `adjustments.signals` JSONB (report metrics as free-form strings) and `suggested_actions` TEXT[] (slugs + free text). No RLS changes.
- `lib/adjustments.ts`: `ADJUSTMENT_TYPE_CONFIG` gained `showsSignals`/`showsSuggestions` (also enabled on `review`), `ADJUSTMENT_SIGNAL_FIELDS` (7 metrics), `ADJUSTMENT_SUGGESTED_ACTIONS`, `adjustmentTypeOptions()` (hides `setup` from hostpricing creators, UI-only), `isPendingApproval()` (derived: hostpricing + open), `buildWhatsappCommentUpdate()`. `validateAdjustmentInput` normalizes both new fields.
- Queue: pending HostPricing proposals join "Waiting on us" and leave Triage (exclusive, like `needs_info`). Dialog: signals grid + suggestion checkboxes/free-text for review types, serialized as JSON form fields. Shared render: `components/adjustments/adjustment-signals.tsx` (internal detail + authed `/a` card; excluded from the public shell projection). Per-note "Copy for WhatsApp" (`Send` icon) on top-level internal notes via a new optional `onCopyForWhatsapp` prop on `CommentActionBar`.
- Edit-wipe guard: added `signals, suggested_actions` to `ADJUSTMENT_SELECT` (list), `DETAIL_SELECT` (detail — it is an explicit projection, not `select("*")`), and the `duplicateAdjustment` source select.
- Verified end-to-end against the live DB: created a visibility ticket with signals/suggestions (normalization confirmed in SQL), edit round-trip preserved both fields, unauthenticated `/a/<token>` HTML contains none of the values, then deleted the test ticket. `pnpm typecheck` passes.
- Pending operational step (no code): switch Host Pricing accounts from `contractor` to the `hostpricing` role in Settings → Users so they can create tickets.

## 2026-08-05 — Knowledge redesign: Team/Agent tabs and Team Credentials

- Restructured the Knowledge root tabs into Team / Agent / Credentials / Insights / Agent Flows with `?tab=` URL sync (legacy `published|drafts` map to Team); Insights and Agent Flows content unchanged.
- Team tab shows all articles with All/Published/Drafts status pills; new `agent-pipeline-panel.tsx` groups client-safe/agent-enabled articles by pipeline stage (failed → live → indexing → needs review → approved → drafting).
- Added and applied migration 070: `team_credentials` table with permission-based RLS on a new `team_credentials` resource; `admin` granted view/create/edit (delete off), external roles explicitly denied. Verified live policies and seeds.
- New `credentials-actions.ts` (in-code `hasPermission` checks + RLS backstop) and `team-credentials.tsx` (table with show/hide password, clipboard copy, form dialog, AlertDialog delete), copied from the client-credentials pattern.
- Fold-ins: Knowledge `loading.tsx` skeleton, `nav-knowledge` command-registry entry, "Agent Indexed" stat card relabeled "Agent Live". `pnpm typecheck` passes.
- Mobile pass: stat cards and category cards go 2-up and compact below `sm` (Card `py-2`, hidden category descriptions), the tab bar scrolls horizontally in its own container with counts hidden on mobile, and the credentials table wrapper got `overflow-x-auto`. Desktop layout unchanged.
- Added a "Gates table" view to the Agent tab (`agent-gates-table.tsx` + Pipeline/Gates-table switcher): every article as a row with Live indicator, inline switches for Published / Client-safe / Agent enabled (wired to existing publish, approve, and disable actions plus new `setArticleAudience`), review and index badges, re-index button, and titles linking to the article. Verified inline toggles round-trip against the live DB and that precondition errors (e.g. enabling a draft) surface as toasts without mutating.

## 2026-08-04 — Removed unused Calendar and Notes sections

- Deleted the `/calendar` and `/notes` stub routes and every UI reference: sidebar nav, command palette, top-bar breadcrumb labels, and the `calendar`/`notes` entries in `RESOURCES` (`lib/permissions.ts`).
- Database tables (`calendar_events`, `notes`) and migration-012 permission seed rows were left in place as inert leftovers; see `decisions.md` 2026-08-04.
- `pnpm typecheck` passes after clearing stale `.next` generated types.

## 2026-08-03 — Owner-specific gap rules and PriceLabs sync timing

- Refined the one-night/gap-night Knowledge draft so minimum stays are explicitly owner-approved and listing-specific rather than a RevFactor-wide default.
- Documented how bookings and cancellations can change the applicable gap/default/far-out rule and leave open dates temporarily unbookable until the overnight or authorized manual PriceLabs refresh and sync.
- Added four synthetic booking, cancellation, one-night, and urgent-sync regression cases; no live listing data or production action is included.

## 2026-08-03 — Pacing, calendar availability, and operational update policies

- Refined three disabled Knowledge drafts: slow-booking/pacing diagnosis, blocking/unblocking availability, and price/discount/fee/minimum-stay requests.
- Standardized exact-scope intake, aligned evidence, answer/clarify/escalate outcomes, human approval, live-system verification, and no-outcome-guarantee boundaries.
- Added thirteen synthetic Agent Studio regression cases across migrations 066–068; no real client data, live settings, or production playbook behavior is included.

## 2026-08-03 — OTA markup and Airbnb discount policy draft

- Refined the existing disabled `ota-markup-policy` Knowledge draft around RevFactor's `$100 PriceLabs → $100 Hospitable → $144 Airbnb` example, with the 44% markup explicitly treated as a verified policy example rather than a universal live setting.
- Added client-ready wording, live rate/discount/payout verification steps, approved longer-stay exceptions, ranking and MPI wording boundaries, and escalation rules.
- Added five synthetic Agent Studio regression cases; no raw client message, client identity, live rate, or production playbook behavior is included.

## 2026-08-01 — Knowledge Agent Flow builder

- Added a Knowledge → Agent Flows workspace and `/knowledge/flows/[id]` n8n-style editor using a controlled React Flow canvas with a safe step palette, draggable/connectable nodes, branch labels, node/edge inspector, minimap, validation, explicit saves, and audit activity.
- Added and applied migration 061 for permission-scoped flow identities, immutable version snapshots, compiled observable instructions, database-enforced draft/testing/approved/production lifecycle, one-production uniqueness, atomic promotion, and trigger-written audit events.
- Added pure graph normalization/validation/compilation with tests and a project-local `revfactor-agent-flow-builder` skill. Installed the external `react-flow-architecture` and `react-flow-node-ts` Codex skills for future turns.
- Verified direct TypeScript, targeted ESLint, all 38 tests, the custom skill validator, a full Next.js production build, production schema-cache visibility, and the Vercel production deployment. PR #25 merged to `main` as `7882092`; the Agent Flow tables and RLS are live.

## 2026-07-31 — Governed hybrid Knowledge retrieval

- Added and applied migration 060 for pgvector-backed, version-bound Knowledge chunks, full-text/vector indexes, indexing audit events, run-level retrieval usage/cost, permission-based RLS, stale-on-edit behavior, and a security-invoker hybrid search RPC.
- Added section-aware chunking and `openai/text-embedding-3-small` indexing through AI Gateway. Article approval attempts indexing automatically; Knowledge detail/Insights show readiness, passage previews, failures, and manual re-indexing.
- Added Playground keyword/hybrid/compare controls and Inspector diagnostics for exact passages, keyword/semantic/hybrid ranks, fallback behavior, embedding model/tokens/latency/cost, and generation-versus-retrieval cost. Hybrid failures preserve availability through the governed keyword fallback.
- Verified the implementation with direct TypeScript checking, targeted ESLint, a pure retrieval smoke test, and a full Next.js production build. The repository's Vitest install was blocked by the configured minimum-release-age policy for a newly published transitive package, so that policy was not relaxed.

## 2026-08-01 — GoHighLevel sales setup started

- Reviewed the scheduler-to-Hub flow and decided GHL should replace the scheduler as the owner of lead capture, booking, reminders, nurture, and sales pipeline movement.
- Created RevFactor contact custom fields in GHL for Hub lead ID, legacy scheduler booking ID, property/listing details, attribution/referral, scheduled call time, host rep, Meet link, and prep notes.
- Created a dedicated `RevFactor Sales` GHL pipeline with stages from new lead through booked/completed call, proposal, negotiation, won, and lost/not-fit. Left the existing `Marketing Pipeline` untouched.
- Captured the GHL field keys, stage plan, and next Hub webhook direction in `docs/agent/integrations.md`. Calendar replacement is still pending GHL user/rep setup and connected Google calendars.

## 2026-07-31 — Negative-performance framing workflow

- Added a fourth editable Studio Coach scenario for negative performance: verify the benchmark, frame the result without sugarcoating or unsupported diagnosis, and route to a client-ready answer, internal brainstorm, or human escalation.
- Added explicit escalation triggers for material/repeated/unexplained gaps, stale/conflicting data, churn/refund/cancellation/sensitive disputes, and approval-required actions. Coach-generated workflows must preserve the scenario.
- Added and applied migration 059 to all four saved playbook workflows without changing approved/production prompt text; added instruction-rendering regression coverage and a responsive two-column scenario selector.

## 2026-07-31 — Studio Coach and editable response workflows

- Added a default-right-rail Studio Coach that reviews a completed run and up to four comparable runs, returns grounded feedback/teaching and a playbook instruction patch, and records its own model, token usage, latency, and estimated cost.
- Added an editable answer/clarify/escalate process graph to playbook versions. The graph represents explicit operating rules rather than hidden chain-of-thought; steps can be edited, added, removed, applied to a session draft, or saved as a new draft playbook version.
- Added and applied migration 058 for versioned workflow JSON and immutable permission-gated `agent_coach_reviews`, plus audit events and normalization/rendering tests.
- Live production verification caught Gemini's rejection of the numeric enum generated by `z.literal(1)` and its tendency to label an improved workflow as version 2. The provider boundary now accepts a bounded integer while `normalizeAgentWorkflow` always persists the supported workflow schema as v1.
- A second live pass showed Gemini sometimes returns a percentage-style review score despite a five-point request. The structured boundary now accepts either bounded form and deterministically normalizes it to the UI's 1–5 scale before storage.
- Failed structured Coach generations now retain bounded invalid output, validation detail, finish reason, token usage, pricing, and estimated cost in the permission-gated Coach ledger so provider mismatches are diagnosable without exposing them in the client-facing UI.

## 2026-07-31 — Agent Studio 90-day and last-year PriceLabs context

- Fixed performance drafts that stopped at 30 days by exposing the already-synced exact forward 90-day listing and market occupancy fields, along with cleaning fees, bedroom count, and 60-day market penetration.
- Added a bounded server-only Report Builder loader for monthly current, market, STLY, LY, revenue, booking-window, RevPAR, and penetration data. Portfolio monthly context covers all matched listings (up to 50); near-term per-listing detail is capped at 10.
- Added the monthly report as a separate inspectable source and frozen it in run snapshots, with immutable prompt rules that distinguish exact rolling 90-day values from calendar-month comparisons.

## 2026-07-31 — Reopen Agent Studio runs

- Added a Reopen action to the Runs ledger that restores a saved run in the Playground, including the client, model, playbook instructions, conversation messages, result, sources, tool trace, token usage, comparison costs, and inspector state.
- Reopened runs remain immutable: continuing appends a new run to the same owned Playground conversation; runs created by another teammate or by evaluations/shadow mode open as a separate conversation copy.
- Failed runs now persist their prompt/configuration snapshot and reopen with the attempted question prefilled for retry. Existing failed first-message runs fall back to the saved conversation title.

## 2026-07-31 — Agent Studio runtime compatibility and playbook recovery

- Diagnosed production failures from the durable run ledger, then reproduced the provider behavior against AI Gateway: default GPT-5 Nano reasoning returned no structured output, Qwen required explicit JSON schema instructions, and GPT-5.4 Mini rejected Nano's reasoning level.
- Added per-model reasoning controls and an explicit immutable JSON contract; directly smoke-tested all seven configured Gateway models with their resolved settings.
- Made failed runs visible inline and in the Runs ledger, preserved safe diagnostic types in audit events, and ensured ad-hoc instruction edits switch to the custom session draft instead of being ignored by a saved playbook.
- Added and applied migration 057 to normalize the callable tool list and seed focused performance-explanation, pricing-change, and sensitive-escalation playbooks for repeatable testing.

Short rolling summaries of substantive agent work. Keep entries compact and delete or condense stale detail when this file grows.

## 2026-07-31 — Per-client Grant-style reservations report

- Evolved the client export into a Grant-style report replicating the manual Google-Sheet reporting: Summary dashboard (title band, KPIs, per-listing and per-channel breakdowns with booking-window segment cells `count (revenue%)`, two embedded stacked-bar PNG charts, monthly pickup matrix listing × check-in month with 12-month cap + Later column, occupancy blocks, revenue and reservations current-vs-previous tables with green/red deltas), Reservations/Previous Period/Last Year detail sheets as real Excel tables with autofilters (Last Year hidden), Comparison sheet, hidden Occupancy and \_ChartData sheets. Grant visual language (Arial, #13342D/#073763/#0B5394 bands, zebra rows, #CCCCCC totals, white→#C9DAF8 occupancy color scale, hidden gridlines, frozen headers).
- Period semantics: default date field `booked_date`; previous period = previous month aligned by day of month (Jul 1-28 → Jun 1-28, clamped month ends, Feb 29 safe); `asOf` drives occupancy horizons and pickup cutoff. Occupancy from `report_metrics` (latest completed run, monthly; property vs market; no daily nights source exists — documented in decisions.md).
- Architecture: `lib/reservations-export.ts` (pure period/median/bucket/aggregation helpers) → `lib/reservations-report-model.ts` (GrantStyleReportModel with built-in reconciliation warnings) → `lib/reservations-report.service.ts` (fetch + occupancy provider + charts + workbook; 50k-reservation cap; shared by route and future cron) → `lib/reservations-workbook.server.ts` (ExcelJS layout; formulas only for totals/changes, always with cached results) + `lib/reservations-chart.server.ts` (SVG→PNG via sharp). Route `GET /clients/[id]/export` validates from/to/asOf/dateField.
- Added vitest (first test runner): 26 tests over period math (month-end clamp, Feb 29), KPI rules (null revenue, negative booking windows), channel normalization, pickup, full-outer-join listing comparisons (new listing → previous 0 + empty pct) and model reconciliation (listing/channel/comparison sums = KPIs). Validated a real Grant workbook programmatically (sheet order/hidden states, tables, freeze panes, formula cache, no formula errors, 2 embedded images, conditional formatting, XML well-formedness of all 25 package parts).

## 2026-07-31 — Reservations module (PriceLabs BigQuery view)

- New `/reservations` section (permission resource `reservations`, `view` seeded TRUE for all 5 roles in migration 053): URL-param-driven server-side filtering (client, listing, check-in date range, text search), sorting, and 50-row pagination over ~26k booked reservations. Cancelled reservations are excluded everywhere by product decision (filter hardcoded in `lib/reservations.ts`).
- Shared `RecentReservationsCard` (latest 10, newest booked first) added to client detail (after Adjustments) and listing detail (between KPI cards and tabs via a server-rendered slot prop).
- Key discovery: `pricelabs_bq.pricelabs_reservations` behind the external view `pricelabs_reservations_bq` is a BigQuery FDW foreign table only `postgres` can query (vault credential lookup runs as the caller). Fix: migration 054 materializes the view into `pricelabs_reservations_cache` (unique `row_key`, partial indexes, grants to authenticated/service_role only — no anon) and migration 055 adds pg_cron (`CREATE EXTENSION`) with an hourly concurrent refresh as postgres. The app reads only the cache; the external view and `pricelabs_reservations_airbnb` are untouched (per user: source of truth is `pricelabs_reservations_bq`; do not use `pricelabs_reservations_airbnb`).
- Verified in the running app: table, client/listing combobox filters, date range + sort via URL, page 2, both detail cards, and cache readability as `authenticated`. `pnpm typecheck` clean for the new files (pre-existing agent-studio errors from missing `zod`/`ai` deps remain).
- Follow-up: migration 056 recreates the cache with computed `booking_window_days` (`check_in - booked_date`; avg ~52d, 131 negative rows from post-check-in alterations shown as-is), surfaced as a sortable "Bkg Window" column on `/reservations`.

## 2026-07-28 — Internal Agent Studio MVP

- Added `/agent-studio`: synthetic or RLS-scoped real-client context, three selectable Gateway models, session-only instructions, multi-turn test chat, and an inspector for disposition/confidence, reviewer notes, Knowledge sources, tool calls, tokens, duration, and estimated cost.
- Added the server-only AI SDK `ToolLoopAgent` with immutable safety policy, structured output, a read-only published-Knowledge search tool, bounded steps/output, explicit safe client-data projection, and no persistence, data mutation, Assembly call, or send UI.
- Added `agent_studio:view` (migration 049, granted to admin and applied to the production `revfactorHub` Supabase project on 2026-07-28), sidebar/command/breadcrumb entries, Gateway env documentation, and new shadcn Field/Empty/Spinner primitives.
- Verified `pnpm typecheck`, targeted ESLint, and the synthetic UI at wide and narrow layouts. A live authenticated/model run remains environment-dependent: this Codex session did not have Supabase or AI Gateway credentials.

## 2026-07-22 — DB resource audit v0.1 (diagnóstico post-incidente, sin código)

- New `docs/agent/db-resource-audit-v0.1.md`: full diagnostic of Postgres IO/memory waste after the 2026-07-21 Disk IO budget exhaustion (statement-timeout burst 21:44–23:31 UTC; postgres logs carry no SQL for the canceled statements, `pg_stat_statements` reset at the 07-22 restart).
- Headline findings: (1) every RLS policy calls `has_permission()`/`auth.uid()` unwrapped — and `has_permission` is SECURITY DEFINER so it can never be inlined, costing up to ~3 lookups **per row scanned**; (2) zero request-level caching — layout + pages re-run `auth.getUser` + `profiles` + `role_permissions` 2-3× per navigation; (3) ~74 MB of the 118 MB DB is sync data with no retention (`report_metrics` appends ~2.9k rows/run daily, `report_runs.raw_envelope` holds 17 MB, Stripe mirror `raw_json` never pruned); (4) PriceLabs sync writes ~256 sequential row-by-row UPDATEs; (5) dashboard fires 5 exact counts + a ~2.9k-row `report_metrics` pagination per load.
- Advisor snapshot: 19 auth_rls_initplan, 20 multiple_permissive_policies, 45 unindexed FKs (inventoried only — execution is a separate scope), 94 "unused" indexes (weak signal: stats reset same day). `get_my_role()` is missing from migrations (lives only in the live DB). Legacy `USING (true)` remains on `roadmap_items` (all cmds) and `reservations` SELECT.
- Top-5 fix ranking in the doc; nothing implemented. Adjustments module excluded per scope. `clients-listings-perf-plan-v2.md` referenced by the task does not exist in the repo.

## 2026-07-21 — Client churn tracking: reason tags/note, auto ending_date, LTV (super_admin only)

- Migration 048 (applied): `clients.ending_reason_tags TEXT[] NOT NULL DEFAULT '{}'` + `clients.ending_note TEXT`; no RLS change (app-layer super_admin gating like `billing_amount`); `clients_basic` verified untouched.
- `ClientDialog`: selecting status Inactive prefills `ending_date` with today (editable) and reveals a super_admin-only churn section (clickable reason badges from `CLIENT_CHURN_REASONS` in new `lib/clients.ts` + note textarea); non-super_admin submits omit the keys so saves never wipe values. `updateClientAction`: strips churn fields for non-super_admin, auto-sets `ending_date` when inactive, and clears `ending_date`/tags/note **only on the inactive→active transition** (ending_date doubles as planned contract end for active clients — must survive normal edits).
- New `lib/client-lifetime-value.ts` `getClientLifetimeValue()`: paid `stripe_invoices.amount_paid` summed per client via `client_stripe_customers` (mirrors `getClientStripeBilling` shape).
- Financials gained a **Churned** tab (`churned-clients-section.tsx`): per churned client onboarded/ended dates, tenure, LTV, reason badges + note tooltip, with count/total-LTV/avg-tenure header. Client detail shows a Churn InfoRow (super_admin, inactive only). Leak prevention: `[id]/page.tsx` + `settings/clients/page.tsx` null the fields for non-super_admin; CSV export includes churn columns super_admin-only; `/clients` list never selects them.
- Verified: typecheck green; browser flow (mark inactive → tags/note/date persist, Churned tab, reactivation clears churn data).

## 2026-07-17 — Fix production Stripe sync: 5-level expand aborted all mirroring

- Commit 1217706 (entitlements) added `expand: ["data.items.data.price.product"]` to `subscriptions.list` in `lib/stripe-sync.ts`; Stripe caps expand at 4 levels (the list `data.` prefix counts), so every sync failed with "You cannot expand more than 4 levels of a property" and nothing (subs/invoices/payouts) mirrored — pending payments (e.g. realtor@leannesutton.com, oliviatati.re@gmail.com) missing from the hub.
- Fix: expand only `data.customer`; collect unique product ids from item prices, fetch via `products.list({ ids })` (chunks of 100), stitch `Stripe.Product` objects into `sub.items.data[].price.product` before the subs upsert + entitlement detection. `plan_name` keeps its pre-entitlements behavior (nickname ?? product id).
- Verified: typecheck green; ran the sync once locally against production (134 subs, 725 invoices, 185 payouts, 0 errors); both clients' open invoices and past_due subs now mirrored with fresh `synced_at`.

## 2026-07-16 — Comment hover action bar: reactions, internal threads, create-task, copy

- Migration 046 (applied): `parent_id` + `linked_task_id` on `adjustment_comments`/`task_comments`, reaction tables (`adjustment_comment_reactions`, `task_comment_reactions`), internal-thread RLS gate (`adjustments:control`) on adjustment comment replies, stats view now top-level-only.
- Shared UI: `components/comments/comment-action-bar.tsx` (hover bar: 5 quick emojis 👍😀❤️😮🎉, curated picker popover, reply/create-task/copy) + `reaction-chips.tsx` + `emoji.ts`. Integrated into the adjustment detail Notes and `tasks/task-comments.tsx`; `/a/<token>` card stays flat (top-level only).
- New actions: `toggleAdjustmentCommentReaction`, `createTaskFromAdjustmentComment` (inherits client/listing, links back via admin client after `tasks:create` check), `toggleTaskCommentReaction`, `createTaskFromTaskComment`; `addAdjustmentComment`/`createTaskComment` accept `parentId`. needs_info auto-reopen skips thread replies.
- Verified: typecheck + build green; rollback SQL smoke tests (reactions insert, stats view excludes replies, contractor session sees 0 internal replies via RLS).

## 2026-07-16 — Adjustments: internal detail modal, comment indicators, hostpricing role, needs_info, "Waiting on us"

- Migration 045 (applied): `adjustment_comments.origin`, `needs_info` status + `recommendation` type in the CHECKs, append-only `adjustment_status_history` (permission-based RLS), `adjustment_comment_stats` view (security_invoker), `hostpricing` role (adjustments view/create/edit only).
- Rows on `/adjustments` now open an internal detail modal (`/adjustments/[id]` + `@modal/(.)adjustments/[id]`, pipeline pattern): all fields, origin-styled comments, status-history timeline, transition buttons incl. "Needs info". Public `/a/<token>` untouched as the sharing surface (its authed core gained minimal needs_info buttons).
- Row indicators: comment count (muted) or amber "needs reply" when the last comment is external; new "Waiting on us" queue section rendered first (needs_info ∪ unanswered external comment). Triage now excludes `needs_info`.
- Badge class maps (`STATUS_BADGE`/`URGENCY_BADGE`/`ORIGIN_BADGE`) centralized in `lib/adjustments.ts` (were duplicated in 3 files).
- Verified: typecheck + production build green, public shell renders logged-out, schema smoke-tested via rollback transaction, security advisors show nothing new.

## 2026-07-13 — Pipeline lead detail as intercepted-route modal

- Lead clicks from kanban/table/completed now open the detail in a Dialog while `/pipeline/<id>` keeps working as a direct URL (paste/refresh/share → full page). First parallel/intercepting routes in the app: `@modal` slot in the authenticated layout + `@modal/(.)pipeline/[id]`; call sites unchanged (`router.push` gets intercepted).
- Refactor: `pipeline/[id]/page.tsx` fetching moved to shared `lead-detail-content.tsx`; `LeadDetail` gained `variant` ("modal" → header X + delete close via `router.back()`); new `lead-detail-modal.tsx` (Dialog shell with Suspense) and `lead-detail-skeleton.tsx` (also used by a new `[id]/loading.tsx`).
- Verified in the browser: modal opens from all three views, ESC / click-outside / browser back close to the board, direct URL renders the full page, console clean. Gotchas recorded in `decisions.md` 2026-07-13 (optional catch-all crashes dev server; `next typegen` needed after adding the slot).

## 2026-07-12 — Lead outcome + attribution UI (migration 044)

- Aaron confirmed the landing's real payload and offered to send JSON matching our schema, so attribution needed almost no code — just the field contract (his `landing` → our `landing_page`) and a new `msclkid` column. His two API asks (stage timestamps, queryable gclid) were already live from 043.
- Migration 044 (**applied to prod**): `lost_at`, `lost_reason`, `msclkid` (+ index) on `leads`. New `markLeadLost` action (archives + records reason) and `unarchiveLead` clears the lost fields on reactivate; `LEAD_LOST_REASONS`/`leadOutcome` in `lib/leads.ts`. `msclkid` added to `ATTRIBUTION_FIELDS`.
- API `/api/v1/leads`: new `outcome` = won→lost→open (won precedence), `is_won` kept as alias, `lost_reason` top-level, `msclkid` in `attribution`, `lost_at` in `timeline`.
- Lead detail (`lead-detail.tsx`): "Mark as Lost" action w/ reason select (hidden once won/lost), Lost banner, conditional Attribution block, Qualification block from `attribution_extra` ("PM · 12 properties"), and the stage-history timeline from `lead_stage_events` (fetched in `[id]/page.tsx`). CSV export gains outcome + attribution columns.
- **Verified**: typecheck clean; webhook with Aaron's real shape populates utm/gclid/msclkid columns and drops qualifier + `page`/`gbraid` into `attribution_extra`; API returns `outcome` lost/won/open with correct precedence and no `assembly_client_id` leak; security advisor shows no new findings. Browser UI check pending a logged-in session (dev server requires auth; didn't log in). Test data cleaned. **Pending: deploy.**

## 2026-07-10 — Assembly onboarding app production contract

- Audited the deployed RevFactor onboarding app against Hub's existing client, listing, Assembly, Stripe, and legacy onboarding models.
- Added additive migration `042_client_onboarding_runs.sql` for multi-run onboarding, child listing parentage, normalized per-listing pricing, run-scoped shared events/comps, questionnaire/readiness answers, client/team tasks, and Assembly file metadata.
- Added Hub TypeScript contracts for the new run records and documented the Assembly identity, Stripe entitlement, optimistic concurrency, and preview-to-production boundaries.
- Tightened migration 042 from blanket authenticated access to the existing onboarding permission model. Added separate exact draft/submitted JSON snapshots and a service-role-only, revision-checked autosave RPC so incomplete client drafts remain resumable without forcing partial data into analytical tables.
- Added guarded Stripe entitlement provisioning from explicit subscription or Price/Product metadata. It aggregates all billable subscriptions linked to a Hub client, creates deterministic initial/additional-property runs, and sends ambiguous decreases, active-draft changes, or child-only additions to manual review.
- Added Assembly attachment metadata and a submission-notification delivery outbox to migration 042. Files remain in Assembly Files; notification delivery is tracked per internal recipient and can fail/retry without changing the submitted run.
- Added a service-role-only internal verification RPC. It records the Assembly internal reviewer, verifies only client-submitted tasks, and atomically advances run status to `in_review` or `ready_for_launch` when all tasks are complete.
- The migration was authored and type-checked but not applied to a Supabase project; the current Hub onboarding UI remains on the legacy checklist tables.

## 2026-07-10 — Leads Read API + Full-Funnel Attribution (migration 043)

- Marketing asked for a read endpoint to tie lead source → booked call → closed deal. The blocker was data, not the endpoint: no UTMs, no stage history, no conversion timestamp. Migration 043 adds nine attribution columns + `attribution_extra` jsonb, `converted_at`, `lead_stage_events` (written by a `SECURITY DEFINER` trigger so admin-client writes are captured), the first `updated_at` trigger on `leads`, and the `api_keys` table. Won = `assembly_client_id IS NOT NULL`.
- New: `GET /api/v1/leads` (keyset pagination, `updated_since`, per-lead `attribution` + `timeline`), `lib/api-auth.server.ts` (Bearer `rvf_live_…` → sha256 lookup → scope check), `lib/lead-attribution.ts`, `scripts/create-api-key.ts` / `revoke-api-key.ts`. `new-lead` webhook extended backward-compatibly; `createAssemblyClientForLead` now stamps `converted_at`.
- **Applied to production and verified end-to-end.** 139/139 leads backfilled with one synthetic event, 15 `converted_at`. Trigger tested: stage changes recorded, non-stage updates and same-stage writes produce none, a regression + re-entry keeps the first milestone, `changed_by` captures `auth.uid()` for UI users and stays null for webhook writes. API tested: 401/403/400/200, keyset walk covers 139 unique across 3 pages, `is_won` = 15, and the projection leaks none of `description`/`project_name`/`assembly_client_id`. Webhook tested: old email-only body still 201, dedupe backfills attribution first-touch-only, top-level overrides nested, unknown keys land in `attribution_extra`. Test rows and temp keys deleted.
- Supabase security advisor surfaced two issues introduced here, both fixed in a follow-up migration and re-verified: `set_updated_at` had a mutable `search_path`, and both trigger functions were exposed as PostgREST RPCs (`REVOKE EXECUTE`; Postgres checks EXECUTE at `CREATE TRIGGER` time, not at fire time, so the triggers still fire — confirmed under `role authenticated`).
- Behavior note: the `updated_at` trigger means kanban reordering (`sort_order` writes) now bumps `updated_at`, so reordered leads reappear in marketing's incremental sync. Harmless — their sync is an upsert.
- Docs: `project-map.md`, `conventions.md`, `integrations.md`, `decisions.md`, and a full rewrite of `docs/webhook-pipeline-integration.md` (which had documented `project_name`/`full_name` as required — the code never enforced that). That file is the contract to hand to marketing.
- **Pending:** deploy, then issue marketing's key with `scripts/create-api-key.ts`. Deferred: a Settings → API Keys UI.

## 2026-07-09 — Lead Webhooks: Verified Scheduler, Implemented new-lead

- Audited scheduler → pipeline flow end-to-end: `revfactor-scheduler` already forwards bookings (`src/app/api/book/route.ts`), Hub `/api/webhooks/scheduler` verified live in production (test POST created a Meeting lead, then deleted). Secrets match between both `.env.local`s. Open item: cannot verify `HUB_WEBHOOK_URL`/`HUB_WEBHOOK_SECRET` exist in the scheduler's Vercel production env (team `federico-zimermans-projects`); zero `lead_source='scheduler'` leads in prod DB.
- Implemented `app/api/webhooks/new-lead/route.ts` for generic landing-page leads (home email capture): email-only required, email dedupe against active leads, stage `inquiry`. `WEBHOOK_SECRET` generated in `.env.local`; **pending: add to Vercel + deploy**. Tested locally (401/400/201/200-deduped). `pnpm typecheck` clean. Docs: `docs/agent/integrations.md` rewritten for both webhooks.

## 2026-07-08 — SEO Metrics Upload: Partial/Single-Listing Exports

- Settings → Listings SEO upload now replaces rows scoped by download date **and** the Airbnb IDs in the file (`clearSeoMetricsForUploadAction`, ID list chunked ×200 for PostgREST URL limits; null-ID rows cleared only when the file has them). Single-listing Rankbreeze exports refresh just that listing instead of wiping the date's snapshot.
- Same uploader/UI handles full and partial files (the preview badge already shows listing count); card description updated. `pnpm typecheck` clean.

## 2026-07-08 — Rankbreeze Link on Listing Detail

- Listing detail header (`listings/[id]/listing-detail.tsx`) gains a Rankbreeze button next to Airbnb/PriceLabs: outline button to `app.rankbreeze.com/rankings/<rankbreeze_id>` when the association exists; amber alert variant (AlertTriangle, tooltip → Settings → Listings SEO upload) linking to the rankings home when it doesn't.
- `listings/[id]/page.tsx` derives `rankbreezeId` from `seo_metrics_raw` in parallel with `getListingReport`, matching `airbnb_id` against `listing_id` and the numeric ID in `airbnb_link` (newest row wins; `idx_seo_raw_airbnb` already existed).
- Migration `040_seo_metrics_read_policy.sql` applied to prod: SELECT policy on `seo_metrics_raw` via `has_permission('listings','view')`.
- Verified both states in the browser; `pnpm typecheck` clean.

## 2026-07-06 — Adjustments Types & Origin (spec v0.1)

- Migration `039_adjustments_types_origin.sql` (written, **not yet applied**): renames `adjustments.tag` → `type`, widens the CHECK to 12 values, adds `origin` (`client`/`internal`/`hostpricing`, default `internal`). Must be applied back-to-back with the deploy (old code selects `tag`).
- `lib/adjustments.ts`: `ADJUSTMENT_TYPES` (12 spec labels), `ADJUSTMENT_ORIGINS`, `ADJUSTMENT_TYPE_CONFIG` per-type field config (shows/requires target, dates, booking window + dynamic placeholder), shared `validateAdjustmentInput()` normalizer used by both the dialog and the server actions, `isEscalated()`, `adjustmentStatusLabelFor()` ("Pending approval" for hostpricing+open), `SETUP_CONTROL_CHECKLIST`.
- Dialog: Type + Origin selects, conditional fields per type, setup mode (forced single_listing, hidden target/dates/booking window), owner-message hint when `origin=client`, values preserved on type switch (server nulls hidden fields on save).
- Queue: "client escalation" flag (high urgency + client origin, sorts first within high), origin badge for non-internal, hostpricing approve/deny labels, setup verify hint in Awaiting control. Card: origin line, escalation badge, "Approve proposal"/"Deny" for proposals, static setup checklist before Confirm control. Public shell exposes `type` but **not** `origin`.
- `pnpm typecheck` clean; decisions recorded in `decisions.md` (2026-07-06).

## 2026-07-03 — Adjustments Queue UX (filter, edit, inline control, collapsed closed)

- `/adjustments` gains: client filter (Select over clients present in the data, filters all three sections), Edit menu item + edit mode in `AdjustmentDialog` (only while status ∈ `OPEN_STATUSES`; `updateAdjustment` server action re-checks status server-side), inline "PriceLabs" link + "Confirm control" button on Awaiting-control rows (control still permission-gated via `canControl`), and Recently closed collapsed to 3 rows with a Show all/Show less toggle (`collapsedLimit` prop on `QueueSection`).
- `AdjustmentDialog` save is wrapped in try/finally so a thrown server action doesn't leave the button stuck on "Saving…". The listing auto-pick effect now preserves a prefilled listing that belongs to the selected client.
- Verified E2E in the local app with temp SQL rows (deleted after): edit prefill+save persisted, Confirm control set `reviewer_id`/`controlled_at`, filter and collapse behaved; `pnpm typecheck` clean. Note: newly added server actions 500 under Turbopack HMR (`reading 'apply'`) until the dev server restarts.

## 2026-07-03 — Airbnb OG Image on Adjustments Share Card

- `/a/[token]` `generateMetadata` now scrapes the Airbnb room page's `og:image` for single-listing adjustments so WhatsApp previews show the listing photo; portfolio scope / scrape failure falls back to the RevFactor logo.
- New `lib/airbnb-og.server.ts` (browser UA required, 24h Next data cache, 4s race timeout, no DB persistence) and `airbnbRoomUrl()` in `lib/adjustments.ts`. Details in `integrations.md`.
- Verified locally: curl of the share page returns the `a0.muscache.com` image in the meta tag; `pnpm typecheck` clean.

## 2026-07-03 — RLS Hardening (038) Before India Contractor Accounts

- Migration `038_rls_hardening.sql` (written + applied to prod via Supabase MCP): all `USING (true)` SELECT policies → `has_permission(resource,'view')` (019 pattern); leftover `USING (true)` writes on tasks/leads/roadmap/knowledge/onboarding-progress → `create`/`edit`/`delete`; author-own comment INSERTs now also require the module's `view`.
- Found and fixed two extra holes while auditing `pg_policies`: users could self-promote via `UPDATE profiles SET role=…` (now blocked by `profiles_role_guard` trigger, super_admin/admin-client exempt), and `post_with_counts`/`knowledge_category_article_counts`/`seo_metrics` were definer views bypassing RLS (now `security_invoker = true`).
- New `clients_basic` definer view (`id, name, status`) + switched the Adjustments queue and `/a/[token]` authed queries from `clients(id, name)` to `clients:clients_basic(id, name)` so contractors resolve client names without reading `clients` (billing, `dashboard_token`, emails stay locked behind `clients:view`). PostgREST embeds the view through the underlying FK without hints.
- `financial_*` and `expense_listing_allocations` were already super_admin-only (`ALL` policies); `notes`/`calendar_events` tables don't exist (resources only); `pricelabs_reservations_airbnb`/`seo_metrics_raw` are RLS-enabled with no policies (deny; admin-client only).
- Verified with a temp SQL-created user (deleted after, no orphan rows): as super_admin — dashboard, clients (+detail with billing/credentials), listings, financials, tasks, pipeline, adjustments, roadmap, knowledge, onboarding, `/a/<token>` all render with data; `pnpm typecheck` clean. As contractor — REST with the user's JWT returns `[]` on 28 sensitive tables and errors on role PATCH / tasks / leads inserts; UI sidebar = Dashboard/Adjustments/Settings, queue + card fully operable (posted note, marked resolved, no control button), `/financials` redirects, dashboard degrades to zeros without crashing.
- Docs updated: decisions.md (closure entry + accepted residuals incl. admin's `financials:view=true`), conventions.md (permission-based RLS rules, `clients_basic`, role-guard trigger, `security_invoker` default), project-map.md (038 + views), CLAUDE.md/AGENTS.md (critical rule, kept identical). **India contractor accounts are now unblocked**; `WHATSAPP_GROUP_INVITE_URL` in Vercel prod still pending.

## 2026-07-03 — Adjustments Module (v1)

- New module converting WhatsApp change requests into atomic, traceable records. Migration `037_adjustments.sql`: `adjustments` + `adjustment_comments` tables, RLS via `has_permission('adjustments', …)`, seeds for super_admin/admin, and a widened `role_permissions.action` CHECK adding `publish` (fixing code/DB drift from the knowledge module) and the new `control` action.
- Flow: create dialog (lazy-fetched client/listing options; single-listing clients auto-select) → on save copies the `/a/<public_token>` share link and opens the WhatsApp group (`WHATSAPP_GROUP_INVITE_URL` env; a single deep-link can't open a group AND pre-fill text) → team opens the card → resolver marks `resolved` → an internal with `adjustments:control` marks `controlled`. `issue`/`rejected` require a note (enforced in the server action, stored as a comment). "Copy WhatsApp update" builds the ✅ close-the-loop message.
- `/a/[token]` is "public shell + authed core" on one URL: `generateMetadata` OG tags (first OG use in the repo; client+listing shown by decision) + non-sensitive read-only shell fetched with the admin client (RLS blocks anon), full card with notes/actions behind a session. `proxy.ts` now exempts `/a/` and `/api/` (see decisions.md — the `/api/` interception was also breaking webhook-style auth).
- Triage queue at `/adjustments`: open items by urgency+age with stale flags (high urgency ≥2 days), "awaiting control" mini-queue, recently closed; `loading.tsx` skeleton. Per-client changelog card appended on `clients/[id]`. Sidebar is now permission-filtered (`resource:view`) with an Adjustments item; backfilled missing `knowledge` rows for admin/super_admin in the live `role_permissions` so nothing disappears.
- Verified: `pnpm typecheck` clean; public shell, OG meta, PriceLabs/Airbnb-multicalendar shortcuts (both the pricelabs_link and airbnb_link-regex paths), 404 on bad token, and webhook 401-not-redirect all confirmed live with a temporary DB row (deleted after). Authed views (queue, create dialog, card actions, client block) compile but need a logged-in visual pass — no credentials in the preview browser.
- Contractor role created same day (`adjustments:view` + `edit` only — `control` deliberately withheld so India can't self-control; an initial all-actions toggle was corrected). Portfolio-scope cards ship without a per-listing shortcut and that's final — the plan's "group URL" open item turned out to be the WhatsApp invite (configured via `WHATSAPP_GROUP_INVITE_URL`), not a PriceLabs group view.
- Pending: RLS hardening BEFORE creating India accounts (decisions.md 2026-07-03); set `WHATSAPP_GROUP_INVITE_URL` in Vercel prod.

## 2026-06-24 — Monthly Pacing Chart

- Added a monthly stacked-column pacing chart to the dashboard home, mirroring the daily Pacing chart but built on `report_metrics` (Report Builder monthly grid).
- New files: `lib/monthly-pacing.ts` (fetch + aggregate), `components/dashboard/monthly-pacing-chart.tsx`. Wired through `app/(authenticated)/page.tsx` → `dashboard-view.tsx`.
- Bar height = `adjusted_occupancy_pct`, stacked by booking recency using `occupancy_pickup_7d / 8_14d / 15_30d` (already non-overlapping) + a derived `older` residual; stack sums to occupancy. See `integrations.md` → Monthly Pacing.
- Verified: typecheck passes; occupancy values render and match SQL against the latest completed run.
- Fixed two follow-on bugs found while populating the chart:
  1. **Empty pickup metrics** — `METRIC_FIELD_MAP` in `lib/report-builder/schema.ts` mapped the 10 new 036 metrics to invented friendly labels (`Occupancy Pickup (7 Days)`) instead of the actual terse payload keys (`Occupancy Pickup 7`, `Num Booked Pickup 7`, `Market Penetration Index`, …). Wrong key → silent null → all-zero columns. Corrected the names and backfilled both completed runs from their stored `raw_envelope` via SQL (no PriceLabs re-call).
  2. **Only 5 of 12 months rendering** — `getMonthlyPacingSource` read `report_metrics` in one request; the project's PostgREST `db-max-rows = 1000` capped it to the earliest ~5 months. Switched to `.range()` pagination (`fetchAllMetrics`). See `decisions.md` (2026-06-24).
- Verified end-to-end in the browser: all 12 months render with booking-recency layering; pickup concentrated on near-future months as expected.
- Removed the old mock **daily** Pacing chart from the dashboard home (it only ever ran on `getMockPacingSource`): deleted `components/dashboard/pacing-chart.tsx` + `lib/pacing-mock.ts`, unwired from `page.tsx`/`dashboard-view.tsx`. Kept `lib/pacing.ts` (real reservations data layer, dormant, no UI) + migration 023 + seed script. Monthly Pacing is now the dashboard's only pacing chart.

## 2026-06-23 — PriceLabs Report Builder Integration

- New integration ingesting the PriceLabs Report Builder monthly grid (234 listings × 12 months, 20 listing + 35 month fields) into native Supabase tables, surfaced on each listing's detail page.
- Migration `035_report_builder.sql`: `report_runs` (state machine + observability + pruned `raw_envelope`), `report_listings` (`listing_id` text PK), `report_metrics` (grain listing × month × run, unique `listing_id+period+report_run_id`), `report_group_overrides`; adds `idx_listings_listing_id`; RLS = authenticated SELECT, writes via admin client.
- `lib/report-builder/`: `client.ts` (3-call API, poll keeps `/v1/` + `X-API-Key`), `schema.ts` (rename + 20/35 split + `Year Month`→period), `ingest.ts` (client resolution by Listing ID → Group Name override → name; chunked upsert; prune to last 30 envelopes), `runner.ts` (`advanceReportBuilder` idempotent state machine: reap/resume/trigger + ~45s inline poll), `queries.ts` (`getListingReport`).
- Orchestration: **chained onto the existing `sync-pricelabs` cron** (08:00 UTC) — runs `advanceReportBuilder` after the `pl_*` sync with the remaining function budget (`inlineDeadlineMs`); no new cron job (stays at 2, Hobby cap). Manual **Sync Report Builder** button (same logic via `syncReportBuilderAction`); `/api/cron/report-builder` kept as an unscheduled on-demand endpoint. Group-override management UI in Settings → Listings. Template pinned via `PRICELABS_REPORT_TEMPLATE_ID` (12127), else resolved by name.
- Display: `listings/[id]` Overview "Monthly Revenue" now uses real `rental_revenue`+YoY; new **Year Review** tab (Revenue/STLY/YoY, RevPAR vs market, RevPAR Index, occupancy, booking window). Degrades to empty/mock when no completed run matches.
- Verified: `pnpm typecheck` clean; `pnpm lint` clean for all new/changed files (pre-existing errors elsewhere untouched). NOT yet verified in-browser: needs migration `035` applied to Supabase + one sync run (live API). Confirmed by user: same `PRICELABS_API_KEY`, template id `12127`.
- NOTE: an early version wrote files to the main repo path instead of the worktree; corrected — all changes now live on branch `claude/vibrant-montalcini-b959fb`, main restored (its pre-existing `.gitignore` change left intact).

## 2026-06-22 — Reassign a Listing's Subscription

- Root cause of "can't see/change a listing's subscription": the Stripe sync listed subscriptions without `status: "all"`, so canceled subs never entered the `stripe_subscriptions` mirror and a listing linked to a since-canceled sub became invisible in Financials.
- Fixed the sync (`lib/stripe-sync.ts`) to mirror canceled subs, excluding `canceled`/`incomplete_expired` from the single-subscription payout-attribution fallback maps so reconciliation is unchanged.
- Added `setListingSubscription(listingId, subscriptionId|null)` action (only touches that listing; does not clear sub-mates like `linkSubscriptionToListings`).
- Listing detail page (`listings/[id]`) now shows a `super_admin`-only Subscription card + `change-listing-subscription-dialog.tsx` to view/reassign/clear the listing's subscription (current sub shown even if canceled/orphaned).
- `link-subscription-dialog.tsx` now names the _other_ subscription a listing is attached to (customer + status) instead of a generic note; `subscriptions` array passed from the table and new-subscriptions section.
- Verified end-to-end in the running app: typecheck clean; the orphaned canceled link rendered as "Not found in Stripe / canceled"; reassigned the real case (Beach Rd | FL | Trey → `sub_1TjiRc…` K Properties) and confirmed in DB; Financials dialog showed "linked to Jane Ng · active".

## 2026-06-15 — Quick-add Listing inside Link-Subscription Dialog

- Added a "New listing for {client}" quick-add form inside `link-subscription-dialog.tsx` (shown when the subscription's customer maps to a Hub client). It calls the new `createListingForClient` action (inserts an active listing for the client, returns the id), auto-selects it, and `router.refresh()` so it appears in the list. Speeds up onboarding new clients with no listings.
- Verified typecheck clean / page renders; could not open the dialog via the automated preview (an environment quirk blocks opening dialogs in the New-subscriptions section — the untouched "Link existing" button also fails to open there), so visual confirmation is pending a real-browser click.

## 2026-06-15 — Removed Recurring Tab; Outlook Uses Real Expenses

- Removed the Financials Recurring tab and everything behind it (`recurring-expenses-table.tsx`, `recurring-expense-dialog.tsx`, and the 5 recurring server actions). Costs are managed only through `expenses`.
- "Operating outlook" forecast and its displayed monthly-expenses figure now use the trailing 3-month average of real expenses instead of the recurring-expense template. `recurring_expenses` table kept (bank import match + planning seeding remain but dormant). Verified live: tabs are Overview/Planning/Subscriptions/Expenses/Bank, outlook shows "Monthly expenses (avg. 3m) $5,273".

## 2026-06-15 — Unit Economics Monthly Evolution

- Added a month-by-month evolution (Jan of current year → current month) below the aggregate unit-economics card: a `ComposedChart` (contribution bars + margin % and OPEX restante % lines, dual axis) with the full monthly detail table rendered inline directly below the chart (no modal). Bumped `stripe_payout_transactions` fetch in `page.tsx` to `.limit(5000)` so the full year resolves.
- New index **OPEX restante %** = (25%-of-monthly-income OPEX budget − all month expenses) / budget; goes negative when costs exceed the Profit First OPEX bucket (e.g. April showed -27%). Extracted `buildListingCash(payoutIds)` helper reused by current-month and per-month series.
- Verified: typecheck clean; modal table shows correct Jan–Jun figures (e.g. May income $43,255 / contribution $38,092 / margin 98% / OPEX restante 68%). The recharts chart could not be visually confirmed — the preview viewport collapsed to ~1px this session, leaving all charts (including the pre-existing Cash trend) at 0 width; the chart reuses the existing proven ChartContainer pattern.

## 2026-06-15 — "Add to Expenses" Action on Bank Transactions

- Added `addBankTransactionToExpense` and a per-row "Add to expenses" button in the Bank tab for transactions without a linked expense (any flow class), so rows unchecked at import or misclassified can be pushed to Expenses post-import. Reuses the importer's category/recurring suggestion logic and links via `bank_transaction_id`. Verified live (creates linked expense; FK SET NULL restores the button on delete).

## 2026-06-15 — Unit Economics Aggregated; Unallocated Variable Expenses Hit Margin

- Reworked the Overview "Listing unit economics" from a per-listing table into an aggregate: listing count (with attributed cash), total cash / variable expenses / contribution + margin %, and per-listing averages.
- Variable expenses now reduce the total margin whether or not they are allocated to a listing (sum of all current-month variable expenses), so bank-imported variable spends impact margin without manual allocation. Removed the "variable expense has no listing allocation" attention alert. Verified live (143 listings, $28,736 cash, 100% margin with no June variable expenses yet).

## 2026-06-15 — Fix Listing Unit Economics (payout→subscription linkage)

- Diagnosed the empty "Listing unit economics" table: all `stripe_payout_transactions.subscription_id` were null because the `2026-05-27.preview` API dropped `charge.invoice` / top-level `invoice.subscription`; the table attributes payout cash to listings only through that field.
- Fixed `lib/stripe-sync.ts` to read `invoice.parent.subscription_details.subscription`, build a `payment_intent → subscription` map from invoice `payments[]`, and resolve transactions by charge `payment_intent` (single-subscription `customer` fallback). Softened the misleading empty-state copy.
- Backfilled existing rows in place (548 resolved; rest are non-subscription entries). Verified live: current-month unit economics now shows 142 rows, ~$28.7k cash attributed. Also changed the Expenses table to show "N listings" instead of listing names.

## 2026-06-15 — Bank Statement Import & Reconciliation

- Added Relay CSV bank statement integration: migration `033_bank_statements.sql` (`bank_accounts` seeded with roles, `bank_statement_imports`, `bank_transactions`, `expenses.bank_transaction_id`), pure `lib/bank-import.ts` (parser/classifier/matchers/dedupe), `commitBankImport` action, and a Financials **Bank** tab (`bank-section.tsx`, `bank-import-dialog.tsx`, `bank-flow.ts`) plus an Overview reconciliation strip.
- Classifier keys off Relay `Transaction Type`; transfers (Profit First + inter-account) are excluded; real spends auto-create deduped linked expenses with suggested categories and recurring matches; Stripe deposits reconcile to `stripe_payouts`. Stripe stays the source for subscriptions/payouts.
- Verified: migration applied to dev project, `pnpm typecheck` clean, engine run against the two real May exports produced exactly the expected split (18 deposits matched, $50 bonus unmatched, 76 transfers excluded, 9 expenses = $3,441.09), `/financials` route compiles/renders the Bank tree with no errors. Browser screenshot of the logged-in Bank tab pending a user login (magic-link signup disabled; did not bypass auth).

## 2026-06-15 — Financial Cash Overview and Planning

- Replaced invoice-based Overview metrics with paid Stripe payout cash, per-payout Profit First allocations, OPEX capacity, runway, reconciliation alerts, and listing unit economics.
- Extended the Stripe mirror and daily cron with payouts and reconciled balance transactions.
- Added exact listing allocation for variable expenses and saved 12-month scenarios with listings, expenses, growth investments, capital contributions, comparison charts, and monthly cash plans.
- Added manual operating/tax cash snapshots and kept all Financials data/actions `super_admin` only.
- Verified the live Supabase preview with 162 Stripe payouts and 1,369 reconciled balance transactions; payout sync now skips complete historical reconciliations and reports payout warnings in the UI.
- Changed Clients Billing to derive current monthly totals from Stripe subscriptions linked through `client_stripe_customers`, including list, detail, and CSV export.
- Removed listing-attribution warnings for accumulated payouts and made split variable expenses default to all active listings with an exact even allocation.
- Next phase: inspect payout-account and OPEX-account statement exports, then design bank transaction import, payout reconciliation, internal transfer detection, and OPEX classification.

## 2026-06-11 — Client Pricing Dashboard Link

- Added a compact Pricing Dashboard copy action to client detail pages using `clients.dashboard_url`.
- Added accessible copy confirmation, unavailable state, Clipboard API error handling, and a legacy copy fallback.
- Removed the client detail dependency on `dashboard_token` and kept private URLs out of logs and error messages.

## 2026-06-09 — PriceLabs Sync Diagnostics

- Centralized manual and cron PriceLabs synchronization in `lib/pricelabs-sync.ts`.
- Normalized non-numeric `"Unavailable"` values and invalid `"-"` dates to `null`.
- Added per-listing `synced`, `not_found`, and `failed` results, structured logs, and Settings sync status visibility.
- Preserved synchronization for duplicate PriceLabs IDs while logging duplicates for cleanup.

## 2026-06-05 — Client Detail Stripe Checkout

- Added a `super_admin`-only Stripe customer + subscription Checkout flow on client detail pages.
- Uses `client_stripe_customers` as the Stripe/client source of truth; `clients.stripe_customer_id` is not required.
- Subscription type options are deduced from existing Stripe subscriptions and active recurring prices.

## 2026-06-04 — Agent Memory Split

- Compared `AGENTS.md`, `CLAUDE.md`, and scoped authenticated docs.
- Synchronized missing Pacing Chart and reservations details into agent-facing documentation.
- Converted root `AGENTS.md` and `CLAUDE.md` into short routing files.
- Added shared durable memory under `docs/agent/` for project map, conventions, integrations, performance, decisions, and sessions.
- Replaced scoped authenticated agent files with pointers to shared performance/convention docs.

## 2026-07-29 — Governed Agent Studio

- Added and applied migration 050 with durable runs, traces, model estimates, feedback, evaluations, health, settings, approvals, and audit history.
- Added immutable playbook promotion, prompt-injection regressions, and Assembly shadow capture with redaction and no send path.
- Verified an authenticated Gemini Flash Lite run, durable cost/latency, rating, audit trail, and health checks. Local AI Gateway is connected; local Assembly and PriceLabs keys remain unconfigured.
- Added Knowledge agent-readiness governance and applied migration 051. Added FAQ intake, approved-answer/escalation/source/review fields, publisher approval, readiness counts/badges, and agent-safe retrieval filters.
- Connected Studio “Knowledge change” feedback to disabled FAQ drafts. Classified the existing OTA Markup Policy under Pricing Strategy with FAQ/Policy tags and left its factual answer unapproved.

## 2026-08-02 — Agent Studio terminology and PriceLabs health simplification

- Clarified throughout Agent Studio that a playbook is a saved agent instruction set and that the future live agent will use one default production playbook; focused playbooks remain test variants rather than an automatic routing system.
- Reworded Evaluations as a three-step workflow for non-technical operators while preserving the four-model comparison and manual review requirement.
- Changed PriceLabs health to show the integration as connected when a fresh portfolio sync exists, with plain-language named notes for missing-ID, never-synced, and individually stale listings. Added pure health summarization tests.

## 2026-07-29 — Production Agent Studio and First Assembly FAQ Batch

- Deployed Agent Studio and Knowledge governance to `hub.revfactor.io` through PR #12 and verified the authenticated production route, model picker, governance tabs, audit ledger, and integration-health UI.
- The production AI Gateway credential is configured, but the live smoke run reported insufficient Gateway credit; Assembly and PriceLabs direct API credentials remain unavailable to Studio while synced Hub data is still readable.
- Analyzed the supplied Assembly frequent-question report: 116 candidates, 11 repeated patterns, and 105 one-offs. Raw samples include sensitive material, so none were copied into the repository or Knowledge.
- Added migration 052 with three sanitized FAQ drafts, governed fields for four overlapping team-authored drafts, and a proposed update to the existing OTA markup policy. The final queue has eight review items; every item is unpublished, `needs_review`, agent-disabled, and sourced only to aggregate pattern counts.

## 2026-04-18 — Authenticated Routes Performance Pass

- Documented query trimming for clients/listings list views.
- Established lazy dialog lookup data loading for listing dialogs.
- Added or documented loading skeleton expectations for authenticated list/detail routes.
- Captured rejected caching and streaming approaches for current scale.

## 2026-08-21 - Highland Trace performance opportunity brief

- Created an eight-page, client-ready RevFactor PDF for 1343 Highland Trace in Blairsville, Georgia.
- Framed the evidence as a conversion constraint rather than a visibility problem: strong RankBreeze discovery signals, PriceLabs ADR above market but occupancy and RevPAR below market, and a 2025 result slightly above the capacity-matched AirROI median.
- Used a 10-listing AirROI comp set restricted to 3 bedrooms, 6-8 guests, and 2-3.5 bathrooms; excluded the subject and rejected the broader $85.6k subject estimate as the planning anchor.
- Set gross planning bands at $33k-$36k stabilized, $38k-$43k realistic managed target, and $45k-$50k strong; included booking-window strategy, 30/60/90-day actions, questions for the stakeholder, and visible evidence limitations.
- Final artifact: `output/pdf/RevFactor_Highland_Trace_Performance_Opportunity_Brief.pdf`; builder and source notes are under `tmp/pdf_build/highland_trace/`.
- Correction: this property brief is unrelated to Tim or Corzly and must not be used for that portfolio discussion.

## 2026-08-21 - Corzly portfolio booking intelligence brief

- Reused the validated Corzly OwnerRez analysis and corrected the seven booking-code model: SLI, LLS, LLL, EBL, GLL, FLT1, and FLT2 are not seven physical properties.
- Created an eight-page Tim-facing PDF that frames Corzly as a long-lead, large-group, quote-and-negotiation business rather than a standard instant-book STR portfolio.
- Highlighted $4.61M across 238 analyzable bookings, 98.0% value concentration in SLI plus the Long Lake Shores family, 61.1% of gross value booked 181+ days out, and 45.6% of gross value from 40+ guest bookings.
- Recorded the operating hierarchy: LLS is the Long Lake Shores parent, while LLL and GLL are its children. FLT1 is a temporary discount and assignment code whose reservations must be reattributed to the final occupied property; FLT2 remains operationally unconfirmed.
- Clearly separated what the booking export proves from what requires the next data layer: inquiries, quote versions, discounts, itemized extras, won/lost reasons, seller touchpoints, booking-code transfer history, final occupied property, and collected cash.
- Added a dedicated commercial-questions page covering premium bookings versus useful fillers, OTA displacement, long-lead fixed pricing, Balsam Lake opportunity cost, child-to-parent upgrades, FLT1 routing economics, concessions, amenity attach rates, corporate retreats, and codifying the owner's sales playbook.
- Final artifact: `output/pdf/Corzly_Luxury_Portfolio_Booking_Intelligence_Brief_for_Tim.pdf`; builder and source notes are under `tmp/pdf_build/corzly/`.

## 2026-08-21 — Event Intelligence discovery and PredictHQ case study

- Reviewed the supplied PredictHQ discovery-call notes, official provider documentation, the Hub's current PriceLabs/Revenue Manager/Adjustments architecture, and a live 90-day PredictHQ API sample. No token or raw provider payload was committed.
- Aggregated the live active PriceLabs footprint to 351 coordinate-complete listings across 162 raw city/state labels. A geographic sensitivity check produced 119 connected clusters at 15 miles and 96 at 30 miles; raw labels include three missing states, duplicate United States naming, and at least one coordinate/state contradiction.
- Sampled Washington, DC; Tucson; Myrtle Beach; Park City; and Gatlinburg/Smokies with PredictHQ's accommodation Suggested Radius. Demand Surge returned 3, 2, 2, 0, and 0 dates respectively; destination feeds still contained material events, so Surge cannot be the sole gate. A naive `local_rank >= 50` retained 92%–99% of events in four destination markets, demonstrating the need for market-specific materiality and booking-vulnerability scoring.
- Calculated commercial sensitivity from call-note sticker prices: $210,600/year for all 351 properties before volume discount (16.7% of the stated $300/listing/month fee base), while treating every raw label as a small city starts at $405,000/year. These are assumptions, not a quote or ROI result.
- Created `docs/event-intelligence-design.md` with the proposed source stack, two detection horizons, governed market registry, event/evidence/version lifecycle, human approval gates, provisional data model, `/market-signals` placement, scheduling options, five-market pilot, metrics, and phased delivery.
- Created and executed `docs/analysis/event-intelligence/event-intelligence-case-study.ipynb` (8/8 code cells, zero errors), wrote a validation note assessed “Share with caveats,” and generated `report.html` from the canonical artifact. Packaging verification passed for two charts, three metric cards, three tables, source interaction, and desktop/390px viewports.
- Updated `project-map.md`, `integrations.md`, and `decisions.md`. No production route, migration, cron, ingestion, or external write path was added.

# 2026-08-21 — Market Signals production foundation

- Reviewed the Grok `revfactor-event-pricing` prototype and retained its strongest concepts: two detection clocks, market-specific radii, an operator queue, and learning from property outcomes.
- Added migration 076 with permission-based RLS for governed markets/listing membership/source health, canonical events/provider records, immutable versions/evidence, event-market impacts, and append-only human review decisions. Seeded the five pilot markets as drafts requiring explicit activation; migration was not applied.
- Added `lib/market-signals/` contracts/domain/repository with source-independent fingerprints, title-specific recurring families, cancellation/date-change detection, evidence-gated review/unwind decisions, and bounded proposals that never invent ADR percentages.
- Added the authenticated `/market-signals` route, loading skeleton, sidebar/command/breadcrumb registration, readiness/staleness visibility, and Needs Review/Announcements/Changed/Watchlist/Markets views. The route fails closed before migration 076.
- Verification: all 116 repository tests passed, including 14 new Market Signals tests; `pnpm typecheck` and `pnpm build` passed. New Market Signals files lint clean. A pre-existing `react-hooks/set-state-in-effect` error remains in `components/layout/top-bar.tsx` and was not changed by this work.

# 2026-08-21 — PredictHQ pilot ingestion slice

- Extended unapplied migration 076 with one disabled, bounded PredictHQ Events source definition per draft pilot market; no token or automatic activation is stored in SQL.
- Added the PredictHQ response/query adapter, accommodation impact-window normalization, materiality scoring, update/cancellation polling, source-host pagination validation, and idempotent canonical event/provider/version/evidence/impact persistence with visible source health.
- Added Market Signals editor actions to propose active PriceLabs Report Builder listings by reviewed radius, approve/activate a pilot, and sync it manually. Added a `CRON_SECRET`-protected all-active-market route but left `vercel.json` unchanged because its two existing cron slots and the deployment plan need confirmation.
- Updated the Markets UI with runtime readiness, source status, prepare/activate/sync controls, Sonner feedback, and no PriceLabs/PMS/OTA mutation. The shared token from discovery was not reused; `PREDICTHQ_ACCESS_TOKEN` requires a rotated server-side value.
- Verification: all 126 tests pass, `pnpm typecheck` passes, and targeted Market Signals lint passes after adding adapter/security/materiality coverage.

# 2026-08-21 — Market Signals schema activation

- Applied migration 076 directly to the linked `revfactorHub` Supabase project and recorded version `076` as applied without touching pending Revenue Manager migration 075.
- Verified all nine Market Signals tables have RLS, five draft markets and five disabled PredictHQ sources were seeded, and no market or source was activated.
- Prepared 36 coordinate-matched listing memberships as `proposed` across the five draft markets. The authenticated preview now reads the live records; ingestion remains blocked until a rotated PredictHQ token and server-side Supabase credential are configured in the actual Hub deployment.

# 2026-08-21 — Washington and Smokies pilot activation

- Separated authenticated market/listing approval from credential-gated source activation. Market approval now runs through the signed-in editor's RLS-scoped Supabase session and records the reviewer; PredictHQ remains disabled without its rotated token.
- Activated Washington, DC with 3 approved listings.
- Corrected the Smokies pilot to a 10-mile corridor centered between Sevierville, Pigeon Forge, and Gatlinburg. The revised footprint retains all 24 prior matches and adds 16, for 40 approved listings with none outside the reviewed radius. Added migration 077 to preserve the registry correction.
- Verified both markets are active, both reviewer timestamps are present, and both PredictHQ sources remain disabled. `pnpm typecheck` and targeted Market Signals lint pass; the authenticated preview shows 2 active markets.

# 2026-08-21 — Agent-managed market monitoring

- Removed the manual prepare/activate controls from Market Signals. The UI now states “AI monitors · humans approve actions,” labels all configured markets as AI managed, and shows credential readiness instead of asking operators to approve setup.
- Added and applied migration 078: `management_mode` on markets, `approval_mode` on memberships, agent-compatible activation constraints, automatic approval of remaining coordinate matches, and activation of all five pilots.
- Updated ingestion so the scheduled/manual sync automatically enables registered PredictHQ sources for active agent-managed markets once both server credentials are configured. No token fallback was added and no source is enabled while credentials are absent.
- Verified the authenticated preview shows 5 active AI-managed markets with 52 approved listings and no activation buttons. Targeted tests (13), `pnpm typecheck`, and targeted lint pass.

# 2026-08-21 — First live PredictHQ beta ingestion

- Loaded the existing PredictHQ trial token and a Supabase secret key only into the local dev-process environment; neither credential was written to the repository.
- Completed first 90-day baselines for Myrtle Beach (111 events), Park City (51), the Smokies corridor (82), Tucson (329), and Washington, DC (300 capped). All five sources report `ok`; 873 provider records deduplicate into 847 active market impacts.
- The first Myrtle pass exposed 83 false action-queue items because unknown booking vulnerability was treated as vulnerable. Migration 079 moved those records to Watchlist and the domain gate now requires a non-null vulnerability score of at least 45; cancellations/postponements still unwind immediately.
- Added six-event persistence batching and migration 080's 300-candidate beta cap after Tucson's sequential first pass took four minutes. Washington completed through the optimized/capped path. This bounds recovery runs while retaining idempotent high-water polling.

# 2026-08-21 — PriceLabs booking-vulnerability layer

- Added and applied migration 081 with permission-gated `market_event_listing_exposures`; no credential or provider payload was written to the repository and pending Revenue Manager migration 075 remained untouched.
- Added deterministic listing scoring from remaining inventory, market occupancy gap, STLY pace gap, and booking-window urgency. Fresh rolling 7/30-day snapshots serve near-term events; event-month Report Builder metrics serve farther-out events. At least half of each market's active approved listings must have evidence no older than 72 hours.
- Integrated scoring into every managed PredictHQ sync and added `scripts/backfill-market-vulnerability.ts` for derived-data recovery. The UI now shows exposed-listing counts, top property names, property/market occupancy, and the evidence horizon.
- The raw first backfill produced 326 eligible items, so bounded prioritization now selects at most five highest-priority distinct event families per market and leaves overflow on Watchlist. The calibrated live result is 18 Needs Review items: Myrtle Beach 5, Park City 3, Smokies 5, Tucson 5, and Washington 0.
- Market Signals still makes no LLM call. Agent Studio's existing Vercel AI SDK `ToolLoopAgent`/AI Gateway stack can later explain stored evidence, while deterministic code continues to own scoring and gates.
- Verification: all 133 repository tests pass, TypeScript passes, targeted Market Signals lint passes, and the authenticated browser preview shows the 18-item queue with live listing exposure details and no activation workflow.

# 2026-08-21 — Governed Signal Brief and reviewer-action workflow

- Added and applied migration 082 without touching pending migration 075. It adds permission-gated, cached/audited Signal Briefs; binds append-only human decisions to a completed brief version; and adds transactional SECURITY INVOKER RPCs to create a bounded internal recommendation Adjustment or link a related open Adjustment.
- Added a no-tool Vercel AI SDK `ToolLoopAgent` through AI Gateway using `openai/gpt-5.6-luna`. Deterministic code still owns scoring, review eligibility, action areas, and missing evidence. Snapshots are fingerprinted and cache-keyed by input hash, prompt version, and model; output is schema-validated and passes deterministic date/commercial-safety grounding checks with one repair attempt.
- Added Signal Brief rendering and Watch, Escalate, Dismiss, Create Adjustment, Link Existing, Retry, and Reviewed UX. A changed snapshot produces a new brief and reopens review. No model or reviewer path writes PriceLabs, a PMS, an OTA, rates, minimum stays, or channel restrictions.
- Backfilled 18 current `signal-brief-v2` records: Myrtle Beach 5, Park City 3, Smokies 5, Tucson 5, Washington 0; all 18 completed and passed a second grounding audit. Browser verification confirmed the generated brief and all three guarded dialogs; every dialog was canceled, leaving zero review rows and zero Market Signals-created Adjustments.
- Verification: 139 repository tests across 22 files pass, `pnpm typecheck` passes, targeted Market Signals lint passes, and the authenticated `/market-signals` route returns 200 with 18 live Needs Review briefs.
- Simplified each queue card for rapid triage: five decision KPIs and one Signal Brief headline now render by default, while the evidence narrative, property exposure, operator note, and model disclosure remain available under an explicit “View full brief” disclosure. Action controls remain visible without expanding the narrative.

# 2026-08-21 — GHL-native onboarding draft

- Built and saved a separate, unpublished GHL client-onboarding funnel and native form; the existing affiliate funnel and production onboarding URL were not changed.
- Connected native form submission to the existing GHL agreement template in a renamed Draft workflow, and replaced the generic form confirmation with agreement/payment/Assembly guidance.
- Saved agreement billing as recurring monthly with invoice-at-signing, direct payment, invoice email, and autopay. Removed the duplicate $150 setup fee from the $350 primary-listing price; kept the separate $150 onboarding product.
- Added a second Draft workflow for successful primary-product payments, client tagging, and an internal Assembly-handoff alert. Nothing was published or sent.
- Added an undeployed authenticated GHL payment webhook to the onboarding app, plus idempotent Hub/Assembly provisioning and tests. Typecheck and the three targeted webhook tests pass.
- Remaining launch blockers: move the form submit button below the custom fields and place/configure the GHL native product-list block in the agreement. Then deploy only to preview, configure the secret/payload mapping, and complete an end-to-end test before any cutover.

# 2026-08-21 — Market Signals 1,000-listing scale pass

- Audited the live five-market pipeline and found 6,537 stored listing-exposure rows for only 52 approved listings, driven by exhaustive impact × listing persistence and request-scoped all-market orchestration.
- Added and applied migrations 083–084 without applying pending migration 075. `market_signal_jobs` now provides per-market deduplication, priorities, atomic leases, expired-lease recovery, bounded retries, terminal errors/results/durations, and service-role-only worker RPCs; scheduled enqueue honors each source's cadence.
- Replaced the all-market cron loop with a once-per-minute Vercel queue worker. Manual refreshes enqueue high-priority jobs, and the PriceLabs cron enqueues provider-independent inventory refreshes. The Market cards show current job status, attempts, duration, and error; terminal failures surface in a page alert.
- Reworked vulnerability reads with pagination/chunking and materiality prefiltering, retained complete-cohort deterministic math, bounded stored evidence to 25 listings for each selected signal, and atomically replaced derived state through one set-based RPC.
- Live backfill reduced exposure storage from 6,537 to 101 rows (98.45%) while preserving 18 Needs Review signals. Five inventory-only jobs all succeeded without a PredictHQ token, averaging 1.079 seconds, with no active jobs left behind.
- Added `pnpm benchmark:market-signals`; the 1,000-listing × 300-impact harness completed 300,000 calculations in 49 ms with 52.9 MB heap and persisted 125 rows (99.96% fewer than the Cartesian product). Added cadence/worker/security migration contracts and bounded-exposure coverage.
- Verification: TypeScript, targeted lint, all 148 tests across 23 files, the 1,000-listing benchmark, and the Next.js production build passed. Local HTTP checks confirmed the authenticated route redirects sessionless traffic and the worker returns 401 without cron authorization. Browser automation could not reload localhost because of the browser URL policy; the local server remains available on port 3001 for a normal user refresh.
- Hardened the older PriceLabs, Stripe, and on-demand Report Builder cron routes to fail closed when `CRON_SECRET` is missing, and added a contract test covering all four privileged cron endpoints.

# 2026-08-22 — GHL same-tab agreement preview

- Added and deployed an isolated staging Worker that upserts the GHL contact/onboarding fields, creates or reuses the existing RevFactor agreement template, obtains a link-only signer reference, and returns a `links.revfactor.io` document URL. The API key is stored only as a Worker secret and browser access is origin-restricted.
- Replaced the unpublished funnel's client-visible native form with a branded GHL Custom HTML/Javascript element, hid the legacy native form/confirmation section, and kept the saved funnel draft unpublished. The form includes primary listing minimum/default 1, optional child listings, optional scheduled start date, live pricing summary, validation, honeypot, and same-tab top navigation.
- Verified an internal repeated submit opened the existing contact-specific GHL agreement in the same tab. The signer page showed primary `$350/month`, child `$50/month` optional/default-off, onboarding `$150` one time, and amount due `$500`; no signature or payment was completed. Remaining release validation is the internal-signer effect on payment, one Stripe Test transaction, and the idempotent Assembly handoff.

# 2026-08-22 — Conditional GHL agreement products

- Created and published a dedicated child-listing agreement template while converting the standard template to primary + onboarding only. The staging Worker now chooses between them from `childListingQuantity`; fresh signer-link QA confirmed `$500` with no child row when unchecked and `$550` with a required child row when checked.
- Repaired the cloned template's incomplete recurring schedule so GHL would accept publication, deployed staging Worker version `239bd9d7-42fc-4cc2-865e-d9b157ce93af`, and added the child-template settings to local/example Worker configuration.
- Added `contact.rf_agreement_effective_date` population and its GHL contact custom field. The page-one agreement boxes are not yet linked because GHL requires precise drag placement in its PDF canvas. Fresh page-four QA showed the signature/name/date overlays aligned correctly. No agreement was signed and no payment was attempted.
- Verification: the targeted HighLevel tests (3) and `pnpm typecheck` pass. Fresh standard and child documents were generated through the staging Worker and inspected without completing their required fields.
