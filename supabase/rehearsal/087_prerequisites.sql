-- Disposable-only prerequisites used to execute the real local migration 087
-- followed by migration 088. These are deliberately minimal schema stubs, not
-- a production migration or a substitute for the canonical migration history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT 'admin'::TEXT $$;

CREATE OR REPLACE FUNCTION public.has_permission(TEXT, TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT FALSE $$;

CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE public.onboarding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  external_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step TEXT NOT NULL DEFAULT 'property',
  primary_listing_entitlement INTEGER NOT NULL DEFAULT 1,
  child_listing_entitlement INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  has_pms BOOLEAN,
  pms_name TEXT,
  has_pricelabs BOOLEAN,
  client_note TEXT,
  draft_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  submitted_payload JSONB,
  submitted_at TIMESTAMPTZ,
  last_saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.onboarding_run_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.onboarding_runs(id),
  task_key TEXT NOT NULL,
  client_status TEXT NOT NULL,
  client_submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, task_key)
);

CREATE OR REPLACE FUNCTION public.normalize_client_onboarding_submission(UUID, JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN RETURN; END $$;
