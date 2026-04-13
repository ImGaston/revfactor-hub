# AGENTS.md — RevFactor Hub

## Project Overview
Internal operations hub for RevFactor, a short-term rental (STR) revenue management consultancy. Built for 2-3 internal users (Gaston, Federico). NOT client-facing in Phase 1.

**URL:** hub.revfactor.io

## Tech Stack
- **Frontend:** Next.js 16 (App Router) + shadcn/ui + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Deployment:** Vercel
- **Repo:** GitHub
- **Package manager:** pnpm

## Project Structure
```
app/
├── layout.tsx                  # Root layout (Sonner toaster, theme provider)
├── login/page.tsx              # Login (password + magic link)
├── auth/callback/route.ts      # Magic link callback handler
├── (authenticated)/
│   ├── layout.tsx              # Authenticated layout (sidebar + top bar)
│   ├── page.tsx                # Dashboard (home)
│   ├── dashboard-view.tsx      # Dashboard client component
│   ├── clients/
│   │   ├── page.tsx            # Client list (cards/table toggle with filters)
│   │   └── [id]/
│   │       ├── page.tsx        # Client detail (standalone page, fetches credentials)
│   │       └── credentials-actions.ts  # Server actions (createCredential, updateCredential, deleteCredential)
│   ├── listings/
│   │   ├── page.tsx            # Listings table — server component, fetches listings with client join
│   │   ├── listings-view.tsx   # Table with status dropdown, searchable client combobox, search input, row click → detail
│   │   └── [id]/
│   │       ├── page.tsx        # Listing detail — server component (fetches listing + client)
│   │       └── listing-detail.tsx  # Dashboard mockup with PriceLabs-style KPI row, tabs (Revenue, Reservations, Rates, Pacing)
│   ├── tasks/
│   │   ├── page.tsx            # Task board (kanban) — server component, fetches data
│   │   ├── tasks-board.tsx     # Client component with optimistic drag-and-drop
│   │   ├── task-dialog.tsx     # Create task form dialog (client+listing selectors)
│   │   └── actions.ts          # Server actions (createTask, updateTaskStatus, deleteTask)
│   ├── roadmap/
│   │   ├── page.tsx            # Ideas & Roadmap — server component
│   │   ├── roadmap-tabs.tsx    # Ideas/Roadmap tab switcher
│   │   ├── roadmap-kanban.tsx  # Kanban board for roadmap items
│   │   ├── ideas-view.tsx      # Ideas feed view
│   │   ├── ideas-card.tsx      # Idea card with votes, comments
│   │   ├── ideas-toolbar.tsx   # Ideas filter/sort toolbar
│   │   ├── post-form-dialog.tsx    # Create/edit idea dialog
│   │   ├── post-detail-dialog.tsx  # Idea detail with comments
│   │   ├── comment-form.tsx    # Comment form component
│   │   ├── comment-thread.tsx  # Threaded comments display
│   │   └── actions.ts          # Server actions (CRUD for ideas, roadmap items, comments, votes)
│   ├── pipeline/
│   │   ├── page.tsx              # Pipeline — server component, fetches leads + tags + profiles
│   │   ├── pipeline-tabs.tsx     # Board/Table/Completed tab switcher + Import/Export buttons
│   │   ├── pipeline-kanban.tsx   # 8-column kanban with optimistic drag-and-drop + collapsible archive/complete sections
│   │   ├── pipeline-table.tsx    # Table view with stage filters, inline stage change, search, sorting, bulk selection + action bar
│   │   ├── pipeline-completed.tsx # Completed leads table view with search, stage filters, reopen, bulk actions
│   │   ├── lead-form-dialog.tsx  # Create/edit lead dialog (all fields, tags, team)
│   │   ├── import-leads-dialog.tsx # CSV import dialog with preview + validation
│   │   ├── actions.ts            # Server actions (CRUD, bulk ops, import, archive/complete, Assembly integration)
│   │   └── [id]/
│   │       ├── page.tsx          # Lead detail — server component (fetches lead + Assembly contract templates)
│   │       └── lead-detail.tsx   # Lead detail — content + sidebar (stage, Assembly client, contract template selector, team, tags, dates)
│   ├── onboarding/
│   │   ├── page.tsx              # Onboarding — server component
│   │   ├── onboarding-view.tsx   # Onboarding view with client stepper cards
│   │   ├── client-stepper-card.tsx # Per-client onboarding progress card
│   │   ├── resource-card.tsx     # Resource/template card
│   │   └── actions.ts           # Server actions for onboarding steps
│   ├── financials/
│   │   ├── page.tsx              # Financials — super_admin only, fetches Stripe + expenses
│   │   ├── financials-view.tsx   # KPI cards, revenue trend chart, expense charts, tables
│   │   ├── subscriptions-table.tsx # Stripe subscriptions with client/listing linking
│   │   ├── link-stripe-dialog.tsx  # Link Stripe customer → Hub client
│   │   ├── link-subscription-dialog.tsx # Link subscription → listings
│   │   └── actions.ts            # Server actions (Stripe linking, expenses CRUD)
│   ├── settings/
│   │   ├── layout.tsx            # Settings layout — builds permission map, passes to nav
│   │   ├── settings-nav.tsx      # Settings navigation — permission-based tab visibility (not role-based)
│   │   ├── account/
│   │   │   ├── page.tsx            # Account settings (avatar, profile, password)
│   │   │   ├── actions.ts          # Server actions (updateProfile, updatePassword, updateAvatarUrl)
│   │   │   ├── avatar-upload.tsx   # Avatar upload with Supabase Storage
│   │   │   ├── profile-form.tsx    # Name edit form (email disabled)
│   │   │   └── password-form.tsx   # Current/new/confirm password form
│   │   ├── clients/
│   │   │   ├── page.tsx              # Client management (permission-gated)
│   │   │   ├── clients-settings.tsx  # Table with search, filters, Assembly link/unlink, edit/delete; billing column super_admin only
│   │   │   ├── client-dialog.tsx     # Create/edit client form; billing/autopay/stripe fields super_admin only
│   │   │   └── actions.ts           # Server actions (CRUD, Assembly link/unlink, updateClientEmailAction)
│   │   ├── listings/
│   │   │   ├── page.tsx              # Listings management (permission-gated)
│   │   │   ├── listings-settings.tsx # Table (table-fixed, overflow-x-auto) with search, filters, edit/delete per row
│   │   │   ├── listing-dialog.tsx    # Create/edit listing form — unified PriceLabs/Listing ID field (sets both listing_id + pricelabs_link)
│   │   │   └── actions.ts           # Server actions (createListingAction, updateListingAction, deleteListingAction, syncPriceLabsAction)
│   │   ├── users/
│   │   │   ├── page.tsx            # User management (permission-gated: users:edit)
│   │   │   ├── users-table.tsx     # Users table with inline role dropdown per user
│   │   │   ├── invite-user-dialog.tsx # Invite user with email+password+role (accepts roles prop)
│   │   │   └── actions.ts          # inviteUser via admin.auth.admin.createUser()
│   │   ├── roles/
│   │   │   ├── page.tsx            # Roles & Permissions management (permission-gated: users:edit)
│   │   │   ├── roles-manager.tsx   # Role cards with permission grid, create/delete role, user role reassignment
│   │   │   └── actions.ts          # Server actions (createRole, deleteRole, togglePermission, bulkToggleResource, updateUserRole)
│   │   ├── boards-tags/
│   │   │   ├── page.tsx            # Boards & Tags settings (permission-gated: settings:edit)
│   │   │   └── boards-tags-admin.tsx # Tag management UI
│   │   └── onboarding/
│   │       ├── page.tsx              # Onboarding settings (permission-gated: onboarding:edit)
│   │       └── onboarding-settings.tsx # Onboarding template management with drag-and-drop reordering
│   ├── calendar/page.tsx       # Calendar view
│   └── notes/page.tsx          # Notes feed
proxy.ts                        # Next.js 16 middleware (session refresh + auth redirects)
components/
├── ui/                         # shadcn/ui components (auto-managed)
├── layout/
│   ├── app-sidebar.tsx         # Sidebar nav + user avatar dropdown (Dashboard, Clients, Listings, Tasks, Onboarding, Calendar, Notes, Ideas & Roadmap, Pipeline)
│   ├── top-bar.tsx             # Dynamic breadcrumbs from pathname
│   └── breadcrumb-context.tsx  # Breadcrumb context provider
├── clients/
│   ├── clients-view.tsx        # Cards/Table toggle (default: table), search matches name+email, status filters
│   ├── clients-table.tsx       # Table view (table-fixed, overflow-x-auto) with sortable columns, inline email editing, billing column super_admin only
│   ├── client-card.tsx         # Card: name, status badge, listing count
│   ├── client-detail.tsx       # Side panel: contact info, Assembly links, open tasks, listings with real PriceLabs KPIs; billing super_admin only
│   ├── client-detail-page.tsx  # Standalone detail page: contact info, credentials, listings with real PriceLabs KPIs, sort controls, add listing button; billing super_admin only
│   ├── client-credentials.tsx  # Collapsible credentials table (hidden by default), password show/hide/copy, CRUD form dialog
│   └── add-listing-dialog.tsx  # Add listing from client detail (Name, City, State, Airbnb ID, PriceLabs/Listing ID)
├── kanban/
│   ├── kanban-board.tsx        # Generic typed board with @hello-pangea/dnd + renderColumnFooter
│   └── kanban-card.tsx         # Card with left accent border, badges, dropdown move menu, archive/complete actions
├── theme-provider.tsx          # next-themes provider
└── theme-toggle.tsx            # Dark/light mode toggle
lib/
├── supabase/
│   ├── client.ts               # Browser Supabase client (createBrowserClient)
│   ├── server.ts               # Server Supabase client (createServerClient + cookies)
│   ├── admin.ts                # Admin client with service role key
│   └── profile.ts              # Profile type (role: string) + getProfile() helper
├── assembly.ts                 # Assembly CRM API client (clients, channels, messages, contracts, deep links)
├── pricelabs.ts                # PriceLabs API client (fetchPriceLabsListings, parseOccupancy, isPriceLabsConfigured)
├── stripe.ts                   # Stripe API client (subscriptions, revenue, invoices)
├── permissions.ts              # Client-safe: RESOURCES, ACTIONS, types, buildPermissionMap(), checkPermission()
├── permissions.server.ts       # Server-only: hasPermission(), getRolePermissions(), getAllRolesWithPermissions()
├── types.ts                    # Shared types (Task, RoadmapItem, Client, Listing, ClientCredential, Lead, LeadTag, LeadStage, Expense, RecurringExpense, resolveProfile helper)
└── utils.ts
api/
└── cron/
    └── sync-pricelabs/route.ts # Vercel cron endpoint — daily PriceLabs sync at 8:00 UTC (auth via CRON_SECRET)
supabase/
└── migrations/
    ├── 001_profiles.sql        # profiles table, trigger, RLS + get_my_role() SECURITY DEFINER
    ├── 002_clients_and_listings.sql
    ├── 003_tasks_and_roadmap.sql
    ├── 004_tasks_owner_fk.sql  # ALTER tasks.owner to UUID FK → profiles
    ├── 005_profile_avatar.sql  # avatar_url column, avatars storage bucket + policies
    ├── 006_ideas_and_roadmap.sql
    ├── 007_assembly_integration.sql  # assembly_client_id, assembly_company_id on clients
    ├── 008_sales_funnel.sql          # leads, lead_tags, lead_tag_assignments, lead_team_assignments + RLS
    ├── 009_pipeline_archive_flags.sql # is_archived, is_completed, mutual exclusivity constraint, migrate data
    ├── 010_leads_assembly_client.sql  # assembly_client_id on leads
    ├── 011_onboarding.sql            # onboarding_steps table + RLS
    ├── 012_roles_and_permissions.sql  # roles, role_permissions tables, seeded super_admin + admin permissions, FK profiles.role → roles.name
    ├── 013_client_credentials.sql    # client_credentials table (name, software, email, password, notes) + RLS
    ├── 014_pricelabs_metrics.sql     # pl_* columns on listings (base_price, min_price, max_price, occupancy, market_occupancy, etc.)
    ├── 015_pricelabs_fields_update.sql # Add pl_mpi_next_30/60, pl_last_booked_date, pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30; drop unused fields
    ├── 016_financials.sql            # expenses, expense_categories, recurring_expenses tables; stripe_customer_id on clients
    └── 017_listing_stripe_subscription.sql # stripe_subscription_id on listings
scripts/
├── migrate-airtable.ts        # One-time Airtable → Supabase migration (clients + listings)
├── migrate-credentials.ts     # One-time CSV → Supabase migration (client credentials from Airtable)
└── check-missing-listings.ts  # Compare CSV listings against Supabase DB
```

## Authentication & Authorization
- **Auth methods:** Password (primary) + Magic link (secondary), both via Supabase Auth
- **Roles:** Dynamic roles stored in `roles` table (default: `super_admin`, `admin`). `profiles.role` is FK → `roles.name`
- **Permissions:** `role_permissions` table with resource+action pairs (11 resources × 4 actions = 44 permissions per role)
- **RLS:** All tables use Row Level Security. The `get_my_role()` SECURITY DEFINER function avoids recursion when policies on `profiles` need to check the user's role
- **Permission checking:** `lib/permissions.server.ts` for server-side, `lib/permissions.ts` for client-safe pure functions (no `next/headers` import)
- **Role-based UI:** Settings tabs are permission-gated (each tab maps to a resource+action). Financial data (billing_amount, autopayment, stripe_dashboard, Financials page) is **super_admin only** — enforced via `isSuperAdmin` prop in UI components and server-side redirect in `/financials`
- **Session refresh:** Handled in `proxy.ts` (Next.js 16 middleware replacement for `middleware.ts`)

## Database Tables (Supabase PostgreSQL)
- **profiles** — id (FK auth.users), email, full_name, avatar_url, role (FK → roles.name), created_at, updated_at
- **roles** — name (unique PK), description, is_system (boolean, prevents deletion of super_admin/admin)
- **role_permissions** — role_name (FK), resource, action (view/create/edit/delete), allowed (boolean), UNIQUE(role_name, resource, action)
- **clients** — name, email, phone, market, plan, assembly_link, assembly_client_id, assembly_company_id, status (active/onboarding/paused/churned), start_date, billing_amount, autopayment_set_up, stripe_dashboard, stripe_customer_id, onboarding_date, ending_date
- **listings** — client_id (FK), name, listing_id, pricelabs_link, airbnb_link, city, state, status, stripe_subscription_id, pl_* metrics (base_price, min_price, max_price, recommended_base_price, cleaning_fees, no_of_bedrooms, occupancy_next_7/30, market_occupancy_next_7/30, occupancy_past_90, market_occupancy_past_90, mpi_next_30/60, last_booked_date, wknd_occupancy_next_30, market_wknd_occupancy_next_30, push_enabled, last_refreshed_at, synced_at)
- **expenses** — description, amount, date, category_id (FK), is_paid, notes
- **expense_categories** — name, type (fixed/variable)
- **recurring_expenses** — description, amount, interval, category_id (FK), next_date
- **client_credentials** — id, client_id (FK), name, software, email, password, notes, created_at, updated_at. RLS: authenticated can view, super_admin can CRU/D
- **tasks** — client_id (FK), title, description, status (todo/in_progress/waiting/done), owner (UUID FK → profiles), tag, sort_order, task_listings (junction to listings)
- **roadmap_items** — title, description, owner, tag, status (proposed/planned/in_progress/done), sort_order
- **onboarding_steps** — client_id (FK), step_name, step_order, is_completed, completed_at, completed_by
- **notes** — client_id (FK, nullable), author, content, category (market_insight/client_update/internal/strategy)
- **calendar_events** — client_id (FK, nullable), title, event_date, event_type (pricing_review/contract_renewal/market_event/meeting)
- **leads** — project_name, full_name, email, phone, service_type, lead_source, scheduled_date, timezone, location, description, start_date, end_date, contract_sent, contract_signed, client_portal_url, stage (8 values: inquiry/follow_up/audit/meeting/proposal_sent/proposal_signed/retainer_paid/planning), sort_order, is_archived, is_completed, archived_at, completed_at, assembly_client_id, created_by (FK profiles)
- **lead_tags** — name (unique), color (separate namespace from roadmap tags)
- **lead_tag_assignments** — lead_id (FK), tag_id (FK) junction
- **lead_team_assignments** — lead_id (FK), profile_id (FK profiles), role

## Supabase Storage
- **avatars** bucket (public) — user profile photos, organized by `{user_id}/` folders with per-user RLS policies

## Key Views
- **client_portfolio_summary** — aggregates listing metrics per client
- **onboarding_progress** — calculates completion % per onboarding client

## Coding Conventions
- Use TypeScript strict mode
- Use shadcn/ui components — install via `npx shadcn@latest add [component]`
- Use `@/` alias for imports from project root
- Supabase queries: use server client in Server Components, browser client in Client Components
- Admin operations (creating users, bypassing RLS): use admin client from `lib/supabase/admin.ts`
- All database operations go through Supabase client — no raw SQL in frontend code
- Error handling: always handle Supabase query errors with proper user feedback via Sonner toast
- Use React 19 `useOptimistic` for instant UI feedback on mutations (e.g., kanban drag-and-drop)
- Server Actions (`"use server"`) for all data mutations
- **Server/client split:** Keep `next/headers` imports strictly in server-only files (`.server.ts`). Client components must only import from client-safe modules

## UI Conventions
- shadcn/ui default theme for Phase 1 (brand theming comes later)
- Sidebar navigation with icons (use lucide-react)
- Clients page: cards/table toggle (default: table view), search matches name+email, status filters, Sheet overlay for detail panel
- Listings page: table with status dropdown, searchable client combobox (Popover+Command), row click → detail page
- Financial numbers: right-aligned, monospace font (font-mono), super_admin only
- Status indicators: use shadcn Badge component
- Forms: use shadcn Form + react-hook-form + zod validation
- Loading states: use shadcn Skeleton
- Destructive actions: always confirm via AlertDialog
- Inline editing: `+Add` button → input with save/cancel (used for client email in table)
- Collapsible sections: `useState(false)` default hidden, ChevronDown/ChevronRight toggle (used for credentials)
- Password fields: show/hide toggle + clipboard copy button

### Kanban Board Style
- Columns have **subtle tinted backgrounds** matching their semantic color (e.g., yellow for "In Progress", green for "Done")
- Cards have a **left colored accent border** (`border-l-[3px]`) matching the column color
- Column headers show label + count badge (badge uses column color when count > 0)
- Empty columns display centered "No items" placeholder text
- Card metadata (owner, date) shown as icon+label pairs below the card content
- Priority/tag badges support custom colors (e.g., orange for "high", red for "urgent")
- Drag-and-drop via `@hello-pangea/dnd` with optimistic UI updates
- Click-to-move between columns via dropdown menu on each card
- Optional `renderColumnFooter` for per-column collapsible sections (used by pipeline for archived/completed)
- Cards support `onArchive`, `onComplete` actions and `statusIndicator` ReactNode

### Listing Detail Dashboard
- PriceLabs-style KPI row with 10 metrics: Base Price, Min Price, Occ(7N), Mkt Occ(7N), Occ(30N), Mkt Occ(30N), Wknd Occ(30N), Mkt Wknd(30N), MPI(30N), Last Booked
- `KPIMetric` component with color-coded badges (green/amber/red/blue based on thresholds)
- `occColor(occ, marketOcc)` function: Red (<0.8×market), Amber (0.8×–1×market), Green (1×–1.2×market), Blue (>1.2×market)
- Secondary KPI cards: Base Price, Recommended Price, MPI(60N), Occ 90N
- Market Comparison sidebar with weekend occupancy and MPI 30N/60N
- 4 tabs: Revenue (monthly chart mockup), Reservations (table), Rates (PriceLabs calendar), Pacing (vs prior year)
- Shows real PriceLabs data when synced (green "synced" banner), amber "Preview" banner when not synced

### Listing Cards (Client Detail Pages)
- Rounded-xl cards with MapPin + Airbnb/PriceLabs logo links in header
- 4-column KPI grid: Occ(7N), Occ(30N), MPI(30N), Last Booked — all from real PriceLabs data
- Color-coded via `occColor()` (same 4-tier system as listing detail)
- Sort controls: dropdown (Name, Occ 7N, Occ 30N, MPI 30N, Last Booked) + asc/desc toggle
- "+" button to add listing via `AddListingDialog`
- Responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- Click navigates to `/listings/[id]` detail page

### Listing Form (Settings > Listings)
- Airbnb field accepts **only the numeric ID**, not full URLs; auto-constructs `https://www.airbnb.com/rooms/{id}`
- **PriceLabs / Listing ID** is a single unified field that sets both `listing_id` and `pricelabs_link` (`https://app.pricelabs.co/pricing_dashboard?listings={id}`)
- If a user pastes a full URL, the ID is extracted automatically
- A preview of the generated link is shown below each field
- When editing an existing listing, the ID is extracted from the stored link

## Assembly CRM Integration

Assembly is the client communication platform (CRM + messaging + contracts). The Hub integrates with Assembly's API to manage clients, send contracts, and provide deep links to conversations.

### Architecture
- **API:** `https://api.assembly.com/v1`, auth via `X-API-KEY` header, rate limit 20 req/sec
- **API client:** `lib/assembly.ts` — server-side only, wraps all Assembly API calls
- **Auth:** Single workspace API key stored as `ASSEMBLY_API_KEY` env var (server-side only)
- **Sync strategy:** On-demand only. No webhooks, no cron, no background sync
- **Caching:** None. Data fetched live from Assembly API per request (fine for 2-3 users)
- **Graceful degradation:** If `ASSEMBLY_API_KEY` is not set, all Assembly UI elements are hidden
- **Error handling:** `assemblyFetch` reads response body on errors for detailed messages, logs to console

### Client Linking
- Clients are linked to Assembly by email match (`searchAssemblyClientByEmail`)
- On link, we store `assembly_client_id` (always) and `assembly_company_id` (if client belongs to a company)
- The `assembly_link` URL is auto-generated based on whether the client has a company or not
- Server actions: `linkAssemblyClientAction`, `unlinkAssemblyClientAction` in `settings/clients/actions.ts`

### Pipeline → Assembly Integration
- **Create Client:** `createAssemblyClientForLead(leadId)` — finds or creates Assembly client by email, sends portal invite, saves `assembly_client_id` on lead, also creates Hub client in `clients` table (status: onboarding) via admin client
- **Send Contract:** `sendContractToAssembly(leadId, contractTemplateId)` — creates contract from selected template via `POST /v1/contracts`, sends welcome message via chat, marks `contract_sent` on lead
- **Contract Template Selection:** Templates fetched from `GET /v1/contract-templates` in server component, passed as props to lead detail. User picks template from Select dropdown before sending
- **Name Splitting:** `full_name` is split into `givenName` (first word) and `familyName` (rest). Single-word names repeat for both fields

### Deep Link URL Patterns
- **Individual client chat:** `https://dashboard.assembly.com/clients/users/details/{assembly_client_id}/messages`
- **Company chat:** `https://dashboard.assembly.com/companies/{assembly_company_id}/messages`
- If client has a company → `assembly_link` points to company chat (primary), with separate "Direct Chat" button
- If client has no company → `assembly_link` points to individual chat

### Assembly API Concepts
- **Client** = a contact in Assembly (has email, `companyIds[]`)
- **Company** = a group of clients; has its own message channel where all members participate
- **Message Channel** = conversation thread (`membershipType`: individual, group, or company)
- **Contract Template** = a reusable contract document configured in Assembly dashboard
- **Contract** = an instance of a template sent to a client for signature (status: `pending` | `signed`)
- A client can have both an individual chat AND belong to a company chat

### Key Functions in `lib/assembly.ts`
- `isAssemblyConfigured()` — checks if env var exists
- `searchAssemblyClientByEmail(email)` — finds Assembly client by email (null-safe)
- `getAssemblyClient(id)` — get client details
- `createAssemblyClient(opts)` — create client with `sendInvite` option
- `findOrCreateAssemblyClient(opts)` — search by email first, create if not found
- `getIndividualChannel(clientId)` — get 1:1 message channel
- `getCompanyChannels(clientId)` — get company message channels
- `getClientChannels(clientId)` — get both individual + company channels
- `getOrCreateMessageChannel(clientId)` — get or create individual message channel
- `sendAssemblyMessage(channelId, text)` — send message to channel
- `assemblyClientMessagesUrl(clientId)` — deep link to individual chat
- `assemblyCompanyMessagesUrl(companyId)` — deep link to company chat
- `listContractTemplates(name?)` — list contract templates, optionally filter by name
- `getContractTemplate(id)` — get specific template
- `createAssemblyContract(opts)` — create contract from template for client
- `getAssemblyContract(id)` — get contract details
- `listClientContracts(clientId)` — list contracts for a client
- File channel helpers: `getOrCreateFileChannel`, `createAssemblyFileEntry`, `createAssemblyLink`

### Integration Status

#### Phase 1 — MVP (DONE)
- [x] Migration `007_assembly_integration.sql` — `assembly_client_id`, `assembly_company_id` columns on clients
- [x] Migration `010_leads_assembly_client.sql` — `assembly_client_id` column on leads
- [x] `lib/assembly.ts` — API client with clients, channels, messages, contracts, file channels, deep links
- [x] Server actions `linkAssemblyClientAction` / `unlinkAssemblyClientAction`
- [x] Client detail panel — Assembly linked/unlinked status, "Company Chat" + "Direct Chat" buttons, "Link to Assembly" button
- [x] Settings > Clients table — Assembly status column with link/unlink toggle per row
- [x] Clients page query includes `assembly_client_id`, `assembly_company_id`
- [x] Graceful degradation when `ASSEMBLY_API_KEY` is not set
- [x] Deep links: company chat (primary when company exists) + individual chat
- [x] Pipeline: "Create Client in Assembly" button (creates Assembly client + Hub client)
- [x] Pipeline: "Send Contract" with template selector (creates contract via Assembly Contracts API + sends welcome message)

#### Phase 2 — Read messages inline (PENDING)
- [ ] Extend `lib/assembly.ts` with `getChannelMessages(channelId, limit)`
- [ ] Build `app/(authenticated)/clients/[id]/page.tsx` — full client detail page with tabs (Overview, Messages, Tasks, Files)
- [ ] Create `app/(authenticated)/clients/[id]/actions.ts` — `getAssemblyChannelsAction` (fetches both individual + company channels with messages)
- [ ] Create `components/clients/assembly-messages.tsx` — message list with sender, timestamp, markdown preview (reusable for individual + company)
- [ ] Create `components/clients/assembly-contact.tsx` — phone, tags, address from Assembly custom fields
- [ ] Create `app/(authenticated)/settings/integrations/page.tsx` — integration status, workspace info, Assembly dashboard link
- [ ] Add "Integrations" tab to `settings-nav.tsx`
- [ ] Add Assembly linked indicator icon on `client-card.tsx`

#### Phase 3 — Send messages + bulk ops (PENDING)
- [ ] Create `components/clients/send-message-dialog.tsx` — markdown compose + preview dialog
- [ ] Add `sendAssemblyMessageAction(clientId, channelId, content)` — send to individual or company channel
- [ ] Add `bulkLinkAssemblyAction()` — iterate all clients with email, auto-link matches
- [ ] Contract status tracking: poll `GET /v1/contracts?clientId=X` to detect `signed` status and auto-update `contract_signed` on lead
- [ ] Optional: migration for assembly_message_log — audit log of messages sent from Hub

## Sales Pipeline

The Pipeline section (`/pipeline`) replaces HoneyBook for internal sales funnel management. Entry point: schedule call from landing page. Funnel closes when contract is sent + client portal access granted.

### Architecture
- **Route:** `/pipeline` (list) and `/pipeline/[id]` (detail)
- **Views:** Board (kanban), Table, and Completed — switchable via tabs
- **Detail page:** Full page with content area + 270px right sidebar
- **Reuses:** Generic `KanbanBoard<Lead>` and `KanbanCard` from `components/kanban/`
- **Data flow:** Server component fetches leads with joined tags + team assignments → passes to client components

### 8 Pipeline Stages
1. **Inquiry** (indigo) — auto-created from schedule call
2. **Follow-up** (blue) — first contact made, awaiting response
3. **Audit** (cyan) — evaluating prospect's business/property
4. **Meeting** (teal) — discovery/sales call scheduled or completed
5. **Proposal Sent** (amber) — formal proposal delivered
6. **Proposal Signed** (orange) — prospect accepted and signed
7. **Retainer Paid** (green) — initial payment confirmed
8. **Planning** (violet) — onboarding + contract + client portal = **funnel close**

### Archive & Complete System
- **Completed** and **Archived** are NOT stages — they are boolean flags (`is_archived`, `is_completed`) on the leads table
- A lead preserves its stage when archived/completed (e.g., archived at "Audit" stage = funnel dropout analysis)
- **Mutual exclusivity:** DB constraint `CHECK (NOT (is_archived AND is_completed))` — a lead cannot be both
- Timestamps: `archived_at`, `completed_at` track when the action happened
- **Kanban:** Each column has collapsible "Completed" and "Archived" sections at the bottom, showing dimmed cards with Reopen/Unarchive buttons
- **Table:** Toggle buttons for showing/hiding archived and completed leads, with count badges. Rows dimmed with status badges
- **Detail page:** Status banner (green for completed, gray for archived) with Reactivate/Reopen button. Archive/Complete buttons in sidebar
- **Bulk actions:** Archive and Complete available in floating action bar on table views

### Lead Card Properties
- `project_name` (required), `full_name`, `email`, `phone`
- `service_type` (A – Ideal Fit / B – Needs Evaluation / C – Not a Fit)
- `lead_source` (landing_page / referral / web_form / social_media / cold_outreach / other)
- `scheduled_date`, `timezone`, `location`, `description`
- `start_date`, `end_date`, `contract_sent`, `contract_signed`, `client_portal_url`
- `is_archived`, `is_completed`, `archived_at`, `completed_at`
- `assembly_client_id` — linked Assembly client (set when "Create Client in Assembly" is clicked)
- Tags (via `lead_tag_assignments` junction), team members (via `lead_team_assignments` → profiles)

### Key Features
- **Kanban board:** 8-column drag-and-drop with optimistic UI, click-to-move dropdown, "+" per column, per-column collapsible archived/completed sections
- **Table view:** Stage filter tabs with counters, search, sortable columns, inline stage change via Popover on stage badge, row click → detail, show/hide archived/completed toggles
- **Completed view:** Dedicated tab showing only completed leads with stage filters, search, Reopen button per row, bulk archive/delete
- **Bulk selection:** Checkboxes + select-all on table. Floating action bar with: change stage, change service type, change lead source, assign team member, complete, archive, delete (with confirmation)
- **Import/Export:** CSV export (all lead fields + is_archived + is_completed + tags + team), CSV import with preview table + validation
- **Detail page:** Two-column layout (content + sidebar). Sidebar: stage dropdown, archive/complete buttons, Assembly client creation + contract template selector + send, contract checkboxes, client portal URL, team avatars, tags, key dates, delete. Content: description, contact info grid, details grid. Banners for archived/completed status
- **Edit:** LeadFormDialog supports both create and edit modes

### Assembly Contract Flow (Detail Page Sidebar)
1. **Create Client in Assembly** — Button shown when `assembly_client_id` is null. Requires lead email + name. Creates/finds client in Assembly with `sendInvite: true`, saves `assembly_client_id` on lead, also inserts a Hub client (status: onboarding) in `clients` table via admin client
2. **Send Contract** — Shown after client is created. Select dropdown lists all contract templates from Assembly (`GET /v1/contract-templates`). Creates contract via `POST /v1/contracts` with selected template + client ID. Sends welcome message via message channel. Marks `contract_sent` on lead

### Server Actions (`pipeline/actions.ts`)
- `createLead(formData)` — insert lead + tag/team assignments
- `updateLead(leadId, data)` — partial update any field
- `updateLeadStage(leadId, newStage, newSortOrder)` — kanban drag-drop + inline table change
- `updateLeadTags(leadId, tagIds[])` — sync junction table
- `updateLeadTeam(leadId, profileIds[])` — sync junction table
- `deleteLead(leadId)` — cascade delete
- `bulkDeleteLeads(leadIds[])` — delete multiple
- `bulkUpdateLeads(leadIds[], data)` — update stage/service_type/lead_source in batch
- `bulkAssignTeam(leadIds[], profileIds[])` — assign team to multiple leads
- `importLeads(rows[])` — bulk insert from CSV, invalid stages default to "inquiry"
- `archiveLead(leadId)` / `unarchiveLead(leadId)` — toggle archive flag
- `completeLead(leadId)` / `uncompleteLead(leadId)` — toggle complete flag
- `bulkArchiveLeads(leadIds[])` / `bulkCompleteLeads(leadIds[])` — bulk flag operations
- `createAssemblyClientForLead(leadId)` — create Assembly client + Hub client
- `sendContractToAssembly(leadId, contractTemplateId)` — send contract via Assembly Contracts API

### Implementation Status

#### Phase 1 — Core Pipeline (DONE)
- [x] Migration `008_sales_funnel.sql` — leads, lead_tags, lead_tag_assignments, lead_team_assignments + RLS + indexes + seed tags
- [x] Migration `009_pipeline_archive_flags.sql` — is_archived, is_completed flags, mutual exclusivity constraint, stage reduced to 8 values
- [x] Migration `010_leads_assembly_client.sql` — assembly_client_id on leads
- [x] Types: `Lead`, `LeadTag`, `LeadStage` in `lib/types.ts`
- [x] Sidebar nav: "Pipeline" with Funnel icon
- [x] Kanban board view (8 columns, drag-drop, optimistic UI, collapsible archive/complete per column)
- [x] Table view (stage filters, inline stage change, search, sorting, show/hide archived/completed)
- [x] Completed view (dedicated tab with table, reopen, bulk actions)
- [x] Lead form dialog (create + edit modes, all fields)
- [x] Detail page (`/pipeline/[id]`) with content + sidebar + archive/complete banners
- [x] CSV export (all fields + is_archived + is_completed + tags + team)
- [x] CSV import with preview + validation
- [x] Bulk selection + action bar (stage, service type, source, assign, complete, archive, delete)
- [x] Assembly: Create client from lead (+ auto-create Hub client)
- [x] Assembly: Send contract with template selector via Contracts API

#### Phase 2 — Detail Page Tabs (PENDING)
- [ ] **Activity tab:** `lead_activity` table (lead_id, actor FK profiles, action, metadata JSONB, created_at). Auto-log stage changes, field edits, team changes from server actions. Timeline UI component
- [ ] **Notes tab:** `lead_notes` table (lead_id, author FK profiles, content, timestamps). Markdown notes feed with `comment-form.tsx` pattern
- [ ] **Tasks tab:** `lead_tasks` table (lead_id, title, completed, assigned_to FK profiles, due_date). Checklist UI with inline add
- [ ] **Files tab:** `lead_files` table (lead_id, file_name, file_url, file_size, uploaded_by FK profiles). Supabase Storage bucket `lead-files` organized by `{lead_id}/`. Upload dropzone + file list
- [ ] **Financials tab:** `lead_financials` table (lead_id, type check in payment/expense, amount DECIMAL, description, date). Super_admin only (same gating as billing_amount in clients)

#### Phase 3 — Integrations & Automation (PENDING)
- [ ] Webhook/API endpoint to receive schedule call data from landing page → auto-create lead with stage = 'inquiry'
- [ ] Contract status polling: detect `signed` in Assembly → auto-update `contract_signed` on lead
- [ ] Client portal URL auto-generation on funnel close
- [ ] Supabase Realtime subscriptions for live pipeline updates between team members
- [ ] Email notifications on stage changes (optional)

## PriceLabs Integration

PriceLabs is the dynamic pricing tool. The Hub syncs listing metrics from PriceLabs API daily.

### Architecture
- **API:** `https://api.pricelabs.co/v1`, auth via `X-API-Key` header
- **API client:** `lib/pricelabs.ts` — server-side only
- **Auth:** Single API key stored as `PRICELABS_API_KEY` env var (server-side only)
- **Sync strategy:** Daily cron via Vercel (`/api/cron/sync-pricelabs`) at 8:00 UTC + manual "Sync PriceLabs" button in Settings > Listings
- **Matching:** PriceLabs listing `id` matches `listing_id` column in `listings` table
- **Storage:** Metrics stored as `pl_*` columns on the `listings` table (migration `014_pricelabs_metrics.sql`)

### Synced Fields (from `GET /v1/listings`)
- `pl_base_price`, `pl_min_price`, `pl_max_price`, `pl_recommended_base_price`
- `pl_cleaning_fees`, `pl_no_of_bedrooms`
- `pl_occupancy_next_7`, `pl_market_occupancy_next_7` (from API `occupancy_next_7`, `market_occupancy_next_7`)
- `pl_occupancy_next_30`, `pl_market_occupancy_next_30` (from API `adjusted_occupancy_next_30`, `market_adjusted_occupancy_next_30`)
- `pl_occupancy_past_90`, `pl_market_occupancy_past_90` (from API `adjusted_occupancy_past_90`, `market_adjusted_occupancy_past_90`)
- `pl_mpi_next_30`, `pl_mpi_next_60` (from API `mpi_next_30`, `mpi_next_60`)
- `pl_last_booked_date` (from API `last_booked_date`)
- `pl_wknd_occupancy_next_30`, `pl_market_wknd_occupancy_next_30` (from API `weekend_adjusted_occupancy_next_30`, `market_weekend_adjusted_occupancy_next_30`)
- `pl_push_enabled`, `pl_last_refreshed_at`, `pl_synced_at`
- **Note:** PriceLabs returns occupancy as strings like `"100 %"` — parsed via `parseOccupancy()`
- **Note:** 30+ day occupancy fields use `adjusted_occupancy_*` prefix in API (not `occupancy_*`)

### Key Functions in `lib/pricelabs.ts`
- `isPriceLabsConfigured()` — checks if env var exists
- `fetchPriceLabsListings(onlySyncing?)` — fetches all listings from PriceLabs API
- `parseOccupancy(val)` — handles PriceLabs `"100 %"` string format → number

### Display
- **Listing detail page** (`/listings/[id]`) shows real PriceLabs data when synced (green banner), amber "Preview" when not
- **KPI row:** Base Price, Min Price, Occ(7N), Mkt Occ(7N), Occ(30N), Mkt Occ(30N), Wknd Occ(30N), Mkt Wknd(30N), MPI(30N), Last Booked
- **KPI cards:** Base Price, Recommended Price, MPI(60N), Occ 90N
- **Tabs:** Reservations, Pricing calendar, and Pacing still show mockup data (require PMS integration)
- **Listing cards** (client detail pages): Occ(7N), Occ(30N), MPI(30N), Last Booked — all real PriceLabs data

## Roles & Permissions System

### Architecture
- **Tables:** `roles` (name, description, is_system) + `role_permissions` (role_name, resource, action, allowed)
- **11 Resources:** dashboard, clients, listings, tasks, roadmap, pipeline, onboarding, calendar, notes, settings, users
- **4 Actions:** view, create, edit, delete
- **System roles:** `super_admin` (all permissions, cannot be deleted) and `admin` (default permissions)
- **Custom roles:** Can be created via Settings > Roles & Permissions
- **Permission check:** Server-side via `hasPermission(resource, action)`, client-side via `checkPermission(permissionMap, resource, action)`

### Settings Tab Permissions
- All roles can access `/settings` (Account tab is always visible)
- Each settings sub-tab maps to a permission key:
  - **Users** → `users:edit`
  - **Roles** → `users:edit`
  - **Clients** → `clients:edit`
  - **Listings** → `listings:edit`
  - **Boards & Tags** → `settings:edit`
  - **Onboarding** → `onboarding:edit`
- `settings-nav.tsx` receives a `permissions` map and filters tabs accordingly
- `settings/layout.tsx` builds permission map from `getRolePermissions()` + `buildPermissionMap()` (super_admin gets all hardcoded)

### Financial Data Visibility (super_admin only)
- **billing_amount, autopayment_set_up, stripe_dashboard** fields on clients: hidden in UI for non-super_admin
- **Clients table** (`clients-table.tsx`): Billing column conditionally rendered via `isSuperAdmin` prop
- **Client detail** (`client-detail.tsx`, `client-detail-page.tsx`): Billing InfoRow + Stripe button gated by `isSuperAdmin`
- **Settings > Clients table** (`clients-settings.tsx`): Billing column gated by `isSuperAdmin`
- **Client dialog** (`client-dialog.tsx`): Billing amount, Autopayment toggle, Stripe Dashboard fields gated by `isSuperAdmin`
- **Financials page** (`/financials`): Server-side redirect if not super_admin
- **Sidebar**: Financials link has `superAdminOnly: true`
- Non-super_admin users can still create/edit clients (if they have `clients:edit` permission) but cannot see or modify financial fields

### UI
- Settings > Roles & Permissions page (permission-gated: users:edit)
- Role cards with expandable permission grid (checkboxes per resource×action)
- Create/delete custom roles
- Inline user role reassignment via dropdown
- Bulk toggle all permissions for a resource

## Client Credentials System

### Architecture
- **Table:** `client_credentials` — stores software access credentials per client (name, software, email, password, notes)
- **RLS:** Authenticated users can view, super_admin can create/update/delete
- **Migration:** `013_client_credentials.sql`

### UI (`components/clients/client-credentials.tsx`)
- Collapsible section on client detail pages, **hidden by default**
- Header: "Credentials (count)" with ChevronRight/ChevronDown toggle
- Compact table view: Software (badge), Email, Password (show/hide/copy via `PasswordCell`), Notes, Actions (edit/delete)
- `CredentialFormDialog` for create/edit with fields: Name, Software, Email, Password, Notes
- Empty state when no credentials exist

## STR Domain Terms
- **ADR** = Average Daily Rate (revenue ÷ nights sold)
- **RevPAR** = Revenue Per Available Room (revenue ÷ total available nights)
- **Occupancy** = % of available nights that are booked
- **Pacing** = how bookings are tracking vs. same period prior year
- **PMS** = Property Management System (Hostaway, Hospitable, etc.)
- **PriceLabs** = dynamic pricing tool; each listing has a unique pricelabs_id
- **MPI** = Market Performance Index (listing occupancy ÷ market occupancy)

## Git Rules
- ALWAYS create a feature branch: `git checkout -b feature/[name]`
- NEVER commit directly to `main`
- Branch naming: `feature/[descriptive-name]`
- Commit messages: concise, imperative mood ("Add client list page", "Fix task status update")

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=     # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY=     # Server-side only, never expose to browser
PRICELABS_API_KEY=             # PriceLabs API key, server-side only
ASSEMBLY_API_KEY=              # Assembly CRM API key, server-side only
STRIPE_SECRET_KEY=             # Stripe API key, server-side only
CRON_SECRET=                   # Secret for Vercel cron job authentication
```
Rules: no quotes, no spaces after `=`, NEXT_PUBLIC_ prefix = browser-accessible.
