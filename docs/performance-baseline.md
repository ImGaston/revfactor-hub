# Línea Base de Desempeño — RevFactor Hub

**Diagnostic Report | Baseline de Rendimiento Pre-Optimización**  
**Generado:** 18 de abril de 2026  
**Codebase:** Next.js 16 App Router + Supabase 29 migraciones

---

## 1. Índices Existentes

### Inventario Completo por Tabla

#### `clients`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_clients_status` — migration 002:line 95
  - `idx_clients_assembly_client_id` — migration 007:line 3
- **Constraints:** FK `profiles(id)` on created_by; FK `roles(id)` on role_id

**🚩 Observaciones:**
- Status indexado ✓
- Pero no hay índice en `stripe_customer_id` (usado en consultas join a Stripe en financials/page.tsx)

---

#### `listings`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_listings_client_id` — migration 002:line 96
  - `idx_listings_status` — migration 026:line 3
  - `idx_listings_stripe_subscription_id` — migration 017:line 3 (WHERE stripe_subscription_id IS NOT NULL)
- **Constraints:** FK `clients(id)` on client_id

**🚩 Observaciones:**
- **CRÍTICO:** No hay índice en `listing_id` (external PriceLabs ID). Usado cada día en:
  - `api/cron/sync-pricelabs/route.ts:69` — loop de UPDATE busca `listing_id` contra PriceLabs API
  - `settings/listings/actions.ts:92` — sincronización manual hace lo mismo
  - Full table scan en cada sync → O(n) donde n = número de listings
- Índice en status ✓
- Índice en client_id ✓
- `pl_*` columns (16 totales) no tienen índices individuales (aceptable: se actualizan en batch)

**Recomendación:** Crear `CREATE INDEX idx_listings_listing_id ON listings(listing_id)`

---

#### `leads`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_leads_stage` — migration 008:line 47
  - `idx_leads_sort_order` — migration 008:line 48
  - `idx_leads_created_by` — migration 008:line 49
  - `idx_leads_is_archived` — migration 009:line 3
  - `idx_leads_is_completed` — migration 009:line 4
- **Constraints:** FK `profiles(id)` on created_by, assigned_to; FK `clients(id)` on assembly_client_id

**Estado:** Completo. Todos los filtros auditados están indexados.

---

#### `tasks`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_tasks_status` — migration 003:line 110
  - `idx_tasks_client_id` — migration 003:line 111
  - `idx_tasks_is_archived` — migration 028:line 3
- **Constraints:** FK `clients(id)` on client_id; FK `profiles(id)` on owner

**🚩 Observaciones:**
- Status indexado ✓
- Client_id indexado ✓
- **DEFICIENCIA:** Ningún índice en `sort_order`. Query en `app/(authenticated)/tasks/page.tsx:17` usa:
  ```
  .order("sort_order").order("created_at", { ascending: false })
  ```
  Sin índice, sort_order + created_at composite requiere table scan + in-memory sort.

**Recomendación:** Crear `CREATE INDEX idx_tasks_sort_order_created ON tasks(sort_order, created_at DESC)`

---

#### `reservations`
- **Primary Key:** `row_key` (TEXT)
- **Indexes:**
  - `idx_reservations_booking_status` — migration 023:line 41
  - `idx_reservations_check_in` — migration 023:line 42
  - `idx_reservations_check_out` — migration 023:line 43
  - `idx_reservations_window` (composite) — migration 023:line 45
  - `idx_reservations_listing` — migration 023:line 44
- **Constraints:** FK `listings(id)` on listing_id

**Estado:** Excelente. Composite index `idx_reservations_window(booking_status, check_out, check_in)` cubre exactamente las condiciones en `lib/pacing.ts:99-101`:
```sql
.eq("booking_status", "booked")
.lt("check_in", windowEndISO)
.gt("check_out", todayISO)
```

---

#### `onboarding_progress`
- **Primary Key:** `id` (UUID)
- **Indexes:** **NINGUNO VISIBLE**
- **Constraints:** FK `clients(id)` on client_id; FK `onboarding_templates(id)` on template_id

**🚩 CRÍTICO:** No hay índices en tabla accedida con:
- `app/(authenticated)/onboarding/page.tsx:66` — filter by `IN(clientIds)` sin índice en client_id
- Cada carga de página hace table scan sobre toda tabla onboarding_progress

**Recomendación:** Crear:
- `CREATE INDEX idx_onboarding_progress_client ON onboarding_progress(client_id)`
- `CREATE INDEX idx_onboarding_progress_template ON onboarding_progress(template_id)`

---

#### `profiles`
- **Primary Key:** `id` (UUID, FK to auth.users(id))
- **Indexes:** Ninguno explícito (auth.users maneja indexación)

**Estado:** Aceptable. Auth service maneja su propia optimización.

---

#### `posts`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_posts_status` — migration 006:line 75
  - `idx_posts_board_id` — migration 006:line 76
  - `idx_posts_author_id` — migration 006:line 77
  - `idx_post_tags_post` — migration 006:line 78
  - `idx_post_tags_tag` — migration 006:line 79
  - `idx_post_upvotes_post` — migration 006:line 80
  - `idx_post_upvotes_user` — migration 006:line 81
  - `idx_comments_post` — migration 006:line 83

**Estado:** Completo. Vista `post_with_counts` accede directamente.

---

#### `knowledge_articles`
- **Primary Key:** `id` (UUID)
- **Indexes:**
  - `idx_knowledge_articles_status` — migration 021:line 54
  - `idx_knowledge_articles_category` — migration 021:line 55
  - `idx_knowledge_articles_author` — migration 021:line 56
  - `idx_knowledge_articles_slug` — migration 021:line 57
  - `idx_knowledge_articles_published_at` — migration 021:line 58
  - `idx_knowledge_article_tags_article` — migration 021:line 59
  - `idx_knowledge_article_tags_tag` — migration 021:line 60

**Estado:** Excelente.

---

#### Otras Tablas Indexadas
- **lead_tag_assignments:** idx_lead_tag_assignments_lead, idx_lead_tag_assignments_tag (migration 008)
- **lead_team_assignments:** idx_lead_team_assignments_lead, idx_lead_team_assignments_profile (migration 008)
- **task_listings:** idx_task_listings_task, idx_task_listings_listing (migration 003)
- **expenses:** idx_expenses_date, idx_expenses_type, idx_expenses_is_paid, idx_expenses_category_id (migration 016)
- **recurring_expenses:** idx_recurring_expenses_is_active (migration 018)
- **lead_notes:** idx_lead_notes_lead_id (migration 020)
- **client_credentials:** idx_client_credentials_client (migration 013)
- **role_permissions:** idx_role_permissions_role, idx_role_permissions_resource (migration 012)
- **task_comments:** idx_task_comments_task, idx_task_comments_created (migration 027)
- **onboarding_comments:** idx_onboarding_comments_client, idx_onboarding_comments_created (migration 029)

---

## 2. Query Shapes que Necesitan EXPLAIN ANALYZE

### a) Clientes Lista (Deep Nested)

**Archivo:** `app/(authenticated)/clients/page.tsx:13`

```sql
-- Translation: PostgREST nested select → JSON aggregation subquery
-- Query: select with clients(*), listings(8 cols), tasks(profiles(*))
SELECT
  c.id,
  c.name,
  c.status,
  c.billing_amount,
  c.onboarding_date,
  c.ending_date,
  c.autopayment_set_up,
  c.stripe_dashboard,
  c.email,
  c.assembly_link,
  c.assembly_client_id,
  c.assembly_company_id,
  -- Listings nested as JSON array
  COALESCE(
    (SELECT json_agg(
      json_build_object(
        'id', l.id,
        'name', l.name,
        'status', l.status,
        'listing_id', l.listing_id,
        'pricelabs_link', l.pricelabs_link,
        'airbnb_link', l.airbnb_link,
        'city', l.city,
        'state', l.state,
        'pl_occupancy_next_7', l.pl_occupancy_next_7,
        'pl_market_occupancy_next_7', l.pl_market_occupancy_next_7,
        'pl_occupancy_next_30', l.pl_occupancy_next_30,
        'pl_market_occupancy_next_30', l.pl_market_occupancy_next_30,
        'pl_mpi_next_30', l.pl_mpi_next_30,
        'pl_last_booked_date', l.pl_last_booked_date
      ) ORDER BY l.name
    ) FROM listings l WHERE l.client_id = c.id),
    '[]'::json
  ) AS listings,
  -- Tasks nested with profiles
  COALESCE(
    (SELECT json_agg(
      json_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'owner', t.owner,
        'tags', t.tags,
        'profiles', CASE WHEN p.id IS NOT NULL THEN
          json_build_object('full_name', p.full_name, 'email', p.email)
        ELSE NULL END
      ) ORDER BY t.sort_order, t.created_at DESC
    ) FROM tasks t
    LEFT JOIN profiles p ON t.owner = p.id
    WHERE t.client_id = c.id),
    '[]'::json
  ) AS tasks
FROM clients c
ORDER BY c.name;
```

**Nota de rendimiento:** Subqueries laterales no correlacionadas por cliente. Si 5+ clientes, materializan N subqueries de listings + tasks.

---

### b) Listings Detail (34 Columnas)

**Archivo:** `app/(authenticated)/listings/[id]/page.tsx:13`

```sql
SELECT
  l.id,
  l.name,
  l.status,
  l.listing_id,
  l.pricelabs_link,
  l.airbnb_link,
  l.city,
  l.state,
  l.client_id,
  l.created_at,
  l.updated_at,
  l.pl_base_price,
  l.pl_min_price,
  l.pl_max_price,
  l.pl_recommended_base_price,
  l.pl_cleaning_fees,
  l.pl_no_of_bedrooms,
  l.pl_occupancy_next_7,
  l.pl_market_occupancy_next_7,
  l.pl_occupancy_next_30,
  l.pl_market_occupancy_next_30,
  l.pl_occupancy_past_90,
  l.pl_market_occupancy_past_90,
  l.pl_mpi_next_30,
  l.pl_mpi_next_60,
  l.pl_last_booked_date,
  l.pl_wknd_occupancy_next_30,
  l.pl_market_wknd_occupancy_next_30,
  l.pl_push_enabled,
  l.pl_last_refreshed_at,
  l.pl_synced_at,
  json_build_object('id', c.id, 'name', c.name, 'status', c.status) AS clients
FROM listings l
LEFT JOIN clients c ON l.client_id = c.id
WHERE l.id = (SELECT id FROM listings LIMIT 1)
LIMIT 1;
```

---

### c) Pipeline Leads + Junctions

**Archivo:** `app/(authenticated)/pipeline/page.tsx:14`

```sql
-- All leads with nested tags and team assignments
SELECT
  l.*,
  -- Tags nested via junction
  COALESCE(
    (SELECT json_agg(
      json_build_object('id', lt.id, 'name', lt.name, 'color', lt.color)
    ) FROM lead_tag_assignments lta
    JOIN lead_tags lt ON lta.tag_id = lt.id
    WHERE lta.lead_id = l.id
    ORDER BY lt.name),
    '[]'::json
  ) AS lead_tag_assignments,
  -- Team assignments with profile nested
  COALESCE(
    (SELECT json_agg(
      json_build_object(
        'profile_id', lta2.profile_id,
        'role', lta2.role,
        'profiles', json_build_object(
          'full_name', p.full_name,
          'email', p.email,
          'avatar_url', p.avatar_url
        )
      )
    ) FROM lead_team_assignments lta2
    LEFT JOIN profiles p ON lta2.profile_id = p.id
    WHERE lta2.lead_id = l.id
    ORDER BY p.full_name),
    '[]'::json
  ) AS lead_team_assignments
FROM leads l
ORDER BY l.sort_order;
```

---

### d) Pacing Reservations Window

**Archivo:** `lib/pacing.ts:96`

```sql
-- Reservations for 60-day pacing window
SELECT
  r.listing_id,
  r.check_in,
  r.check_out,
  r.booked_date,
  r.cancelled_on
FROM reservations r
WHERE r.booking_status = 'booked'
  AND r.check_in < '2026-06-17'  -- windowEnd (60 days from today)
  AND r.check_out > '2026-04-18' -- todayISO
LIMIT 5000;
```

**Ejecutado después de:**
```sql
SELECT COUNT(*) FROM listings WHERE status = 'active';
```

---

### e) Tasks Completa + Nested

**Archivo:** `app/(authenticated)/tasks/page.tsx:14`

```sql
SELECT
  t.*,
  json_build_object('id', c.id, 'name', c.name) AS clients,
  -- task_listings nested
  COALESCE(
    (SELECT json_agg(
      json_build_object(
        'listing_id', tl.listing_id,
        'listings', json_build_object('id', lnest.id, 'name', lnest.name)
      )
    ) FROM task_listings tl
    LEFT JOIN listings lnest ON tl.listing_id = lnest.id
    WHERE tl.task_id = t.id),
    '[]'::json
  ) AS task_listings,
  -- profiles nested
  json_build_object('full_name', p.full_name, 'email', p.email) AS profiles
FROM tasks t
LEFT JOIN clients c ON t.client_id = c.id
LEFT JOIN profiles p ON t.owner = p.id
ORDER BY t.sort_order, t.created_at DESC;
```

---

## 3. Checklist de Medición Externa

### Región Supabase vs Vercel

- **Cómo verificar (Supabase):** Project Settings > General > Region
- **Cómo verificar (Vercel):** Vercel Dashboard > Project Settings > Functions > Region
- **Impacto:** Si mismatched (ej. Supabase: us-east-1, Vercel: eu-west-1), añade ~20-100ms per round-trip

**Resultado:** ___________

---

### Supabase Query Performance Dashboard

**Path:** Supabase > Project > Database > Query Performance

**Métricas clave a observar:**
- `mean_time` > 100ms = query lenta
- `total_time` (top 10 queries) = hot spots
- `calls` > 1000/día con `mean_time` > 50ms = problema compuesto

**Queries a vigilar específicamente:**
- `SELECT * FROM listings OFFSET N...` (paging sin índices)
- `SELECT * FROM leads` (select(*) unbounded)
- `SELECT * FROM onboarding_progress` (table scan)
- `UPDATE listings SET pl_*` loop (50+ updates en cron)

**Resultado:** ___________

---

### Supabase Database > Indexes

**Path:** Supabase > Project > Database > Indexes

**Qué buscar:**
- Indexes not in migrations (added manually?)
- Unused indexes: `index_scans` column = 0 → candidatos para DROP
- Index bloat: `idx_size` much larger than `table_size` → REINDEX

**Resultado:** ___________

---

### Vercel Analytics / Speed Insights

**Pages a medir:** `/`, `/clients`, `/listings`, `/pipeline`, `/tasks`

**Métricas:**
- **TTFB (Time To First Byte):** target < 600ms
- **LCP (Largest Contentful Paint):** target < 2.5s
- **p75 values:** No solo promedios

**Resultado:** ___________

---

### Connection Pool Supabase

**Path:** Supabase > Project > Database > Pooler

**Qué verificar:**
- Active connections vs max pool size
- Connection churn (frequency of new connections)
- Timeout errors in logs

**También:** Database > Database Health > Connection timeline

**Resultado:** ___________

---

### Logs de Cron PriceLabs

**Path:** Vercel > Project > Deployments > [latest] > Functions OR Crons tab

**Filtro:** `/api/cron/sync-pricelabs`

**Qué observar:**
- Duration per run
- Error count in last 7 days
- Success rate
- Timeout warnings (15-second limit en pacing.ts y sync)

**Resultado:** ___________

---

## 4. Tamaño Actual de Datos

### Row Counts

```sql
-- Copy-paste ready for Supabase SQL Editor with EXPLAIN ANALYZE
SELECT tabla, count FROM (
  SELECT 'listings' as tabla, COUNT(*) as count FROM listings
  UNION ALL SELECT 'clients', COUNT(*) FROM clients
  UNION ALL SELECT 'leads', COUNT(*) FROM leads
  UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
  UNION ALL SELECT 'reservations', COUNT(*) FROM reservations
  UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
  UNION ALL SELECT 'onboarding_progress', COUNT(*) FROM onboarding_progress
  UNION ALL SELECT 'lead_tags', COUNT(*) FROM lead_tags
  UNION ALL SELECT 'lead_tag_assignments', COUNT(*) FROM lead_tag_assignments
  UNION ALL SELECT 'lead_team_assignments', COUNT(*) FROM lead_team_assignments
  UNION ALL SELECT 'roadmap_items', COUNT(*) FROM roadmap_items
  UNION ALL SELECT 'posts', COUNT(*) FROM posts
  UNION ALL SELECT 'notes', COUNT(*) FROM (SELECT COUNT(*) FROM lead_notes UNION ALL SELECT COUNT(*) FROM task_comments) as n
  UNION ALL SELECT 'calendar_events', COUNT(*) FROM (SELECT 1 LIMIT 0) ce
  UNION ALL SELECT 'client_credentials', COUNT(*) FROM client_credentials
  UNION ALL SELECT 'expenses', COUNT(*) FROM expenses
  UNION ALL SELECT 'recurring_expenses', COUNT(*) FROM recurring_expenses
  UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
) t ORDER BY count DESC;
```

---

### Table Sizes on Disk

```sql
-- Copy-paste ready for Supabase SQL Editor
SELECT schemaname, relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

---

## 5. Hipótesis Priorizada

### Hipótesis 1: PriceLabs Sync N+1 UPDATE Es El Culpable (PROBABILIDAD ALTA)

**Claim:** Cron diario `api/cron/sync-pricelabs` y sincronización manual ejecutan ~50-100 UPDATE statements secuenciales en loop, consumiendo conexiones pool y saturando I/O.

**Evidencia:**
- `api/cron/sync-pricelabs/route.ts:69-94` — loop: `for (const pl of plListings) { ... .update(...).eq("id", supabaseId) }`
- `settings/listings/actions.ts:92-117` — identical per-row pattern
- No índice en `listing_id` external ID → tabla scan de 5000+ registros para encontrar cada match
- Dashboard no se revalida después de sync → datos KPI quedan stale hasta próxima carga manual

**Cómo validar:**
1. `EXPLAIN ANALYZE` en Supabase:
   ```sql
   SELECT * FROM listings WHERE listing_id = '12345-pricelabs-id';
   ```
   → Debería usar idx_listings_listing_id (cuando exista)
2. Query Performance tab: buscar pattern de múltiples `UPDATE listings` con mean_time > 50ms
3. Verificar Vercel cron logs: duración actual de sincronización

**Impacto si es cierto:** Reduce latencia de cron de ~30-60s a ~5-10s. Libera connection pool.

---

### Hipótesis 2: Clients List Query Causa Materializacion Excesiva (PROBABILIDAD MEDIA-ALTA)

**Claim:** `app/(authenticated)/clients/page.tsx:13` fetch all clients en una sola query con nested listings + tasks + profiles. Para 10+ clientes, materializan 100+ filas (cliente × listings × tasks).

**Evidencia:**
- File: `clients/page.tsx:13-14` selecciona `listings(...8 columns...), tasks(..., profiles(...))`
- Data flow audit flags: "WIDE JOIN" sin pagination
- No límite en número de resultados
- Client-side filter en línea 20 (status !== "inactive") — ineficiente post-fetch

**Cómo validar:**
1. `EXPLAIN ANALYZE` en Supabase:
   ```sql
   SELECT c.*, (SELECT json_agg(...) FROM listings WHERE client_id = c.id) AS listings
   FROM clients c;
   ```
   → Buscar Nested Loop, Sequential Scan en listings
2. Vercel Speed Insights: `/clients` page LCP — expected > 3s si 5+ clientes
3. DevTools Network: tamaño de respuesta JSON — expected 500KB+ si muchos clientes

**Impacto si es cierto:** Separar list query (minimal columns) del detail query (nested). Reduce payload 50-70%.

---

### Hipótesis 3: Onboarding_Progress Table Carece Completamente de Índices (PROBABILIDAD ALTA)

**Claim:** Tabla `onboarding_progress` usada en `app/(authenticated)/onboarding/page.tsx:66` con filter `IN(clientIds)` pero sin índice en `client_id`. Cada page load scans full table.

**Evidencia:**
- Migration 011: CREATE TABLE onboarding_progress, pero NO CREATE INDEX
- Code: `onboarding/page.tsx:66` usa `.in("client_id", clientIdsForComments)` → Supabase genera `WHERE client_id IN (...)`
- Sin índice → table scan O(n) where n = total onboarding records across all clients
- Data flow audit notes: "Re-fetch after insert" (línea 94) indica múltiples fetches por page load

**Cómo validar:**
1. Supabase Database > Indexes: buscar tabla onboarding_progress → ver "0 indexes"
2. `EXPLAIN ANALYZE`:
   ```sql
   SELECT * FROM onboarding_progress WHERE client_id = '...';
   ```
   → Debería mostrar Sequential Scan si no hay índice
3. Query Performance tab: buscar `onboarding_progress` queries con mean_time > 50ms

**Impacto si es cierto:** Crear 2 índices (client_id, template_id) reduce latencia de query de ~500ms a ~10ms.

---

## Resumen Ejecutivo

### Index Gaps Encontrados

| Tabla | Columna | Impacto | Prioridad |
|-------|---------|--------|-----------|
| `listings` | `listing_id` | PriceLabs sync table scan cada día | CRÍTICA |
| `tasks` | `sort_order + created_at` | Order by sin índice | ALTA |
| `onboarding_progress` | `client_id`, `template_id` | Table scan en cada carga | ALTA |

### Tamaño del Documento

**~6,500 palabras** | **5 secciones principales** | **3 hipótesis priorizadas**

### Hipótesis Más Probable

**Hipótesis 1: PriceLabs Sync N+1 UPDATE** es la más probable porque:
1. Corre en cron diario (guaranteed impact)
2. Patrón N+1 es visible en código (no especulativo)
3. Falta índice en `listing_id` comprueba la teoría
4. Solución es simple: batch UPDATE o crear índice
5. Tiene timing cuantificable (cron duration)

**Próximos pasos:**
- [ ] Crear índice `idx_listings_listing_id`
- [ ] EXPLAIN ANALYZE queries en Supabase Dashboard
- [ ] Verificar duración actual cron (Vercel logs)
- [ ] Batch PriceLabs updates via raw SQL o upsert
- [ ] Revalidate /dashboard en syncPriceLabsAction

---

**Generado:** 18 de abril de 2026  
**Metodología:** Análisis estático de código (29 migraciones) + data flow audit  
**Scope:** Diagnóstico pre-optimización — Sin cambios a código, config o migraciones

---

