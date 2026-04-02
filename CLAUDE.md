# CLAUDE.md — RevFactor Hub

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
│   ├── clients/
│   │   ├── page.tsx            # Client list (card grid with filters + Sheet side panel)
│   │   └── [id]/page.tsx       # Client detail (standalone page)
│   ├── tasks/
│   │   ├── page.tsx            # Task board (kanban) — server component, fetches data
│   │   ├── tasks-board.tsx     # Client component with optimistic drag-and-drop
│   │   ├── task-dialog.tsx     # Create task form dialog (client+listing selectors)
│   │   └── actions.ts          # Server actions (createTask, updateTaskStatus, deleteTask)
│   ├── roadmap/
│   │   ├── page.tsx            # Roadmap board (kanban) — server component
│   │   ├── roadmap-board.tsx   # Client component with optimistic drag-and-drop
│   │   ├── roadmap-dialog.tsx  # Create roadmap item form dialog
│   │   └── actions.ts          # Server actions (createRoadmapItem, updateRoadmapItemStatus)
│   ├── settings/
│   │   ├── account/
│   │   │   ├── page.tsx            # Account settings (avatar, profile, password)
│   │   │   ├── actions.ts          # Server actions (updateProfile, updatePassword, updateAvatarUrl)
│   │   │   ├── avatar-upload.tsx   # Avatar upload with Supabase Storage
│   │   │   ├── profile-form.tsx    # Name edit form (email disabled)
│   │   │   └── password-form.tsx   # Current/new/confirm password form
│   │   └── users/
│   │       ├── page.tsx            # User management (super_admin only)
│   │       ├── invite-user-dialog.tsx # Invite user with email+password+role
│   │       └── actions.ts          # inviteUser via admin.auth.admin.createUser()
│   ├── onboarding/page.tsx     # Onboarding tracker (pipeline)
│   ├── calendar/page.tsx       # Calendar view
│   └── notes/page.tsx          # Notes feed
proxy.ts                        # Next.js 16 middleware (session refresh + auth redirects)
components/
├── ui/                         # shadcn/ui components (auto-managed)
├── layout/
│   ├── app-sidebar.tsx         # Sidebar nav + user avatar dropdown
│   └── top-bar.tsx             # Dynamic breadcrumbs from pathname
├── clients/
│   ├── clients-view.tsx        # Client card grid with search + status filters + Sheet panel
│   ├── client-card.tsx         # Card: name, status badge, listing count
│   └── client-detail.tsx       # Side panel: contact info, Assembly links, open tasks, listings
├── kanban/
│   ├── kanban-board.tsx        # Generic typed board with @hello-pangea/dnd
│   └── kanban-card.tsx         # Card with left accent border, badges, dropdown move menu
└── theme-provider.tsx          # next-themes provider
lib/
├── supabase/
│   ├── client.ts               # Browser Supabase client (createBrowserClient)
│   ├── server.ts               # Server Supabase client (createServerClient + cookies)
│   ├── admin.ts                # Admin client with service role key
│   └── profile.ts              # Profile type + getProfile() helper
├── assembly.ts                 # Assembly CRM API client (search, channels, deep links)
├── types.ts                    # Shared types (Task, RoadmapItem, Client, Listing, OwnerOption, resolveProfile helper)
└── utils.ts
supabase/
└── migrations/
    ├── 001_profiles.sql        # profiles table, trigger, RLS + get_my_role() SECURITY DEFINER
    ├── 002_clients_and_listings.sql
    ├── 003_tasks_and_roadmap.sql
    ├── 004_tasks_owner_fk.sql  # ALTER tasks.owner to UUID FK → profiles
    ├── 005_profile_avatar.sql  # avatar_url column, avatars storage bucket + policies
    ├── 006_ideas_and_roadmap.sql
    └── 007_assembly_integration.sql  # assembly_client_id, assembly_company_id on clients
scripts/
└── migrate-airtable.ts        # One-time Airtable → Supabase migration (clients + listings)
```

## Authentication & Authorization
- **Auth methods:** Password (primary) + Magic link (secondary), both via Supabase Auth
- **Roles:** `super_admin` and `admin` (stored in `profiles.role`)
- **RLS:** All tables use Row Level Security. The `get_my_role()` SECURITY DEFINER function avoids recursion when policies on `profiles` need to check the user's role
- **Role-based UI:** Settings/user management visible only to `super_admin`. Financial data (ADR, RevPAR, revenue) hidden from non-super_admin users
- **Session refresh:** Handled in `proxy.ts` (Next.js 16 middleware replacement for `middleware.ts`)

## Database Tables (Supabase PostgreSQL)
- **profiles** — id (FK auth.users), email, full_name, avatar_url, role (super_admin/admin), created_at, updated_at
- **clients** — name, email, phone, market, plan, assembly_link, assembly_client_id, assembly_company_id, status (active/onboarding/paused/churned), start_date
- **listings** — client_id (FK), name, pricelabs_id, market, platform, status, cached metrics (adr, occupancy, revpar, revenue_mtd, metrics_synced_at)
- **tasks** — client_id (FK), title, description, status (todo/in_progress/waiting/done), owner (UUID FK → profiles), tag, sort_order, task_listings (junction to listings)
- **roadmap_items** — title, description, owner, tag, status (proposed/planned/in_progress/done), sort_order
- **onboarding_steps** — client_id (FK), step_name, step_order, is_completed, completed_at, completed_by
- **notes** — client_id (FK, nullable), author, content, category (market_insight/client_update/internal/strategy)
- **calendar_events** — client_id (FK, nullable), title, event_date, event_type (pricing_review/contract_renewal/market_event/meeting)

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
- Admin operations (creating users): use admin client from `lib/supabase/admin.ts`
- All database operations go through Supabase client — no raw SQL in frontend code
- Error handling: always handle Supabase query errors with proper user feedback via Sonner toast
- Use React 19 `useOptimistic` for instant UI feedback on mutations (e.g., kanban drag-and-drop)
- Server Actions (`"use server"`) for all data mutations

## UI Conventions
- shadcn/ui default theme for Phase 1 (brand theming comes later)
- Sidebar navigation with icons (use lucide-react)
- Clients page: card grid with search + status toggle filters, Sheet overlay for detail panel
- Financial numbers: right-aligned, monospace font (font-mono), super_admin only
- Status indicators: use shadcn Badge component
- Forms: use shadcn Form + react-hook-form + zod validation
- Loading states: use shadcn Skeleton
- Destructive actions: always confirm via AlertDialog

### Kanban Board Style
- Columns have **subtle tinted backgrounds** matching their semantic color (e.g., yellow for "In Progress", green for "Done")
- Cards have a **left colored accent border** (`border-l-[3px]`) matching the column color
- Column headers show label + count badge (badge uses column color when count > 0)
- Empty columns display centered "No items" placeholder text
- Card metadata (owner, date) shown as icon+label pairs below the card content
- Priority/tag badges support custom colors (e.g., orange for "high", red for "urgent")
- Drag-and-drop via `@hello-pangea/dnd` with optimistic UI updates
- Click-to-move between columns via dropdown menu on each card

## Assembly CRM Integration

Assembly is the client communication platform (CRM + messaging). The Hub integrates with Assembly's API to link clients and provide deep links to conversations.

### Architecture
- **API:** `https://api.assembly.com/v1`, auth via `X-API-KEY` header, rate limit 20 req/sec
- **API client:** `lib/assembly.ts` — server-side only, wraps all Assembly API calls
- **Auth:** Single workspace API key stored as `ASSEMBLY_API_KEY` env var (server-side only)
- **Sync strategy:** On-demand only. No webhooks, no cron, no background sync
- **Caching:** None. Data fetched live from Assembly API per request (fine for 2-3 users)
- **Graceful degradation:** If `ASSEMBLY_API_KEY` is not set, all Assembly UI elements are hidden

### Client Linking
- Clients are linked to Assembly by email match (`searchAssemblyClientByEmail`)
- On link, we store `assembly_client_id` (always) and `assembly_company_id` (if client belongs to a company)
- The `assembly_link` URL is auto-generated based on whether the client has a company or not
- Server actions: `linkAssemblyClientAction`, `unlinkAssemblyClientAction` in `settings/clients/actions.ts`

### Deep Link URL Patterns
- **Individual client chat:** `https://dashboard.assembly.com/clients/users/details/{assembly_client_id}/messages`
- **Company chat:** `https://dashboard.assembly.com/companies/{assembly_company_id}/messages`
- If client has a company → `assembly_link` points to company chat (primary), with separate "Direct Chat" button
- If client has no company → `assembly_link` points to individual chat

### Assembly API Concepts
- **Client** = a contact in Assembly (has email, `companyIds[]`)
- **Company** = a group of clients; has its own message channel where all members participate
- **Message Channel** = conversation thread (`membershipType`: individual, group, or company)
- A client can have both an individual chat AND belong to a company chat

### Key Functions in `lib/assembly.ts`
- `isAssemblyConfigured()` — checks if env var exists
- `searchAssemblyClientByEmail(email)` — finds Assembly client by email
- `getAssemblyClient(id)` — get client details
- `getIndividualChannel(clientId)` — get 1:1 message channel
- `getCompanyChannels(clientId)` — get company message channels
- `getClientChannels(clientId)` — get both individual + company channels
- `assemblyClientMessagesUrl(clientId)` — deep link to individual chat
- `assemblyCompanyMessagesUrl(companyId)` — deep link to company chat

### Integration Status

#### Phase 1 — MVP (DONE)
- [x] Migration `007_assembly_integration.sql` — `assembly_client_id`, `assembly_company_id` columns
- [x] `lib/assembly.ts` — API client with search, channels, deep link helpers
- [x] Server actions `linkAssemblyClientAction` / `unlinkAssemblyClientAction`
- [x] Client detail panel — Assembly linked/unlinked status, "Company Chat" + "Direct Chat" buttons, "Link to Assembly" button
- [x] Settings > Clients table — Assembly status column with link/unlink toggle per row
- [x] Clients page query includes `assembly_client_id`, `assembly_company_id`
- [x] Graceful degradation when `ASSEMBLY_API_KEY` is not set
- [x] Deep links: company chat (primary when company exists) + individual chat

#### Phase 2 — Read messages inline (PENDING)
- [ ] Extend `lib/assembly.ts` with `getChannelMessages(channelId, limit)`, `getFileChannels(clientId)`
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
- [ ] Optional: migration `008_assembly_message_log.sql` — audit log of messages sent from Hub

## STR Domain Terms
- **ADR** = Average Daily Rate (revenue ÷ nights sold)
- **RevPAR** = Revenue Per Available Room (revenue ÷ total available nights)
- **Occupancy** = % of available nights that are booked
- **Pacing** = how bookings are tracking vs. same period prior year
- **PMS** = Property Management System (Hostaway, Hospitable, etc.)
- **PriceLabs** = dynamic pricing tool; each listing has a unique pricelabs_id

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
PRICELABS_API_KEY=             # For edge functions only
ASSEMBLY_API_KEY=              # Assembly CRM API key, server-side only
```
Rules: no quotes, no spaces after `=`, NEXT_PUBLIC_ prefix = browser-accessible.
