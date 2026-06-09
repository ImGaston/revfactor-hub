# Integrations — RevFactor Hub

## Assembly CRM
Assembly is the client communication platform for CRM, messaging, and contracts.

- API base: `https://api.assembly.com/v1`.
- Auth: `X-API-KEY` header from server-only `ASSEMBLY_API_KEY`.
- API client: `lib/assembly.ts`; keep all Assembly calls server-side.
- Sync strategy: on-demand only; no webhooks, cron, background sync, or cache.
- Graceful degradation: if `ASSEMBLY_API_KEY` is missing, hide Assembly UI.
- Error handling: `assemblyFetch` reads response bodies on errors and logs details.

Client linking:
- Clients link to Assembly by email via `searchAssemblyClientByEmail`.
- Store `assembly_client_id` always and `assembly_company_id` if the client belongs to a company.
- Generate `assembly_link` based on company vs individual context.
- Server actions: `linkAssemblyClientAction`, `unlinkAssemblyClientAction` in settings clients actions.

Pipeline integration:
- `createAssemblyClientForLead(leadId)` finds or creates an Assembly client, sends portal invite, saves `assembly_client_id`, and creates a Hub client with status `onboarding`.
- `sendContractToAssembly(leadId, contractTemplateId)` creates a contract from a selected template, sends a welcome chat message, and marks `contract_sent`.
- Contract templates are fetched server-side and passed to lead detail for selection.
- `full_name` splits into `givenName` and `familyName`; single-word names repeat for both fields.

Deep links:
- Individual chat: `https://dashboard.assembly.com/clients/users/details/{assembly_client_id}/messages`
- Company chat: `https://dashboard.assembly.com/companies/{assembly_company_id}/messages`
- Company chat is primary when a company exists; keep a separate Direct Chat link.

Pending Assembly work:
- Inline message reads, reusable message/contact components, Integrations settings tab, send-message dialog, bulk link, contract status polling, optional sent-message audit log.

## PriceLabs
PriceLabs is the dynamic pricing tool.

- API base: `https://api.pricelabs.co/v1`.
- Auth: `X-API-Key` from server-only `PRICELABS_API_KEY`.
- API client: `lib/pricelabs.ts`.
- Sync strategy: Vercel cron at `/api/cron/sync-pricelabs` daily 8:00 UTC plus manual Settings > Listings sync.
- Matching: PriceLabs listing `id` matches `listings.listing_id`.
- Storage: synced metrics live as `pl_*` columns on `listings`.
- Occupancy values may arrive as strings like `"100 %"` and must be parsed with `parseOccupancy()`.
- 30+ day occupancy fields use adjusted API prefixes, not plain `occupancy_*`.

Synced fields include base/min/max/recommended price, cleaning fees, bedrooms, 7/30/90-day occupancy and market occupancy, MPI 30/60, last booked date, weekend occupancy, push enabled, refreshed and synced timestamps.

Display:
- Listing detail shows real PriceLabs data with a green synced banner, or amber Preview when not synced.
- Listing cards on client detail pages use real Occ(7N), Occ(30N), MPI(30N), Last Booked.
- Reservations, pricing calendar, and pacing tabs still depend on PMS/reservations work.

## Stripe and Financials
- API client: `lib/stripe.ts`.
- Secret key: server-only `STRIPE_SECRET_KEY`.
- Financials page is server-side gated to `super_admin`.
- Client to Stripe customer links use the `client_stripe_customers` junction table as the source of truth; do not rely on `clients.stripe_customer_id`.
- Client detail pages let `super_admin` users create or reuse a Stripe customer from `client_stripe_customers`, choose a subscription type deduced from existing Stripe subscriptions, and generate a Checkout Session in `subscription` mode.
- Listings can link to subscriptions via `stripe_subscription_id`.
- Financial UI includes subscriptions, revenue trend, expenses, recurring expenses, and linking dialogs.
- Non-super_admin users may create/edit clients if permitted, but must not see or modify billing fields.

## Pacing Chart
Dashboard home has a forward-looking stacked bar chart of portfolio pacing.

- Component: `components/dashboard/pacing-chart.tsx`.
- Data layer: `lib/pacing.ts`.
- Mock data: `lib/pacing-mock.ts`.
- Current state: `023_reservations.sql` and `scripts/seed-reservations.ts` exist but are not yet applied to the dev Supabase project.
- Dashboard currently uses `getMockPacingSource`; after reservations are applied, add a `getPacingSource()` sibling returning the same `PacingSource` shape.

Bucket rules:

```text
last_3d:  booked_date in [today-3, today]
last_7d:  booked_date in [today-7, today-3)
last_14d: booked_date in [today-14, today-7)
older:    booked_date < today-14
```

Data conventions:
- Use UTC anchors everywhere for `today`, `stay_date`, bucket math, and tick labels.
- Window is 60 days forward inclusive of today.
- SQL filters: `booking_status = 'booked'`, `check_in < windowEnd`, `check_out > today`, `.limit(5000)`.
- Cancellation is handled per stay date in the loop; do not filter it only in SQL.
- Denominator is static count of all listings, not per-day active availability.
- `booked_pct` is `booked_total / total_listings * 100`, clamped to 100 and rounded to 1 decimal.

Chart conventions:
- Header controls: multi-select Listings, Clients, States plus range dropdown.
- Default range: 6 months; other presets are 3 months, 1 year, current year.
- Stack order bottom to top: `older`, `last_14d`, `last_7d`, `last_3d`.
- No bar animation; filter re-renders should not flicker.
- Empty states distinguish no matching listings from no reservations in range.

Pending pacing work:
- Single-listing rendering mode, column width tuning, monthly pacing dashboard, reservations table linked from bars.
- Out of scope for MVP: group selector, STLY comparison, real blocked-night denominator, historical pace curves, PMS sync.

## Landing Page to Pipeline Webhook
See `docs/webhook-pipeline-integration.md` for the detailed implementation reference.

Expected Hub endpoint:
- `POST /api/webhooks/new-lead`
- Auth via `x-webhook-secret` matched against server-only `WEBHOOK_SECRET`.
- Use admin client because the request is server-to-server and has no Supabase user session.
- Insert a `leads` row with stage `inquiry`, `sort_order` as max inquiry order + 1, `service_type: null`, `created_by: null`, and submitted contact/scheduling fields.
- Return 201 with `{ success: true, lead_id }`, 400 for validation, 401 for secret mismatch, 500 for unexpected insert errors.
- Do not use `revalidatePath`; Hub users see new leads after reload/navigation.

Landing page caller:
- Make the fetch server-side and never expose `WEBHOOK_SECRET` in the browser.
- Use a 5-second timeout.
- Log failures but do not block the user scheduling flow.
