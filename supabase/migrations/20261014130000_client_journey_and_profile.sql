-- Client-level tabs on /clients/[id] (2026-10-14).
--
--   * client_journey_steps  manual overrides for the Customer Journey timeline.
--                           Most steps are computed from Hub data
--                           (lib/client-journey.ts); a row here wins over the
--                           computed status so staff can tick or untick a step.
--                           Deleting the row returns the step to automatic.
--   * client_profiles       one editable profile per client (experience,
--                           goals, preferences, communication style).
--
-- RLS follows the permission model (migration 038): read = clients:view,
-- write = clients:edit. No USING (true). updated_by/updated_at are stamped by a
-- trigger from the session, never trusted from the request.

-- ---------------------------------------------------------------------------
-- 1. Journey step overrides
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_journey_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Keys come from CLIENT_JOURNEY_STEPS in lib/client-journey.ts.
  step_key TEXT NOT NULL CHECK (step_key ~ '^[a-z0-9_]{2,60}$'),
  status TEXT NOT NULL CHECK (status IN ('done', 'next', 'todo', 'blocked')),
  done_at DATE,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_journey_steps_client_step_key UNIQUE (client_id, step_key)
);

-- ---------------------------------------------------------------------------
-- 2. Client profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_profiles (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  experience_level TEXT CHECK (
    experience_level IS NULL OR experience_level IN ('new', 'some', 'experienced')
  ),
  background TEXT CHECK (background IS NULL OR char_length(background) <= 2000),
  goals TEXT CHECK (goals IS NULL OR char_length(goals) <= 2000),
  pricing_preferences TEXT CHECK (pricing_preferences IS NULL OR char_length(pricing_preferences) <= 2000),
  communication TEXT CHECK (communication IS NULL OR char_length(communication) <= 2000),
  timezone TEXT CHECK (timezone IS NULL OR char_length(timezone) <= 100),
  decision_style TEXT CHECK (decision_style IS NULL OR char_length(decision_style) <= 2000),
  guest_mix TEXT CHECK (guest_mix IS NULL OR char_length(guest_mix) <= 2000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Actor stamp (both tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_client_tab_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  -- auth.uid() is NULL for service-role writes; keep whatever they passed.
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_journey_steps_actor ON public.client_journey_steps;
CREATE TRIGGER trg_client_journey_steps_actor
  BEFORE INSERT OR UPDATE ON public.client_journey_steps
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_tab_actor();

DROP TRIGGER IF EXISTS trg_client_profiles_actor ON public.client_profiles;
CREATE TRIGGER trg_client_profiles_actor
  BEFORE INSERT OR UPDATE ON public.client_profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_tab_actor();

-- ---------------------------------------------------------------------------
-- 4. RLS — clients:view reads, clients:edit writes (child-table convention)
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_journey_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client viewers can view journey steps"
  ON public.client_journey_steps FOR SELECT TO authenticated
  USING (public.has_permission('clients', 'view'));
CREATE POLICY "Client editors can create journey steps"
  ON public.client_journey_steps FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('clients', 'edit'));
CREATE POLICY "Client editors can update journey steps"
  ON public.client_journey_steps FOR UPDATE TO authenticated
  USING (public.has_permission('clients', 'edit'))
  WITH CHECK (public.has_permission('clients', 'edit'));
CREATE POLICY "Client editors can reset journey steps"
  ON public.client_journey_steps FOR DELETE TO authenticated
  USING (public.has_permission('clients', 'edit'));

CREATE POLICY "Client viewers can view client profiles"
  ON public.client_profiles FOR SELECT TO authenticated
  USING (public.has_permission('clients', 'view'));
CREATE POLICY "Client editors can create client profiles"
  ON public.client_profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('clients', 'edit'));
CREATE POLICY "Client editors can update client profiles"
  ON public.client_profiles FOR UPDATE TO authenticated
  USING (public.has_permission('clients', 'edit'))
  WITH CHECK (public.has_permission('clients', 'edit'));

REVOKE ALL ON public.client_journey_steps, public.client_profiles FROM anon;
REVOKE ALL ON FUNCTION public.stamp_client_tab_actor() FROM PUBLIC, anon;
