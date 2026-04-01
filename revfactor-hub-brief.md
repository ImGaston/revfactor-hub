# revfactor hub — project brief

> Internal operations hub for RevFactor, a short-term rental revenue management consultancy.
> Document version: 1.0 — March 2026

---

## 1. what we're building

An internal command center where the RevFactor team (Gaston + Federico) manages every aspect of the business from a single place: client data, property performance metrics, task management, onboarding tracking, and internal communications.

This is NOT a client-facing product (yet). Phase 1 is purely internal. Phase 2 will expose filtered dashboards to clients via embeddable views.

**Primary URL:** `hub.revfactor.io`

---

## 2. tech stack

| Layer | Tool | Role |
|-------|------|------|
| Frontend | Next.js (App Router) | Pages, routing, SSR |
| UI Components | shadcn/ui + Tailwind v4 | Component library (copy-to-project model) |
| Backend & Database | Supabase (PostgreSQL) | Tables, queries, auth, edge functions, cron |
| Authentication | Supabase Auth | Login for internal team (email/password) |
| Deployment | Vercel | Hosting, preview deploys per branch |
| DNS | Cloudflare | DNS management → hub.revfactor.io |
| Version Control | GitHub | Repo: revfactor-hub |
| AI Development | Claude Code + shadcn skill | Implementation with full component awareness |
| Emails (phase 2) | Resend | Automated alerts and notifications |

**Removed from consideration:**
- Convex → replaced by Supabase for SQL analytical power
- Better-auth → Supabase Auth is built-in
- Upstash (Redis) → PostgreSQL queries eliminate most cache needs
- Stripe → not billing from the hub
- PostHog → too few internal users for analytics
- PorkBun → using existing domain as subdomain
- FastAPI / PostgreSQL standalone → Supabase covers both

---

## 3. design approach

**Phase 1:** shadcn/ui with default styling. Focus on functionality, not aesthetics. Every component works out of the box with a clean, professional SaaS look.

**Phase 2 (post-launch):** Apply RevFactor brand layer via shadcn theming (CSS variables):
- Primary color → Moss (#5D6D59) / Cedar (#13342D)
- Accent → Cedar for CTAs and active states
- Background → Bone (#DDDAD3) for light mode
- Financial metrics → Cormorant Garamond font (display only)
- Data tables → JetBrains Mono for numbers
- Body text → Inter (shadcn default, compatible with brand)

**Design principle:** The hub should feel like Linear or Vercel Dashboard — fast, clean, data-dense, minimal decoration.

---

## 4. data architecture

### Source of truth

Supabase PostgreSQL is the single source of truth. Airtable data is migrated once and then Airtable is retired for this use case.

### Data flow

```
Airtable ──(one-time migration script)──→ Supabase PostgreSQL
                                                ↑
PriceLabs API ──(cron every 30 min)─────────────┘
                                                ↓
                                    Hub Frontend (Next.js)
                                    reads directly from Supabase
```

### Database schema

```sql
-- ══════════════════════════════════════
-- CLIENTS
-- ══════════════════════════════════════
create table clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text,
  phone           text,
  market          text,
  plan            text,                    -- e.g. 'starter', 'growth', 'premium'
  assembly_link   text,                    -- direct URL to Assembly chat
  start_date      date,
  status          text default 'onboarding', -- 'active', 'onboarding', 'paused', 'churned'
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ══════════════════════════════════════
-- LISTINGS (properties)
-- ══════════════════════════════════════
create table listings (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete cascade,
  name            text not null,           -- "Mountain View Lodge"
  pricelabs_id    text,                    -- PriceLabs property ID (key for sync)
  market          text,
  platform        text,                    -- 'airbnb', 'vrbo', 'direct', 'multi'
  status          text default 'active',   -- 'active', 'paused', 'delisted'
  
  -- Cached metrics from PriceLabs (updated via cron)
  adr             decimal(10,2),
  occupancy       decimal(5,2),
  revpar          decimal(10,2),
  revenue_mtd     decimal(10,2),
  metrics_synced_at timestamptz,
  
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ══════════════════════════════════════
-- TASKS
-- ══════════════════════════════════════
create table tasks (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  title           text not null,
  description     text,
  status          text default 'todo',     -- 'todo', 'in_progress', 'waiting', 'done'
  priority        text default 'medium',   -- 'low', 'medium', 'high', 'urgent'
  assigned_to     text,                    -- 'gaston', 'fede'
  due_date        date,
  is_onboarding   boolean default false,   -- true = part of onboarding template
  sort_order      integer default 0,       -- for kanban ordering
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ══════════════════════════════════════
-- ONBOARDING STEPS (template-based)
-- ══════════════════════════════════════
create table onboarding_steps (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete cascade,
  step_name       text not null,
  step_order      integer not null,
  is_completed    boolean default false,
  completed_at    timestamptz,
  completed_by    text,
  notes           text
);

-- Default onboarding steps (inserted per new client):
-- 1. Contract signed
-- 2. PMS access received
-- 3. Listings loaded in system
-- 4. PriceLabs connected
-- 5. Initial strategy defined
-- 6. First pricing review completed
-- 7. First month performance review

-- ══════════════════════════════════════
-- NOTES (internal feed)
-- ══════════════════════════════════════
create table notes (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete cascade, -- null = general note
  author          text not null,           -- 'gaston', 'fede'
  content         text not null,
  category        text,                    -- 'market_insight', 'client_update', 'internal', 'strategy'
  created_at      timestamptz default now()
);

-- ══════════════════════════════════════
-- CALENDAR EVENTS
-- ══════════════════════════════════════
create table calendar_events (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  title           text not null,
  description     text,
  event_date      date not null,
  event_type      text,                    -- 'pricing_review', 'contract_renewal', 'market_event', 'meeting'
  is_recurring    boolean default false,
  created_at      timestamptz default now()
);

-- ══════════════════════════════════════
-- INDEXES for performance
-- ══════════════════════════════════════
create index idx_listings_client on listings(client_id);
create index idx_listings_pricelabs on listings(pricelabs_id);
create index idx_tasks_client on tasks(client_id);
create index idx_tasks_status on tasks(status);
create index idx_onboarding_client on onboarding_steps(client_id);
create index idx_notes_client on notes(client_id);
create index idx_calendar_date on calendar_events(event_date);

-- ══════════════════════════════════════
-- USEFUL VIEWS (pre-built queries)
-- ══════════════════════════════════════

-- Portfolio summary per client
create view client_portfolio_summary as
select 
  c.id,
  c.name,
  c.market,
  c.status,
  count(l.id) as listing_count,
  avg(l.adr) as avg_adr,
  avg(l.occupancy) as avg_occupancy,
  avg(l.revpar) as avg_revpar,
  sum(l.revenue_mtd) as total_revenue_mtd
from clients c
left join listings l on l.client_id = c.id and l.status = 'active'
group by c.id, c.name, c.market, c.status;

-- Onboarding progress per client
create view onboarding_progress as
select 
  c.id,
  c.name,
  count(os.id) as total_steps,
  count(case when os.is_completed then 1 end) as completed_steps,
  round(
    count(case when os.is_completed then 1 end)::decimal / 
    nullif(count(os.id), 0) * 100, 
    0
  ) as progress_pct
from clients c
join onboarding_steps os on os.client_id = c.id
where c.status = 'onboarding'
group by c.id, c.name;
```

### PriceLabs sync logic

A Supabase Edge Function runs on a cron schedule (every 30 minutes) that:
1. Queries all listings with a `pricelabs_id`
2. Calls PriceLabs API with those IDs
3. Updates `adr`, `occupancy`, `revpar`, `revenue_mtd`, and `metrics_synced_at`
4. The frontend always reads from the database — never directly from PriceLabs

---

## 5. application sections

### 5.1 Dashboard (home)

The first thing you see when you open the hub. Aggregated KPIs across the entire portfolio.

**Components:**
- 4 stat cards: Total Revenue MTD, Average ADR, Portfolio Occupancy %, Active Clients
- Each card shows trend vs. previous period
- Mini chart: revenue last 6 months (area/line)
- Task summary: 5 most recent/urgent tasks
- Onboarding alerts: clients with incomplete onboarding
- Data freshness: "Last synced: 12 min ago" timestamp

### 5.2 Clients (CRM list)

Sortable, filterable table of all clients.

**Components:**
- Data table with columns: Name, Market, # Listings, Revenue MTD, Status (badge), Last Contact
- Search bar (search by name, market)
- Filter dropdowns: by status, by market
- "Add Client" button → opens modal/drawer with form
- Click row → navigates to client detail

### 5.3 Client Detail

Everything about ONE client in a single view.

**Layout:** Header card + tab navigation

**Header:** Client name (large), market, status badge, start date, contact info, Assembly chat link (external link icon)

**Tabs:**
- **Overview:** Summary stats (revenue, ADR, occupancy across their listings), onboarding progress bar
- **Listings:** Table of their properties with PriceLabs metrics (ADR, Occ%, RevPAR, last synced)
- **Tasks:** Filtered task list for this client only
- **Notes:** Chronological notes feed + "add note" form

### 5.4 Task Board

Kanban-style task management.

**Columns:** To Do → In Progress → Waiting on Client → Done

**Task card contents:** Title, client name tag, assignee avatar/initial, due date, priority indicator (color dot)

**Controls:**
- Filter by: assignee (Gaston/Fede), client, priority
- "New Task" button → modal with form (title, client, assignee, priority, due date)
- Drag and drop between columns (nice-to-have for MVP; can use dropdown to change status initially)

### 5.5 Onboarding Tracker

Pipeline view for clients currently in onboarding.

**Steps per client:**
1. Contract signed
2. PMS access received
3. Listings loaded in system
4. PriceLabs connected
5. Initial strategy defined
6. First pricing review completed
7. First month performance review

**Display:** Each client as a row with checkboxes per step, progress bar, completion dates, and overall progress percentage.

**Summary view:** Count of clients in each stage.

### 5.6 Calendar

Monthly view of important dates.

**Event types:** Pricing reviews, contract renewals, market events (peak season, local events, holidays), meetings.

**Features:** Click date to add event, associate events with clients, color-coded by event type.

### 5.7 Notes Feed

Internal knowledge base / activity feed.

**Categories:** Market insight, client update, internal, strategy.

**Features:** Add note with optional client association, filter by category, chronological feed (newest first), author attribution.

---

## 6. navigation structure

```
Sidebar (collapsible):
├── Dashboard          (home icon)
├── Clients            (users icon)
├── Tasks              (check-square icon)
├── Onboarding         (clipboard icon)
├── Calendar           (calendar icon)
├── Notes              (message-square icon)
└── Settings           (gear icon) — phase 2
```

Top bar: Search (global), notifications bell (phase 2), user avatar with dropdown (logout).

---

## 7. multi-frontend vision

The Supabase backend is designed to serve multiple frontends:

```
                    Supabase (PostgreSQL + Auth)
                         /       |        \
              Hub interno    Client Portal    iOS App
              (Next.js)      (embed/iframe)   (SwiftUI)
              full access    filtered by       filtered by
                             client RLS        client RLS
```

**Row Level Security (RLS)** policies will be added in Phase 2 to restrict client-facing views. The schema already supports this via `client_id` foreign keys on every table.

Client dashboards would live at `clients.revfactor.io/[clientId]` and be embeddable in Assembly via iframe.

---

## 8. development approach

### Branch strategy

Work by feature, not by layer. Each branch includes both frontend and backend code for that feature.

```
main (protected)
├── feature/project-setup         ← scaffolding, shadcn, supabase config
├── feature/database-schema       ← SQL migrations, seed data
├── feature/client-list           ← clients table page + supabase queries
├── feature/client-detail         ← detail page with tabs
├── feature/task-board            ← kanban board + task CRUD
├── feature/onboarding-tracker    ← pipeline view + step management
├── feature/dashboard             ← KPI cards, charts, aggregations
├── feature/calendar              ← calendar view + event CRUD
├── feature/notes-feed            ← notes feed + CRUD
├── feature/pricelabs-sync        ← edge function + cron job
├── feature/brand-theming         ← RevFactor colors, fonts, final polish
```

### Claude Code workflow

1. Always create a feature branch: `git checkout -b feature/[name]`
2. Never commit directly to `main`
3. Reference CLAUDE.md for project context
4. Use the shadcn skill for component generation
5. Test locally before pushing

### Key files

```
revfactor-hub/
├── CLAUDE.md                    ← project context for Claude Code
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 ← dashboard
│   ├── clients/
│   │   ├── page.tsx             ← client list
│   │   └── [id]/page.tsx        ← client detail
│   ├── tasks/page.tsx           ← task board
│   ├── onboarding/page.tsx      ← onboarding tracker
│   ├── calendar/page.tsx        ← calendar
│   └── notes/page.tsx           ← notes feed
├── components/
│   ├── ui/                      ← shadcn components
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   └── top-bar.tsx
│   ├── dashboard/
│   ├── clients/
│   ├── tasks/
│   └── shared/
├── lib/
│   ├── supabase/
│   │   ├── client.ts            ← browser client
│   │   ├── server.ts            ← server client
│   │   └── middleware.ts        ← auth middleware
│   └── utils.ts
├── supabase/
│   └── migrations/              ← SQL migration files
├── components.json              ← shadcn config
└── .env.local                   ← Supabase keys (never committed)
```

---

## 9. execution phases

### Phase 1 — Foundation (weeks 1-2)
- Project scaffolding (Next.js + shadcn + Supabase)
- Database schema + migrations
- Auth (login page for Gaston + Fede)
- Layout (sidebar + top bar)
- Client list page (CRUD)
- Client detail page (tabs, listings, notes)

### Phase 2 — Operations (weeks 3-4)
- Task board (kanban with status changes)
- Onboarding tracker (pipeline + step management)
- Dashboard (KPI cards + basic charts)
- Notes feed

### Phase 3 — Integrations (weeks 5-6)
- PriceLabs sync (edge function + cron)
- Airtable migration script (one-time)
- Calendar view
- Data freshness indicators

### Phase 4 — Polish (week 7+)
- RevFactor brand theming (colors, fonts)
- Drag and drop on task board
- Search improvements
- Notification system (Resend)
- Client-facing dashboard (RLS + embed)

---

## 10. environment variables

```env
# .env.local (never commit this file)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# PriceLabs (for edge function)
PRICELABS_API_KEY=pl_...

# Resend (phase 2)
RESEND_API_KEY=re_...
```

**Rules:**
- No quotes around values
- No spaces after `=`
- `NEXT_PUBLIC_` prefix = accessible in browser
- Without prefix = server-side only (API routes, edge functions)
- Never commit `.env.local` to GitHub

---

## 11. key SQL queries (examples)

These illustrate the analytical power of PostgreSQL for revenue management:

```sql
-- ADR comparison by market, current month vs same month last year
-- (once historical data is available)

-- Clients with onboarding stalled (no progress in 7+ days)
select c.name, op.completed_steps, op.total_steps, op.progress_pct
from onboarding_progress op
join clients c on c.id = op.id
where op.progress_pct < 100
  and c.updated_at < now() - interval '7 days';

-- Top performing listings by RevPAR
select l.name, c.name as client, l.market, l.revpar, l.occupancy, l.adr
from listings l
join clients c on c.id = l.client_id
where l.status = 'active'
order by l.revpar desc
limit 10;

-- Tasks overdue by assignee
select assigned_to, count(*) as overdue_count
from tasks
where status != 'done' and due_date < current_date
group by assigned_to;

-- Portfolio revenue by market
select l.market, sum(l.revenue_mtd) as total_revenue, avg(l.adr) as avg_adr
from listings l
where l.status = 'active'
group by l.market
order by total_revenue desc;
```

---

*This brief is the single source of truth for building the RevFactor Hub. All implementation decisions should reference this document.*
