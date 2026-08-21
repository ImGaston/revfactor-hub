-- ==========================================================
-- 078: Saved views for the /reservations browser
--
-- Team-shared named filter sets. `params` is app-validated JSONB
-- (lib/reservation-views.ts sanitizes on write AND on read) holding the
-- page's searchParams shape: client, listing, df, range (a relative preset
-- key like last30 — resolved at open time so views never go stale), from,
-- to, q, sort, dir. Display-only structured context, never queried by key,
-- so JSONB is the right shape per conventions.
--
-- Shared by product decision (2026-08-21): anyone with reservations:view
-- sees and uses every view; only the creator (or super_admin) deletes one.
-- No UPDATE policy on purpose — renaming/redefining is delete + recreate,
-- which keeps the policy surface minimal.
-- ==========================================================

CREATE TABLE public.reservation_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  params JSONB NOT NULL,
  -- SET NULL, not CASCADE: a teammate leaving must not silently delete
  -- shared views the rest of the team relies on.
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shared namespace → case-insensitive unique names, so "texas" and "Texas"
-- can't coexist and confuse the picker.
CREATE UNIQUE INDEX reservation_views_name_key
  ON public.reservation_views (lower(name));

ALTER TABLE public.reservation_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservation_views_select ON public.reservation_views
  FOR SELECT USING (public.has_permission('reservations', 'view'));

CREATE POLICY reservation_views_insert ON public.reservation_views
  FOR INSERT WITH CHECK (
    public.has_permission('reservations', 'view')
    AND created_by = auth.uid()
  );

CREATE POLICY reservation_views_delete ON public.reservation_views
  FOR DELETE USING (
    created_by = auth.uid() OR public.get_my_role() = 'super_admin'
  );

GRANT SELECT, INSERT, DELETE ON public.reservation_views TO authenticated;
