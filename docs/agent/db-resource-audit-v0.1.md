# DB Resource Audit — v0.1 (diagnóstico, 2026-07-22)

Diagnostic-only audit of Postgres IO/memory consumption after the 2026-07-21 incident.
**No fixes are implemented here.** Each finding lists evidence, estimated impact, and a
proposed fix for later scoping.

## Incident summary (evidence from Supabase logs)

- Window: **2026-07-21 21:44–23:31 UTC** — 25 `canceling statement due to statement timeout`,
  10 user-cancels, 5 auth timeouts; stragglers until 10:22 UTC on 07-22. Instance restarted
  2026-07-22 10:39 UTC.
- The "58s" timeouts match the Supabase dashboard's own session setting
  (`SET statement_timeout='58s'`) — the number itself is a dashboard artifact, not an app setting.
- **The postgres log feed does not include the SQL of the timed-out statements**, so the culprit
  queries cannot be named from logs. `pg_stat_statements` was reset at the restart, so
  pre-incident stats are gone too. Everything below is therefore a code/schema audit of what
  *can* generate the observed IO pressure, not a proven single cause.
- No OOM/temp-file/checkpoint distress lines in the log slice; checkpoints were healthy.
  The failure shape is consistent with **Disk IO budget exhaustion on Micro** (throttled to
  baseline IOPS, everything stalls) rather than one pathological query.
- Incident time (21:44 UTC) is far from the crons (08:00/08:30 UTC). The daily syncs consume
  the IO budget; evening interactive load then ran with the budget already depleted.

## Database shape (live, 2026-07-22)

- Total ~118 MB, but **~74 MB is sync-produced data**: `report_metrics` 34 MB (72,348 rows,
  25 runs ≈ 2,900 new rows per daily run), `seo_metrics_raw` 22 MB (91,767 rows),
  `report_runs` 18 MB (34 rows — **17 MB of it is `raw_envelope` JSON blobs on 24 rows**).
- Operational tables are small: 256 listings, 102 clients, 146 leads, 13 tasks,
  725 stripe_invoices, 1,597 stripe_payout_transactions.
- Performance Advisor totals: 19 `auth_rls_initplan` (WARN), 20 `multiple_permissive_policies`
  (WARN), 45 `unindexed_foreign_keys` (INFO), 94 `unused_index` (INFO), 1 auth-connections INFO.

---

## 1. RLS policies

### 1.1 `has_permission()` re-evaluated per row everywhere — **impacto: ALTO**

**Evidence.** Not one policy in the schema wraps its function calls in a scalar subquery.
Live check (`pg_policies`): ~35 tables carry 3 unwrapped `has_permission(...)` calls each;
comment/reaction tables add unwrapped `auth.uid()`.

The amplification is worse than the standard Supabase lint suggests because of the helper chain:

```sql
-- 019_permission_based_rls.sql — SECURITY DEFINER ⇒ Postgres can NEVER inline it
CREATE FUNCTION has_permission(p_resource TEXT, p_action TEXT) ... STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM role_permissions
                 WHERE role_name = public.get_my_role() AND resource = p_resource
                   AND action = p_action AND allowed = true)
  OR public.get_my_role() = 'super_admin';   -- get_my_role() called TWICE
$$;
-- get_my_role(): STABLE SECURITY DEFINER, SELECT role FROM profiles WHERE id = auth.uid()
```

Because both functions are `SECURITY DEFINER`, they are executed as real function calls
**per row scanned**: each evaluation = 1 lookup on `role_permissions` + up to 2 lookups on
`profiles`. A SELECT that returns N rows through RLS performs up to ~3·N extra index scans.
On `report_metrics` (≈2,900 rows per dashboard pacing query) that is ~9,000 hidden lookups
per page load; `pg_stat_statements` (post-restart, single user) already shows that PostgREST
query at **426 ms mean / 24 calls**, the most expensive app query of the day.

**Proposed fix (one migration, mechanical).** Re-create every policy wrapping calls as
`USING ((select has_permission('x','view')))` — the planner turns it into an InitPlan evaluated
**once per statement**. Same for `auth.uid()` and `get_my_role()` occurrences (the Advisor's 19
`auth_rls_initplan` WARNs: `profiles`, `lead_notes`, `task_comments`, `onboarding_comments`,
`adjustment_*`, `task_comment_reactions`). Secondary: rewrite `has_permission` to call
`get_my_role()` once. No behavior change, pure planner hint.

### 1.2 Multiple permissive policies per table+command — **impacto: MEDIO**

Each permissive policy for the same command ORs together and is evaluated per row.

| Table(s) | Overlap | Source |
|---|---|---|
| `profiles` | SELECT ×3 (`Users can view own` + `Super admins can view all` + 024's `USING (true)`), UPDATE ×2. The 001 super-admin policies run an unwrapped `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() ...)` **per row** | 001 / 005 / 024 |
| 9 financial tables (`stripe_subscriptions`, `stripe_invoices`, `stripe_payouts`, `stripe_payout_transactions`, `client_stripe_customers`, `dismissed_payment_issues`, `bank_accounts`, `bank_statement_imports`, `bank_transactions`) | 038's `financials:view` SELECT policy ORs with the older `FOR ALL` super-admin policy | 024/025/032/033/034 + 038 |
| `api_keys` | SELECT ×2 (both super_admin) | 043 |
| `storage.objects` | avatars + knowledge-images policies stack per command | 005 + 021 |

**Proposed fix.** Drop the redundant 001 `profiles` policies (superseded by 024's
`USING (true)` for authenticated), and scope the old financial `FOR ALL` policies to
INSERT/UPDATE/DELETE so SELECT has a single policy. Fold into the same migration as 1.1.

### 1.3 Hygiene (low impact, worth fixing while in there)

- `roadmap_items` still has `USING (true)` for **all** commands (003; skipped by 038) —
  violates the project's own "never `USING (true)`" rule. `reservations` SELECT is also
  `USING (true)` (023; table not applied in prod, so dormant).
- **`get_my_role()` has no definition in any migration** — it exists only in the live DB.
  Schema drift risk: a from-scratch rebuild breaks ~15 migrations. Capture it in the next migration.
- 1.1/1.2 escape the Supabase linter (it only pattern-matches `auth.*`/`current_setting`),
  so "Advisor is green" will never confirm the `has_permission` fix — verify with `EXPLAIN`
  (InitPlan present) instead.

---

## 2. Índices (inventario — ejecución en scope separado)

### 2.1 FKs sin índice (Advisor `unindexed_foreign_keys`: 45 en 32 tablas)

At today's row counts none of these explains the incident, but they make every joined read
and every `profiles`/`tasks`/`listings` delete-or-update cascade a seq scan. Priority subset
(tables that join on every page render or participate in sync writes):

- `adjustments.listing_id`, `adjustments.created_by/resolver_id/reviewer_id`
- `adjustment_comments.author_id`, `task_comments.author_id`, `lead_notes.author_id`,
  `onboarding_comments.author_id` (joined for author names on every comment fetch)
- `report_listings.report_run_id` (report-builder ingest/queries)
- `bank_transactions.import_id`, `.expense_id`, `.matched_transfer_id`
- `onboarding_run_*` composite FKs (`run_listing_id`, `parent_run_listing_id`, comp/event junctions)
- `tasks.owner`, `profiles.role`
- Full list: Advisor output 2026-07-22 (45 items); the remainder are `created_by`-type audit columns.

### 2.2 Índices sin uso (Advisor `unused_index`: 94)

⚠️ **Weak signal right now**: index stats were reset with the 2026-07-22 restart, so "unused"
reflects hours, not history. Re-check after ≥2 weeks of normal traffic before dropping anything.
Notable candidates if confirmed later: the 5 `leads.utm_*`/`msclkid` single-column indexes,
`knowledge_articles_*` (5), `stripe_invoices_*` (4). Each unused index still costs write IO on
every INSERT/UPDATE.

### 2.3 Known candidates already on file

`docs/agent/performance.md` already lists `tasks(sort_order, created_at DESC)` and
`onboarding_progress.client_id/template_id`; `listings.listing_id` was covered by 035.

---

## 3. Patrones N+1

The primary list pages (`/clients`, `/listings`, dashboard, tasks, pipeline) are clean — they
use nested PostgREST embeds or `.in()`. Two server actions loop:

| Where | Pattern | Impacto |
|---|---|---|
| `app/(authenticated)/pipeline/actions.ts:295-302` (`bulkAssignTeam`) | one `.delete()` + one `.insert()` **per selected lead** | BAJO (bulk UI action) — fix: single `.delete().in("lead_id", ids)` + one batched insert |
| `app/(authenticated)/financials/actions.ts:350-374` (`linkStripeCustomers`) | per-client Stripe search + per-client `.upsert()`/`.update()` | BAJO (manual admin action) — fix: batch the DB writes; Stripe search stays per-client |

Also row-by-row: the PriceLabs sync write loop — see §6, where it matters most.

---

## 4. Queries sin límite / paginación / `select *`

| Where | Evidence | Impacto |
|---|---|---|
| `lib/monthly-pacing.ts:91-104` | pages through **all** `report_metrics` rows of the latest run (~2,900) via `.range()` loop **on every dashboard load**; RLS per-row tax (§1.1) applies to every page | **ALTO** — top candidate for `unstable_cache` (§7) and/or a pre-aggregated view |
| `app/(authenticated)/financials/page.tsx:81-148` | `expenses` (embeds ×2), `stripe_subscriptions`, `stripe_invoices` (no limit), `stripe_payout_transactions` `.limit(5000)`, `bank_transactions` `.limit(1000)` then sorted/sliced in JS | MEDIO — super_admin-only page, but each load moves MBs (rows carry `raw_json`-adjacent width); select only needed columns, aggregate payouts server-side |
| `app/(authenticated)/tasks/page.tsx:14-18` + `app/(authenticated)/page.tsx:22` | `tasks.select("*", embeds)` unbounded; dashboard re-pulls all tasks (`id,status`) | BAJO hoy (13 tasks) — grows with usage |
| `app/(authenticated)/pipeline/page.tsx:13-19` | `leads.select("*", embeds)` unbounded incl. `attribution_extra` jsonb, `description` | BAJO-MEDIO (146 leads y crece) |
| `roadmap/page.tsx:13-46`, `knowledge/page.tsx:19-24` | unbounded `post_with_counts` (view = 2 GROUP BY subqueries over full tables), `knowledge_articles.select("*")` incl. article bodies for a list view | BAJO-MEDIO |
| `lib/supabase/profile.ts:21-24`, `lib/permissions.server.ts:51,68` | `profiles.select("*")`, `role_permissions.select("*")`, `roles.select("*")` on **every request**, multiple times (§7) | MEDIO (frequency, not width) |
| `lib/pacing.ts:96-104` | `reservations.select(...).limit(5000)` exploded per-day in JS — **dormant** (no UI consumer) | ninguno hoy; no despertar sin arreglar |
| Wide `select("*")` elsewhere | `clients/[id]` credentials, `report_listings` (`queries.ts:39`), settings pages, `leads` detail | BAJO — trim opportunistically |

## 5. Counts

- `app/(authenticated)/page.tsx:18-24` — **5 exact counts per dashboard load**, 3 of them
  separate head-counts on `clients` (total/active/onboarding) + `listings` + `posts`.
  Confirmed in `pg_stat_statements` as PostgREST `count(*)` wrappers. Fix: one grouped query
  (`select status, count(*) group by status`) or fold into the cached dashboard payload (§7).
  With RLS, each `count(*) exact` scans every visible row **through the §1.1 per-row tax**.
- `lib/pacing.ts:95` — exact count on listings (dormant consumer).
- `knowledge/actions.ts:245` — exact count inside a delete action: fine (rare, needs precision).
- `{ count: 'estimated' }` needs `ANALYZE`-fresh stats; at this scale the grouped-query fix
  beats switching count modes.

Impacto: MEDIO (frecuencia: cada carga del dashboard).

---

## 6. Syncs y crons

### 6.1 PriceLabs sync — fila por fila — **impacto: MEDIO-ALTO**

`lib/pricelabs-sync.ts:137-181`: after one full-table read of `listings`, the loop issues
**one sequential `UPDATE ... .select("id").maybeSingle()` per matched listing** — ~256
round-trip UPDATEs + read-backs per daily run, autocommit each. No batching, no `.upsert()`.
The loop has no time-budget check, and it eats into the 52 s shared budget before the chained
report-builder run. External call: single fetch, `AbortSignal.timeout(15_000)`, non-200 aborts
the whole sync (no retry — safe failure mode, no writes happen).

**Fix propuesto:** chunked `upsert` (500/chunk, like the report builder already does) or a
single `UPDATE ... FROM (VALUES ...)` via RPC; drop the per-row `.select("id")` read-back.
~256 statements → ~1-2.

### 6.2 Report Builder — retención inexistente — **impacto: ALTO (es el driver #1 de tamaño/IO)**

- Writes are properly chunked (`UPSERT_CHUNK = 500`), but **every daily run appends a full
  new `report_metrics` set keyed by `report_run_id`** (~2,900 rows/run). 25 runs → 72k rows,
  34 MB, growing ~90k rows/month. Only the newest run is ever read
  (`lib/report-builder/queries.ts`, `lib/monthly-pacing.ts`).
- `report_runs.raw_envelope` keeps the **entire PriceLabs JSON envelope for the newest 30
  runs** (`ingest.ts:206-225` prunes only beyond `.range(30, 1029)`); live DB: 17 MB across
  24 rows. Code comment warns wide templates "balloon to ~100 MB".
- `buildResolutionMaps` (`ingest.ts:35-63`) re-reads `listings`+`clients`+overrides fully per
  run — fine at this scale.
- Poll loop holds the serverless function (not the DB) up to its deadline; DB writes are short.

**Fix propuesto:** retention job in the same cron — delete `report_metrics`/`report_listings`
rows for runs older than the last N (e.g. 7), keep `raw_envelope` for the last 2-3 runs only.
Cuts DB size roughly in half and shrinks the working set the dashboard queries traverse.

### 6.3 Stripe sync — blobs y sweeps — **impacto: MEDIO**

- Every mirrored row stores its full Stripe object: `raw_json` on `stripe_invoices` (:148),
  `stripe_subscriptions` (:235, with stitched full product objects), `stripe_payouts` (:390),
  `stripe_payout_transactions` (:459). Invoices/payouts/transactions are **never pruned** —
  they accumulate forever (already 4.6 MB + 3.5 MB; grows with every invoice Stripe emits).
- Prune sweep for subscriptions uses an **unbounded `NOT IN (id-list of every current sub)`**
  delete (`stripe-sync.ts:293-299`).
- Payout reconciliation fans out **6 concurrent** Stripe paginations each doing
  delete-then-upsert bursts (`:463-474,:484-494`); the per-payout delete+upsert is not atomic.
- `maxDuration = 300`; a slow Stripe keeps paging within that window (holds the function and
  its DB connection, not a transaction).
- Full paginated read of `stripe_payout_transactions` (pages of 1,000) each run to compute
  already-mirrored payouts — will grow linearly forever without retention.

**Fix propuesto:** stop storing `raw_json` for payout transactions (or strip to the fields
consumed), add retention or column-slimming for invoice blobs, replace the `NOT IN` sweep with
a `status`-based update, and drop reconciliation concurrency to 2-3.

### 6.4 Webhooks — OK

Single-row handlers, 2 indexed reads + 1 insert each. Only note: `sort_order` read-modify-write
has no locking (cosmetic collision risk, not a resource issue).

---

## 7. Caching / revalidación / duplicación por request — **impacto: ALTO**

**There is no request-level or cross-request data caching anywhere**: zero `unstable_cache`,
zero React `cache()`; only mutation-side `revalidatePath`. Consequences, per navigation:

1. Layout (`app/(authenticated)/layout.tsx:18-20`): `auth.getUser()` + `profiles.select("*")`
   + `role_permissions.select("*")`.
2. The page then calls `getProfile()` / `hasPermission()` again — each creating **its own
   Supabase client** and re-running `auth.getUser()` + `profiles` (+ `role_permissions`).
   Measured examples: `listings/page.tsx:8-17` = 2 duplicate permission round-trips;
   `clients/[id]/page.tsx:28-34` = 3 clients / `profiles` fetched twice; every settings page
   the same. Net: **the same 2-3 queries run 2-3× per request**, on every navigation, times
   every concurrent user — pure baseline load that competes for the Micro's IO budget.
3. Sequential await chains where `Promise.all` fits: `roadmap/page.tsx:8-46` (6 awaits,
   **`boards` queried twice**: :19 y :36), `knowledge`, `pipeline`, `onboarding` (re-fetches
   `onboarding_progress` after conditional insert). Latency, not IO — but holds connections longer.

**Fix propuesto (respeta la regla "no page-level ISR"):**
- Wrap `getProfile`, `getRolePermissions`, `hasPermission`, and `createClient` in React
  `cache()` — per-request dedupe, zero staleness, removes the duplication in (2).
- `unstable_cache` with tags + minutes-level TTL for the two heavy read-only payloads:
  dashboard pacing data (`monthly-pacing.ts` — data changes once a day at 08:00) and the
  dashboard counts (§5). Invalidate from the cron.

## 8. Conexiones / clientes Supabase

- Convention (server/browser/admin) is respected; no client creation inside loops.
- But `createServerClient` is constructed fresh in every helper call (layout + page + each
  `hasPermission`) — harmless per se (PostgREST is HTTP), yet each call re-runs `auth.getUser()`
  (a GoTrue network call). The React `cache()` fix in §7 collapses this too.
- Advisor INFO `auth_db_connections_absolute`: Auth server holds 10 absolute connections on a
  Micro (60-connection budget) — switch to percentage-based in dashboard settings when upsizing
  to Small. `auth.users` shows 523 seq scans since restart (GoTrue internals; small table, low
  priority, just noting it).

---

## Ranking — top 5 fixes por impacto/esfuerzo

1. **Migración RLS: envolver todas las policies en `(select has_permission(...))` /
   `(select auth.uid())` + consolidar policies permisivas duplicadas + una sola llamada a
   `get_my_role()` dentro de `has_permission`** (§1.1-1.2). Un archivo, mecánico, sin cambio
   de comportamiento; elimina el multiplicador ~3·N de cada lectura de la app.
2. **React `cache()` para `getProfile`/`getRolePermissions`/`hasPermission`/`createClient`**
   (§7). Pocas líneas; corta 2-3× las queries de identidad/permiso en cada navegación.
3. **Retención en Report Builder: borrar runs viejos de `report_metrics`/`report_listings`,
   `raw_envelope` solo para 2-3 runs** (§6.2). Reduce ~50% el tamaño de la DB y el working set
   bajo presión de memoria (1 GB / swap).
4. **Dashboard: counts agrupados + `unstable_cache` (TTL minutos, invalidado por el cron) para
   pacing y counts** (§4-§5-§7). Convierte la página más visitada en ~0 IO por carga.
5. **Batch del write-loop de PriceLabs sync (upsert chunked, sin read-back)** (§6.1).
   ~256 statements diarios → 1-2; esfuerzo bajo.

Después de estos cinco, los siguientes en cola serían los índices FK prioritarios (§2.1, scope
separado) y la dieta de `raw_json` del sync de Stripe (§6.3).

## Out of scope (explícito)

- **Ejecución de índices** (crear/borrar): inventario en §2; se ejecuta en un scope separado.
- **El módulo de Adjustments** (`app/(authenticated)/adjustments/`, `app/a/`): excluido del
  audit de código por pedido; sus tablas solo aparecen donde el Advisor/`pg_policies` las lista.
- Migración de datos, cambios de UI, y cualquier refactor no relacionado con consumo de recursos.
- Cambios de plan/compute de Supabase (el upgrade a Small ya está decidido; compra margen, no
  arregla causas).

## Relación con trabajo existente

- `clients-listings-perf-plan-v2.md` **no existe en el repo** (buscado con `rg`); la memoria de
  performance vigente es `docs/agent/performance.md` y `docs/performance-baseline.md`.
- Ya cubierto por trabajo previo (no duplicado acá): trimming de columnas en `/clients` y
  `/listings`, lazy dialog data, skeletons, índices de la migración 030, y la regla de no-ISR
  en rutas autenticadas.
- Nuevo en este audit: el tax por fila de RLS (§1), la ausencia total de dedupe/caching por
  request (§7), la falta de retención en report builder / Stripe mirror (§6.2-6.3), el write
  loop fila-por-fila de PriceLabs (§6.1), y los 5 counts exactos del dashboard (§5).

## Verificación de este documento

Fuentes: `pg_policies`, `pg_stat_statements`, `pg_stat_user_tables`, tamaños vivos y Performance
Advisor del proyecto `xpfjjcwgbjsdxdhyrcxd` (2026-07-22, post-restart: stats de índices/queries
cubren solo horas); lectura de `supabase/migrations/001-048`; audit de código de
`app/(authenticated)/`, `lib/`, `app/api/cron/`, `app/api/webhooks/`. Logs del incidente:
últimas 24 h del servicio postgres (sin SQL de los statements cancelados).
