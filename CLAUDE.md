# CLAUDE.md — RevFactor Hub

## Project Overview
Internal operations hub for RevFactor, a short-term rental (STR) revenue management consultancy. Built for 2-3 internal users (Gaston, Federico). NOT client-facing in Phase 1.

**URL:** hub.revfactor.io

## Tech Stack
- **Frontend:** Next.js 14+ (App Router) + shadcn/ui + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL + Auth + Edge Functions)
- **Deployment:** Vercel
- **Repo:** GitHub

## Project Structure
```
app/
├── layout.tsx              # Root layout with sidebar + top bar
├── page.tsx                # Dashboard (home)
├── clients/
│   ├── page.tsx            # Client list (data table)
│   └── [id]/page.tsx       # Client detail (tabs: overview, listings, tasks, notes)
├── tasks/page.tsx          # Task board (kanban)
├── onboarding/page.tsx     # Onboarding tracker (pipeline)
├── calendar/page.tsx       # Calendar view
└── notes/page.tsx          # Notes feed
components/
├── ui/                     # shadcn/ui components (auto-managed)
├── layout/                 # sidebar.tsx, top-bar.tsx
└── [feature]/              # feature-specific components
lib/
├── supabase/
│   ├── client.ts           # Browser Supabase client
│   ├── server.ts           # Server Supabase client
│   └── middleware.ts       # Auth middleware
└── utils.ts
supabase/
└── migrations/             # SQL migration files
```

## Database Tables (Supabase PostgreSQL)
- **clients** — name, email, phone, market, plan, assembly_link, status (active/onboarding/paused/churned), start_date
- **listings** — client_id (FK), name, pricelabs_id, market, platform, status, cached metrics (adr, occupancy, revpar, revenue_mtd, metrics_synced_at)
- **tasks** — client_id (FK), title, description, status (todo/in_progress/waiting/done), priority (low/medium/high/urgent), assigned_to, due_date, is_onboarding, sort_order
- **onboarding_steps** — client_id (FK), step_name, step_order, is_completed, completed_at, completed_by
- **notes** — client_id (FK, nullable), author, content, category (market_insight/client_update/internal/strategy)
- **calendar_events** — client_id (FK, nullable), title, event_date, event_type (pricing_review/contract_renewal/market_event/meeting)

## Key Views
- **client_portfolio_summary** — aggregates listing metrics per client
- **onboarding_progress** — calculates completion % per onboarding client

## Coding Conventions
- Use TypeScript strict mode
- Use shadcn/ui components — install via `npx shadcn@latest add [component]`
- Use `@/` alias for imports from project root
- Supabase queries: use server client in Server Components, browser client in Client Components
- All database operations go through Supabase client — no raw SQL in frontend code
- Error handling: always handle Supabase query errors with proper user feedback via shadcn Toast/Sonner

## UI Conventions
- shadcn/ui default theme for Phase 1 (brand theming comes later)
- Sidebar navigation with icons (use lucide-react)
- Data tables use shadcn DataTable pattern with sorting and filtering
- Financial numbers: right-aligned, monospace font (font-mono)
- Status indicators: use shadcn Badge component
- Forms: use shadcn Form + react-hook-form + zod validation
- Loading states: use shadcn Skeleton
- Destructive actions: always confirm via AlertDialog

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
```
Rules: no quotes, no spaces after `=`, NEXT_PUBLIC_ prefix = browser-accessible.
