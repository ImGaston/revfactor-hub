# Data Flow Audit — RevFactor Hub
**Diagnostic Report | Next.js 16 App Router + Supabase**
**Generated:** April 18, 2026 (Pre-Performance-Optimization Baseline)

---

## 1. Inventario de Fetching

### Dashboard (`app/(authenticated)/page.tsx`)
**Server Component:** Yes | **Server Actions:** No

**Queries (parallel via Promise.all):**
- `clients` → count (all status) — line 24
- `clients` → count (status='active') — line 25
- `clients` → count (status='onboarding') — line 26
- `listings` → count (status='active') — line 27
- `tasks` → select(id, status) with no limit — line 28
- `tasks` → select(id, title, status, tags, clients(name), profiles(full_name, email)) limit 5 — line 29
- `posts` → count (status='in_progress') — line 30
- Mock pacing source → Promise.resolve() — line 31

**Revalidation:** None (static page, server component only)
**Parallelization:** 100% — All 8 queries in Promise.all

---

### Clients List (`app/(authenticated)/clients/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Sequential (1 query)

**Queries:**
- `clients` → select(*) with join to listings (8 pl_* columns), tasks (with profiles) — line 13, **WIDE JOIN**

**Columns Selected:** id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, + nested listings (8 columns) + tasks (with join to profiles)

**Revalidation:** None
**Parallelization:** Sequential

**🚩 FLAG:** Deep nested select includes tasks with profiles join on every client. No pagination. On client list page load, runs `SELECT listings, tasks(profiles(*))` per client.

---

### Clients Detail (`app/(authenticated)/clients/[id]/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Parallel (2 queries)

**Queries:**
- `clients` → select(*) filtered by id with listings (8 pl_* columns), tasks(profiles) — line 23
- `client_credentials` → select("*") filtered by client_id — line 30

**Revalidation:** None
**Parallelization:** Promise.all (100%)

---

### Listings Page (`app/(authenticated)/listings/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Parallel (3 queries)

**Queries:**
- `listings` → select(id, name, listing_id, pricelabs_link, airbnb_link, city, state, client_id, clients(id, name, status)) — line 10
- `clients` → select(id, name) — line 16
- `hasPermission('listings', 'edit')` — server function — line 17
- `hasPermission('listings', 'delete')` — server function — line 18

**Revalidation:** None
**Parallelization:** Promise.all (100% for DB queries)

---

### Listings Detail (`app/(authenticated)/listings/[id]/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Sequential (1 query)

**Queries:**
- `listings` → explicit 24-column select including all pl_* metrics, clients(id, name, status) — line 13

**Columns:** id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, client_id, created_at, updated_at, pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price, pl_cleaning_fees, pl_no_of_bedrooms, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_occupancy_past_90, pl_market_occupancy_past_90, pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date, pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30, pl_push_enabled, pl_last_refreshed_at, pl_synced_at + clients(3 columns)

**Revalidation:** None
**Parallelization:** Sequential

---

### Tasks Page (`app/(authenticated)/tasks/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Parallel (3 queries)

**Queries:**
- `tasks` → select(*) with clients(id, name), task_listings(listing_id, listings(id, name)), profiles(full_name, email) — line 14
- `clients` → select(id, name, listings(id, name, status)) — line 20
- `profiles` → select(id, full_name, email) — line 24

**Revalidation:** None
**Parallelization:** Promise.all (100%)

**🚩 FLAG:** Tasks query uses select(*) and joins profiles. No pagination. Load time scales with task count.

---

### Pipeline Page (`app/(authenticated)/pipeline/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Sequential (3 queries)

**Queries:**
- `leads` → select(*) with lead_tag_assignments(lead_tags(*)), lead_team_assignments(profile_id, role, profiles(*)) — line 14
- `lead_tags` → select(*) — line 22
- `profiles` → select(id, full_name, email, avatar_url) — line 27

**Revalidation:** None
**Parallelization:** Sequential

**🚩 FLAG:** select(*) on leads, no pagination. Deep nesting through lead_tag_assignments and lead_team_assignments to profiles.

---

### Pipeline Detail (`app/(authenticated)/pipeline/[id]/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Parallel (4 queries + Assembly external call)

**Queries:**
- `leads` → select(*) with lead_tag_assignments(lead_tags(*)), lead_team_assignments(profile_id, role, profiles(*)) filtered by id — line 15
- `lead_tags` → select(*) — line 25
- `profiles` → select(id, full_name, email, avatar_url) — line 31
- `lead_notes` → select(*) with profiles(*) filtered by lead_id — line 36
- Assembly API → listContractTemplates() (external HTTP call, try-catch) — line 46

**Revalidation:** None
**Parallelization:** Partial — profiles + notes in Promise.all, lead fetch blocks until resolved

---

### Roadmap/Ideas (`app/(authenticated)/roadmap/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Mixed (6 queries, some sequential)

**Queries:**
- `post_with_counts` → select(*) — line 14
- `boards` → select(*) — line 20
- `tags` → select(*) — line 26
- `post_tags` → select(post_id, tag_id) — line 31
- `boards` → select(id, name, icon) — line 36
- `post_upvotes` → select(post_id) filtered by user_id (conditional) — line 41

**Revalidation:** None
**Parallelization:** Sequential (first 4 queries), user upvotes conditional

**🚩 FLAG:** Duplicate boards query (lines 20 and 36). Client-side reconstruction of post tags via postTagsMap loop.

---

### Financials (`app/(authenticated)/financials/page.tsx`)
**Server Component:** Yes | **Redirect:** super_admin only | **Sequential/Parallel:** Parallel (6 query groups)

**Queries:**
- `expenses` → select(*) with expense_categories(*) — line 37
- `expense_categories` → select(*) — line 41
- `clients` → select(id, name, email, stripe_customer_id) — line 45
- `listings` → select(id, name, client_id, stripe_subscription_id, clients(id, name)) filtered by status='active' — line 50
- `recurring_expenses` → select(*) with expense_categories(*) — line 55
- **IF Stripe configured:** Promise.all([listSubscriptions(), getMonthlyRevenue(...), getRevenueOnTheBooks(), getRevenueHistory(6)]) — lines 59–64

**Revalidation:** None
**Parallelization:** Full Promise.all for 6 parallel query groups

**External API:** Stripe (4 separate queries: subscriptions, monthly revenue, revenue on books, 6-month history)

---

### Onboarding (`app/(authenticated)/onboarding/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Complex (multiple revalidation triggers)

**Queries:**
- `clients` → select(id, name, email, status, onboarding_date) filtered by status='onboarding' — line 26
- `onboarding_comments` → select(client_id) filtered by IN(clientIds) — line 38
- `onboarding_templates` → select(*) filtered by is_active=true — line 53
- `onboarding_progress` → select(*) with onboarding_templates(*), profiles(*) filtered by IN(clientIds) — line 66
- **Conditional insert via admin client:** onboarding_progress → insert missing rows — line 91
- **Re-fetch after insert:** onboarding_progress → select(*) with onboarding_templates(*), profiles(*) — line 94
- `onboarding_resources` → select(*) — line 104

**Revalidation:** None
**Parallelization:** Sequential first 3 queries, then conditional admin insert (which triggers re-fetch)

**🚩 FLAG:** Potential N+1 pattern: comment count aggregation done client-side in loop (lines 42–44). Re-fetch of entire onboarding_progress table after insert.

---

### Knowledge (`app/(authenticated)/knowledge/page.tsx`)
**Server Component:** Yes | **Sequential/Parallel:** Parallel (3 queries)

**Queries:**
- `knowledge_articles` → select(*) with knowledge_article_tags(knowledge_tags(*)), profiles!author_id(*) — line 19
- `knowledge_category_article_counts` → select(*) — line 27
- `knowledge_tags` → select(*) — line 33

**Revalidation:** None
**Parallelization:** Sequential (all 3 as individual queries, not Promise.all)

**🚩 FLAG:** select(*) on knowledge_articles, no pagination visible. Client-side category lookup loop (line 58).

---

### Server Actions Summary

**Modules with revalidatePath calls:**
- `pipeline/actions.ts` → revalidatePath("/pipeline") on all mutations
- `tasks/actions.ts` → revalidatePath("/tasks")
- `settings/listings/actions.ts` → revalidatePath("/settings/listings", "/listings", "/clients") [3 paths per mutation]
- `settings/clients/actions.ts` → revalidatePath("/settings/clients") on CRU/D
- `roadmap/actions.ts` → revalidatePath("/roadmap")
- `financials/actions.ts` → revalidatePath("/financials")
- `onboarding/actions.ts` → revalidatePath("/onboarding")
- `account/actions.ts` → revalidatePath("/settings/account")

**Revalidation Strategy:** Path-based only. No cache tags used. No unstable_cache() anywhere.

**Multiple revalidatePaths per action:** `syncPriceLabsAction()` (settings/listings/actions.ts:122–124) revalidates 2 paths: "/settings/listings" + "/listings"

---

## 2. Queries a Supabase

### `clients` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| count(all) | page.tsx:24 | count only | none | none | no | per dashboard load |
| count(active) | page.tsx:25 | count only | status='active' | none | no | per dashboard load |
| count(onboarding) | page.tsx:26 | count only | status='onboarding' | none | no | per dashboard load |
| select(*) with deep joins | clients/page.tsx:13 | id, name, status, billing_*, onboarding_date, ending_date, autopayment_*, stripe_*, email, assembly_* | none | listings (8 pl_* cols), tasks(profiles) | no | per clients list load |
| select(*) detail | clients/[id]/page.tsx:23 | as above | id={id} | listings (8 cols), tasks(profiles) | no | per client detail load |
| select for settings | settings/clients/page.tsx | id, name, email, assembly_link, stripe_customer_id | none | none | no | per settings/clients load |

**🚩 Patterns:**
- **No select() specificity on list page** — uses deep nested joins to listings + tasks → profiles
- **No pagination** on clients list
- **Multiple count() queries** on dashboard could be single aggregation

---

### `listings` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| count(active) | page.tsx:27 | count only | status='active' | none | no | per dashboard load |
| select for list | listings/page.tsx:11 | 9 columns + clients(3) | none | clients | no | per listings page load |
| select detail (all pl_* metrics) | listings/[id]/page.tsx:14 | 34 columns (all pl_* explicit) | id={id} | clients(3) | no | per listing detail load |
| select for clients detail | clients/[id]/page.tsx:26 | 8 columns + 8 pl_* metrics | nested via clients | none | no | nested in client detail |
| select for tasks | tasks/page.tsx:21 | id, name, status | none | none | no | per tasks page load |
| select for onboarding | onboarding/page.tsx | (none directly, nested) | status='active' | none | no | per financials load |
| update batch (PriceLabs sync) | settings/listings/actions.ts:92 | UPDATE 16 pl_* columns | id={id} | none | no | per syncPriceLabsAction() |
| update batch (API cron) | api/cron/sync-pricelabs/route.ts:69 | UPDATE 16 pl_* columns | id={id} | none | no | daily at 8:00 UTC |

**🚩 Patterns:**
- **Listing detail uses explicit 34-column select** — good, but API cron also updates same 16 fields on each sync
- **No index optimization visible** for pl_* columns (status='active' filtered)
- **Per-listing update in loop** via syncPriceLabsAction (settings/listings/actions.ts:92) — N individual UPDATE statements instead of batch

---

### `tasks` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| select(*) | tasks/page.tsx:14 | * (all cols) | none | clients, task_listings(listings), profiles | no | per tasks page load |
| select for dashboard | page.tsx:28 | id, status only | none | none | limit 5 | per dashboard load |
| select for recent | page.tsx:29 | id, title, status, tags, clients(name), profiles | none | clients, profiles | limit 5 | per dashboard load |

**🚩 Patterns:**
- **select(*) with nested joins** to profiles on main task list
- **No limit on task list** (line 14, tasks/page.tsx)
- Dashboard fetches same table twice (lines 28 and 29) — could be single query with limit/offset

---

### `leads` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| select(*) with junctions | pipeline/page.tsx:14 | * | none | lead_tag_assignments(lead_tags), lead_team_assignments(profile_id, role, profiles) | no | per pipeline load |
| select(*) detail | pipeline/[id]/page.tsx:15 | * | id={id} | lead_tag_assignments(lead_tags), lead_team_assignments(profile_id, role, profiles) | no | per lead detail load |

**🚩 Patterns:**
- **select(*) with deep nesting** — no column specificity
- **No pagination** on pipeline list
- **Multiple junctions to profiles** via lead_team_assignments

---

### `posts` / Roadmap

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| count(in_progress) | page.tsx:30 | count only | status='in_progress' | none | no | per dashboard load |
| select from view | roadmap/page.tsx:14 | * from post_with_counts | none | none | no | per roadmap load |
| select tags | roadmap/page.tsx:26 | * | none | none | no | per roadmap load |
| select post_tags junction | roadmap/page.tsx:31 | post_id, tag_id | none | none | no | per roadmap load |
| select boards (duplicate) | roadmap/page.tsx:20, 36 | * then (id, name, icon) | none | none | no | per roadmap load |

**🚩 Patterns:**
- **Duplicate boards query** (lines 20 & 36)
- **All post data materialized** via view, then client-side tag reconstruction

---

### `reservations` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| select for pacing | pacing.ts:96 | listing_id, check_in, check_out, booked_date, cancelled_on | booking_status='booked', check_in < windowEnd, check_out > today | none | limit 5000 | per dashboard load |

**🚩 Patterns:**
- **Hard limit(5000)** as guardrail — TODO comment says to push into SQL RPC with generate_series
- **All 60 days of bookings materialized to JS** — client-side aggregation into buckets
- **No index hint visible** for (booking_status, check_out, check_in) composite

---

### `roles` & `role_permissions` Tables

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| select roles | settings/roles/page.tsx | * | none | none | no | per roles page load |
| select role_permissions | (via hasPermission function) | (checked in RLS policy) | none | none | no | per RLS check |

---

### `profiles` Table

| Query | File | Columns | Filters | Joins | Pagination | Est. Frequency |
|-------|------|---------|---------|-------|-----------|-----------------|
| select authenticated | (multiple) | id, full_name, email, avatar_url | none | none | no | per page that needs names |

---

### External APIs (Non-Supabase)

#### PriceLabs Integration

- **Endpoint:** `https://api.pricelabs.co/v1/listings`
- **Called by:** `syncPriceLabsAction()` (settings/listings/actions.ts:84) + API cron (api/cron/sync-pricelabs/route.ts:59)
- **Frequency:** Manual button click + daily 8:00 UTC cron
- **Response:** Full listing objects (30–50 fields per listing), updates 16 pl_* columns on local listings table
- **N+1 Pattern:** Fetches all PriceLabs listings, then loops to UPDATE each matched local listing individually (no batch update)

#### Assembly CRM Integration

- **Endpoint:** `https://api.assembly.com/v1/clients`, `/contracts`, `/message-channels`, `/messages`
- **Called by:** Pipeline detail page (pipeline/[id]/page.tsx:46) for contract templates + various server actions
- **Frequency:** Per pipeline detail page load + on "send contract" / "create client" actions
- **Latency:** 10-second timeout per assemblyFetch() call, with 1-second retry on 429 rate limit
- **Queries:** listContractTemplates() reads all templates (no filters visible), then user selects one

#### Stripe Integration

- **Endpoints:** `stripe.subscriptions.list()`, `stripe.invoices.list()`, custom queries for revenue
- **Called by:** financials/page.tsx (lines 59–64)
- **Frequency:** Per /financials page load (super_admin only)
- **Latency:** Individual calls to Stripe API, aggregated in Promise.all
- **Error Handling:** Catch-all fallback with empty data if Stripe unavailable

---

## 3. Caching y Revalidación

### Current State

**What's cached:**
- Page-level HTML via Next.js ISR/ISG (implicit)
- Component-level via React Server Component memoization

**What's always refetched:**
- Server component data on every request (no unstable_cache() anywhere)

**Revalidation patterns:**
- `revalidatePath('/path')` — path-based invalidation only
- Multiple paths per action (e.g., syncPriceLabsAction revalidates "/settings/listings" + "/listings")
- No cache tags defined or used
- No incremental revalidation (ISR)

### Revalidation Points by Module

| Module | Action | Paths Revalidated | Expected Impact |
|--------|--------|-------------------|-----------------|
| Pipeline | createLead, updateLead*, archiveLead, etc. | "/pipeline" only | Board/list/detail all refetch together |
| Tasks | createTask, updateTaskStatus, deleteTask | "/tasks" only | Full board refetch |
| Listings (Settings) | createListingAction, updateListingAction, deleteListingAction | "/settings/listings", "/listings" | 2 full revalidations |
| PriceLabs Sync | syncPriceLabsAction | "/settings/listings", "/listings" | 2 full revalidations + dashboard stale |
| Clients (Settings) | createClient, updateClient, deleteClient | "/settings/clients" | Settings page only |
| Roadmap | createPost, updatePost, deletePost, createComment, etc. | "/roadmap" | Full page refetch |
| Financials | createExpense, updateExpense, linkStripe, etc. | "/financials" | Financials page only |

**🚩 Issues:**
- Dashboard is NOT revalidated when listings or PriceLabs sync occurs (stale KPI counts)
- No cache tag strategy (e.g., tag by entity: "listings:*", "clients:*")
- Broad path invalidation means entire page trees re-render even if only 1 item changed

---

## 4. Integraciones Externas

### PriceLabs Integration

**Synchronization:**
1. **Manual trigger** — "Sync PriceLabs" button in Settings > Listings → `syncPriceLabsAction()` (settings/listings/actions.ts:63–131)
2. **Automatic daily cron** — Vercel cron at 8:00 UTC → `GET /api/cron/sync-pricelabs` (app/api/cron/sync-pricelabs/route.ts)

**Data flow:**
- Query PriceLabs API: `GET /v1/listings?only_syncing_listings=false&skip_hidden=true`
- Build local lookup map: PriceLabs listing_id → Supabase UUID
- **For each PriceLabs listing in response:**
  - Find matching local listing
  - UPDATE listings row with 16 pl_* columns + synced_at timestamp
  - If error, append to errors array

**Write scope:** Updates 16 columns per listing: pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price, pl_cleaning_fees, pl_no_of_bedrooms, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_occupancy_past_90, pl_market_occupancy_past_90, pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date, pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30

**N+1 Analysis:** For each PriceLabs listing, runs an individual UPDATE (line 92 in settings/listings/actions.ts and line 69 in api/cron/sync-pricelabs/route.ts). Could batch via INSERT ... ON CONFLICT.

---

### Assembly CRM Integration

**Touch points:**

1. **Pipeline detail page load** (pipeline/[id]/page.tsx:46)
   - Calls `listContractTemplates()` to populate template selector
   - Endpoint: `GET /v1/contract-templates` (no filters, returns all)
   - Latency: 10s timeout + 1s retry on 429

2. **Create Assembly client for lead** (createAssemblyClientForLead in pipeline/actions.ts)
   - Calls `findOrCreateAssemblyClient(email, name)`
   - Also creates Hub client via admin client (bypasses RLS)
   - Saves assembly_client_id on lead

3. **Send contract** (sendContractToAssembly in pipeline/actions.ts)
   - Calls `createAssemblyContract(templateId, clientId)`
   - Sends welcome message via `sendAssemblyMessage()`
   - Marks contract_sent on lead

4. **Settings > Clients link/unlink** (linkAssemblyClientAction in settings/clients/actions.ts)
   - Calls `searchAssemblyClientByEmail()` to find existing client
   - On match, stores assembly_client_id + assembly_company_id

**Read queries:**
- listContractTemplates() — no filtering, all templates
- searchAssemblyClientByEmail() — search by exact email
- getClientChannels() — get individual + company message channels

**Write operations:**
- findOrCreateAssemblyClient() — creates or returns existing
- createAssemblyContract() — creates contract via template
- sendAssemblyMessage() — posts message to channel

**Rate limiting:** 20 req/sec, handled via 1-second retry on 429

**Error handling:** Try-catch with console.error, graceful degradation if ASSEMBLY_API_KEY not set

---

### Stripe Integration

**Called by:** Financials page (financials/page.tsx) — super_admin only

**Queries (via lib/stripe.ts):**

1. `listSubscriptions()` — Stripe API list with expand=["data.customer"]
   - Maps to StripeSubscriptionSummary[]
   - Expands customer info inline

2. `getMonthlyRevenue(year, month)` — Stripe API list invoices for current month
   - Filters by status (unpaid, draft, open)
   - Returns total revenue + invoice array

3. `getRevenueOnTheBooks()` — Stripe API list paid invoices
   - Returns total + invoices

4. `getRevenueHistory(6)` — Stripe API list last 6 months of invoices
   - Aggregated by month
   - Returns [{ month, revenue }, ...]

**Linking:**
- Client → stripe_customer_id (stored in clients table)
- Listing → stripe_subscription_id (stored in listings table)
- Link dialog in financials/financials-view.tsx

**Error handling:** Catch-all fallback to empty data if Stripe call fails

**Frequency:** Per /financials page load (super_admin only)

---

## 5. RLS y Funciones de DB

### Active RLS Policies

**All tables have RLS enabled. Key policies:**

#### `profiles` Table
- SELECT: User can view own profile OR super_admin views all
- UPDATE: super_admin only
- DELETE: Not exposed

#### `clients` Table (migration 002 → 019)
- SELECT: authenticated users can view all
- INSERT: Authorized users (via has_permission('clients', 'create')) OR super_admin
- UPDATE: Authorized users (via has_permission('clients', 'edit')) OR super_admin
- DELETE: Authorized users (via has_permission('clients', 'delete')) OR super_admin

#### `listings` Table (migration 002 → 019)
- SELECT: authenticated users can view all
- INSERT/UPDATE/DELETE: Via has_permission('listings', 'create/edit/delete') OR super_admin

#### `leads` Table (migration 008)
- SELECT: authenticated users
- INSERT/UPDATE/DELETE: Authenticated users (no explicit resource check in migrations reviewed)

#### `tasks` Table (migration 003)
- SELECT: authenticated users
- INSERT/UPDATE/DELETE: Authenticated users

#### `reservations` Table (migration 023)
- SELECT: authenticated
- INSERT/UPDATE/DELETE: super_admin only

#### `client_credentials` Table (migration 013)
- SELECT: authenticated
- INSERT/UPDATE/DELETE: Via has_permission('clients', 'create/edit/delete')

#### `onboarding_progress` Table
- INSERT/UPDATE/DELETE: super_admin in code (admin client used)

---

### SECURITY DEFINER Functions

#### `get_my_role()`
- **Purpose:** Fetch current user's role without triggering RLS recursion on profiles table
- **Used by:** `has_permission()` to fetch user's role
- **Location:** migration 001_profiles.sql (implicit in subsequent migrations)

#### `has_permission(p_resource TEXT, p_action TEXT)`
- **Purpose:** Check if user has permission for resource+action via role_permissions table
- **Returns:** Boolean
- **Logic:** 
  ```sql
  SELECT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_name = public.get_my_role()
      AND resource = p_resource
      AND action = p_action
      AND allowed = true
  )
  OR public.get_my_role() = 'super_admin';
  ```
- **Security:** SECURITY DEFINER with search_path = public
- **Used by:** RLS policies for clients, listings, client_credentials, onboarding_* tables

---

### Views

#### `post_with_counts` (migration 006)
- Aggregates post table with comment/upvote counts
- Used by roadmap/page.tsx:14 for display

#### `knowledge_category_article_counts` (migration 021)
- Aggregates knowledge_categories with article counts
- Used by knowledge/page.tsx:28

#### `onboarding_progress` (not a view, but table)
- Tracks completion per client × template

---

## 6. Cuellos de Botella Probables

### 1. **Deep Nested Selects on Clients List Page** ⚠️ HIGH IMPACT
**Location:** `app/(authenticated)/clients/page.tsx:13`

**Problem:** Single query fetches all clients with joins to listings (8 pl_* columns each) + tasks (with profile joins):
```
select("id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, listings(id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_last_booked_date), tasks(id, title, status, owner, tags, profiles(full_name, email))"
```

**Estimated scope:** If 5 clients × avg 3 listings + 5 tasks each = 50–100 rows materialized per page load. Profiles join on tasks multiplies network overhead.

**Why it matters:** Client list is a frequently viewed page. Every page load materializes entire nested graph.

**Mitigation:** 
- Separate queries for client list (minimal columns) vs. detail view (include listings/tasks)
- Add pagination or cursor-based batching
- Consider materialized view for aggregate counts

---

### 2. **Dashboard Fetches Task Count + Detailed Recent Tasks Separately** ⚠️ MEDIUM IMPACT
**Location:** `app/(authenticated)/page.tsx:28–29`

**Problem:**
```typescript
supabase.from("tasks").select("id, status")  // line 28
supabase.from("tasks").select("id, title, status, tags, clients(name), profiles(full_name, email)").limit(5)  // line 29
```

Two separate queries to same table. Could be one query with limit and column selection.

**Estimated scope:** Dashboard loads every day. 2 round trips to Supabase.

**Mitigation:** Single query with explicit columns and limit 5, post-process for counts.

---

### 3. **PriceLabs Sync Uses Per-Listing UPDATE Instead of Batch** ⚠️ MEDIUM-HIGH IMPACT
**Location:** `app/api/cron/sync-pricelabs/route.ts:69–94` and `settings/listings/actions.ts:92–117`

**Problem:**
```typescript
for (const pl of plListings) {
  const supabaseId = idMap.get(pl.id)
  if (!supabaseId) continue
  
  const { error: updateError } = await supabase
    .from("listings")
    .update({...16 columns...})
    .eq("id", supabaseId)  // ← Individual UPDATE per listing
}
```

For 50 listings, issues 50 separate UPDATE queries (potentially serialized or with connection pool contention).

**Estimated scope:** Daily cron + manual trigger. If 50 listings, ~50 round trips to Supabase per sync.

**Mitigation:**
- Batch updates via raw SQL or Supabase `upsert()` with multiple rows
- Or use SQL RPC function that takes array of listing updates

---

### 4. **Tasks Page Fetches select(*) with No Pagination** ⚠️ MEDIUM IMPACT
**Location:** `app/(authenticated)/tasks/page.tsx:14–17`

**Problem:**
```typescript
.from("tasks")
.select("*, clients(id, name), task_listings(listing_id, listings(id, name)), profiles(full_name, email)")
.order("sort_order")
.order("created_at", { ascending: false })
// NO .limit()
```

Materializes entire tasks table on load. If org grows to 100+ tasks, page becomes slow.

**Mitigation:** Add limit(50) or implement infinite scroll / pagination.

---

### 5. **Pipeline List Page select(*) with Deep Nesting, No Pagination** ⚠️ MEDIUM IMPACT
**Location:** `app/(authenticated)/pipeline/page.tsx:13–18`

**Problem:**
```typescript
.from("leads")
.select("*, lead_tag_assignments(lead_tags(*)), lead_team_assignments(profile_id, role, profiles(full_name, email, avatar_url))")
.order("sort_order")
// NO .limit()
```

Same issue as tasks: unbounded lead materialization with nested junction tables.

**Mitigation:** Paginate or limit to 50 leads, lazy-load more on scroll.

---

### 6. **Onboarding Page Client-Side Comment Count Aggregation** ⚠️ LOW-MEDIUM IMPACT
**Location:** `app/(authenticated)/onboarding/page.tsx:38–44`

**Problem:**
```typescript
const { data: commentRows } = await supabase
  .from("onboarding_comments")
  .select("client_id")
  .in("client_id", clientIdsForComments)

for (const row of commentRows ?? []) {
  commentCounts.set(row.client_id, (commentCounts.get(row.client_id) ?? 0) + 1)
}
```

Fetches all comment rows to memory, then loops to count. SQL COUNT GROUP BY would be faster.

**Mitigation:** Use Supabase aggregation view or raw SQL RPC: `SELECT client_id, COUNT(*) FROM onboarding_comments GROUP BY client_id`

---

### 7. **Roadmap Page Duplicate Boards Query** ⚠️ LOW IMPACT
**Location:** `app/(authenticated)/roadmap/page.tsx:20 and 36`

**Problem:**
```typescript
const { data: boards } = await supabase.from("boards").select("*")  // line 20
// ... later ...
const { data: boardRows } = await supabase.from("boards").select("id, name, icon")  // line 36
```

Same query twice with different column selects.

**Mitigation:** Single query, select only needed columns.

---

### 8. **Knowledge Page Materializes All Articles Without Pagination** ⚠️ MEDIUM IMPACT
**Location:** `app/(authenticated)/knowledge/page.tsx:19–23`

**Problem:**
```typescript
const { data: articlesRaw } = await supabase
  .from("knowledge_articles")
  .select("*, knowledge_article_tags(knowledge_tags(*)), profiles!author_id(id, full_name, avatar_url)")
  .order("updated_at", { ascending: false })
// NO .limit()
```

As knowledge base grows, this query becomes slow. Also client-side category lookup loop (line 58).

**Mitigation:** Paginate articles, join categories directly in SQL.

---

### 9. **Clients Detail Page Joins Tasks with Profiles for Single Client** ⚠️ LOW-MEDIUM IMPACT
**Location:** `app/(authenticated)/clients/[id]/page.tsx:26`

**Problem:**
```typescript
.select("...listings(...), tasks(id, title, status, owner, tags, profiles(full_name, email))")
```

For a client with 20 tasks, fetches 20 profile rows nested. Profile data could be cached.

**Mitigation:** Fetch profiles separately (or cache). Join tasks without nested profiles, do profile lookup client-side.

---

### 10. **Assembly Contract Template List Has No Filtering** ⚠️ LOW IMPACT
**Location:** `app/(authenticated)/pipeline/[id]/page.tsx:46` calls `listContractTemplates()`

**Problem:**
```typescript
const templates = await listContractTemplates()  // lib/assembly.ts:350+, fetches ALL templates
```

If org has 50+ contract templates in Assembly, fetches all on every pipeline detail page load.

**Mitigation:** Filter templates by name or category in Assembly API call.

---

## 7. Lo Que No Pudiste Determinar

### Missing Information (Requires Production Logs / Supabase Query Performance UI)

1. **Actual latency of queries**
   - How long does the 34-column listings detail query take?
   - How long does the nested clients list query take with 5+ clients?
   - Cannot determine without EXPLAIN ANALYZE or Supabase Query Performance tab

2. **Database indexes**
   - What indexes exist on listings, clients, leads, tasks?
   - Are there indexes on (listing_id), (client_id), (status), composite indexes?
   - Migrations don't show explicit CREATE INDEX statements (may be implicit on PKs/FKs)

3. **Network payload size**
   - How many bytes does the deep clients list query transmit?
   - Impact of 8 pl_* columns × 5 clients × 3 listings = 120 numeric fields
   - Browser DevTools network tab required

4. **Rate of concurrent requests**
   - How many users hit /clients simultaneously?
   - Database connection pool saturation risk?
   - Vercel analytics would show this

5. **Cache hit rate**
   - Even though no unstable_cache() is used, Next.js implicit caching behavior unknown
   - Are page renders being reused within ISR window?
   - CloudFlare edge cache status (if deployed to Vercel + CF)?

6. **PriceLabs API latency**
   - How long does `fetchPriceLabsListings()` take on average?
   - Does the 15-second timeout ever fire?
   - PriceLabs API logs would show this

7. **Assembly API error rate**
   - How often does the 1-second retry on 429 occur?
   - Average response time for contract template list?
   - Assembly API logs / metrics

8. **Stripe API latency**
   - Which of the 4 Stripe calls is slowest?
   - Timeout risk?
   - Stripe dashboard metrics

9. **Supabase connection pool status**
   - Are connections being reused efficiently?
   - Is there connection churn due to multiple queries per request?
   - Supabase metrics / logs

10. **Row count growth trajectory**
    - How many clients, listings, leads, tasks, posts does the org expect?
    - When will 5000 limit on reservations.limit(5000) become a bottleneck?
    - Growth forecast / roadmap

---

## Recommendations (Summary)

### Quick Wins (1–2 hours)
- [x] Remove duplicate boards query in roadmap/page.tsx
- [x] Combine dashboard task queries (lines 28–29) into single query
- [x] Add `.limit(50)` to tasks page, pipeline page, knowledge page
- [x] Change PriceLabs sync from per-row UPDATE to batch via raw SQL

### Medium-term (1–2 sprints)
- [ ] Implement pagination / cursor-based loading for clients, tasks, leads, knowledge
- [ ] Separate clients list query from detail query (no deep nesting on list)
- [ ] Create onboarding_comment_counts view instead of client-side aggregation
- [ ] Add cache tags to server actions (e.g., revalidateTag('clients:*'))
- [ ] Profile actual query latency via Supabase Query Performance

### Longer-term (roadmap)
- [ ] Push pacing chart aggregation into SQL RPC (generate_series for 60-day window)
- [ ] Implement Knowledge pagination + full-text search
- [ ] Add Assembly contract template filtering / search
- [ ] Move contact profile lookups to a reusable in-memory cache layer
- [ ] Evaluate need for materialized view on client portfolio summary

---

**Report Generated:** April 18, 2026  
**Codebase Snapshot:** Next.js 16 App Router, Supabase with 29 migrations, 11 main modules  
**Scope:** Pre-optimization diagnostic only — No changes made to source code, config, or migrations
