-- Migration 075: RevFactor AI Revenue Manager persistence foundation
--
-- Review-only when authored. Do not apply until the generated schema has been
-- reviewed against REVFACTOR_AI_SPEC.md and the target Supabase project.
--
-- Existing permission actions map to the Revenue Manager authority model:
--   revenue:view    = read
--   revenue:create  = create profiles, reviews, recommendations, and issues
--   revenue:edit    = manage drafts and non-terminal operational records
--   revenue:publish = confirm profiles and approve strategy/recommendations
--   revenue:control = create/verify manual executions and outcome reviews
--
-- V1 remains read-only toward PriceLabs, PMS, and OTAs. This migration creates
-- internal decision records only and exposes no external write function.

-- ==========================================================
-- 1. Permission resource
-- ==========================================================

-- Seed every current role to explicit deny first. Settings > Roles can create
-- FALSE rows before a migration arrives, so every intended value uses UPDATE.
INSERT INTO public.role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'revenue', a.action, FALSE
FROM public.roles r
CROSS JOIN (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')
) AS a(action)
WHERE r.name <> 'super_admin'
ON CONFLICT (role_name, resource, action) DO UPDATE
SET allowed = EXCLUDED.allowed;

-- Internal operators can read and manage drafts. The unresolved pilot decision
-- about the accountable approver remains fail-closed: only super_admin receives
-- publish/control through has_permission()'s existing short circuit.
INSERT INTO public.role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'revenue', 'view', TRUE),
  ('admin', 'revenue', 'create', TRUE),
  ('admin', 'revenue', 'edit', TRUE),
  ('admin', 'revenue', 'delete', FALSE),
  ('admin', 'revenue', 'publish', FALSE),
  ('admin', 'revenue', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE
SET allowed = EXCLUDED.allowed;

-- ==========================================================
-- 2. Property profile and strategy versions
-- ==========================================================

CREATE TABLE public.revenue_property_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_version TEXT NOT NULL DEFAULT 'revenue-profile.v1'
    CHECK (schema_version = 'revenue-profile.v1'),
  lifecycle_mode TEXT NOT NULL CHECK (
    lifecycle_mode IN (
      'launching',
      'live_new_to_revfactor',
      'takeover',
      'existing_managed'
    )
  ),
  profile_json JSONB NOT NULL CHECK (JSONB_TYPEOF(profile_json) = 'object'),
  source_snapshot_ids JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (
    JSONB_TYPEOF(source_snapshot_ids) = 'array'
  ),
  data_confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (data_confidence IN ('high', 'medium', 'low', 'unknown')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'needs_confirmation', 'current', 'superseded')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, version),
  CHECK (
    (status = 'current' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    OR status <> 'current'
  )
);

CREATE UNIQUE INDEX idx_revenue_profiles_one_current
  ON public.revenue_property_profiles (listing_id)
  WHERE status = 'current';
CREATE INDEX idx_revenue_profiles_client
  ON public.revenue_property_profiles (client_id, status, version DESC);
CREATE INDEX idx_revenue_profiles_listing
  ON public.revenue_property_profiles (listing_id, version DESC);
CREATE INDEX idx_revenue_profiles_needs_confirmation
  ON public.revenue_property_profiles (updated_at DESC)
  WHERE status = 'needs_confirmation';

CREATE TABLE public.revenue_strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL
    REFERENCES public.revenue_property_profiles(id) ON DELETE RESTRICT,
  prior_version_id UUID
    REFERENCES public.revenue_strategy_versions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  objective_json JSONB NOT NULL CHECK (JSONB_TYPEOF(objective_json) = 'object'),
  constraints_json JSONB NOT NULL CHECK (JSONB_TYPEOF(constraints_json) = 'object'),
  pricing_policy_json JSONB NOT NULL CHECK (JSONB_TYPEOF(pricing_policy_json) = 'object'),
  distribution_policy_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(distribution_policy_json) = 'object'
  ),
  measurement_plan_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(measurement_plan_json) = 'object'
  ),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'superseded')),
  effective_from TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  change_reason TEXT CHECK (
    change_reason IS NULL OR CHAR_LENGTH(change_reason) <= 2000
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, version),
  CHECK (prior_version_id IS NULL OR prior_version_id <> id),
  CHECK (
    (
      status = 'approved'
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND effective_from IS NOT NULL
    )
    OR status <> 'approved'
  )
);

CREATE UNIQUE INDEX idx_revenue_strategies_one_approved
  ON public.revenue_strategy_versions (listing_id)
  WHERE status = 'approved';
CREATE INDEX idx_revenue_strategies_listing
  ON public.revenue_strategy_versions (listing_id, version DESC);
CREATE INDEX idx_revenue_strategies_profile
  ON public.revenue_strategy_versions (profile_id);
CREATE INDEX idx_revenue_strategies_pending
  ON public.revenue_strategy_versions (updated_at DESC)
  WHERE status = 'pending_approval';

-- ==========================================================
-- 3. Review, recommendation, and frozen evidence
-- ==========================================================

CREATE TABLE public.revenue_review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL
    REFERENCES public.revenue_property_profiles(id) ON DELETE RESTRICT,
  strategy_version_id UUID NOT NULL
    REFERENCES public.revenue_strategy_versions(id) ON DELETE RESTRICT,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN (
      'property_added',
      'user_requested',
      'scheduled',
      'source_changed',
      'outcome_due',
      'data_issue_resolved'
    )
  ),
  trigger_reference TEXT,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  frozen_source_manifest JSONB NOT NULL CHECK (
    JSONB_TYPEOF(frozen_source_manifest) = 'object'
  ),
  diagnostic_results_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    JSONB_TYPEOF(diagnostic_results_json) = 'object'
  ),
  primary_state TEXT CHECK (
    primary_state IN (
      'no_action',
      'data_blocked',
      'recommendation_pending',
      'deferred',
      'declined',
      'approved_for_execution',
      'verification_failed',
      'outcome_pending',
      'completed'
    )
  ),
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (window_start <= window_end),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (next_review_at IS NULL OR next_review_at >= started_at),
  CHECK (
    (primary_state IS NOT NULL AND completed_at IS NOT NULL)
    OR (primary_state IS NULL AND completed_at IS NULL)
  )
);

CREATE INDEX idx_revenue_reviews_listing_recent
  ON public.revenue_review_runs (listing_id, started_at DESC);
CREATE INDEX idx_revenue_reviews_state
  ON public.revenue_review_runs (primary_state, completed_at DESC);
CREATE INDEX idx_revenue_reviews_next_due
  ON public.revenue_review_runs (next_review_at)
  WHERE next_review_at IS NOT NULL;
CREATE INDEX idx_revenue_reviews_agent_run
  ON public.revenue_review_runs (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

CREATE TABLE public.revenue_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_run_id UUID NOT NULL
    REFERENCES public.revenue_review_runs(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_version TEXT NOT NULL DEFAULT 'revenue-recommendation.v1'
    CHECK (schema_version = 'revenue-recommendation.v1'),
  title TEXT NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 3 AND 200),
  verdict TEXT NOT NULL CHECK (CHAR_LENGTH(verdict) BETWEEN 3 AND 1000),
  problem_json JSONB NOT NULL CHECK (JSONB_TYPEOF(problem_json) = 'object'),
  inference_json JSONB NOT NULL CHECK (JSONB_TYPEOF(inference_json) = 'object'),
  action_json JSONB NOT NULL CHECK (JSONB_TYPEOF(action_json) = 'object'),
  expected_effect_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(expected_effect_json) = 'object'
  ),
  risk_json JSONB NOT NULL CHECK (JSONB_TYPEOF(risk_json) = 'object'),
  guardrails_json JSONB NOT NULL CHECK (JSONB_TYPEOF(guardrails_json) = 'object'),
  confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  affected_start_date DATE NOT NULL,
  affected_end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'pending_approval',
      'changes_requested',
      'deferred',
      'declined',
      'approved',
      'superseded',
      'expired'
    )
  ),
  decision_due_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  required_permission TEXT NOT NULL DEFAULT 'revenue:publish'
    CHECK (required_permission = 'revenue:publish'),
  supersedes_id UUID
    REFERENCES public.revenue_recommendations(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (review_run_id, version),
  CHECK (affected_start_date <= affected_end_date),
  CHECK (expires_at IS NULL OR decision_due_at IS NULL OR expires_at >= decision_due_at),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE UNIQUE INDEX idx_revenue_recommendations_one_pending
  ON public.revenue_recommendations (listing_id)
  WHERE status = 'pending_approval';
CREATE INDEX idx_revenue_recommendations_listing_status
  ON public.revenue_recommendations (listing_id, status, created_at DESC);
CREATE INDEX idx_revenue_recommendations_review
  ON public.revenue_recommendations (review_run_id, version DESC);
CREATE INDEX idx_revenue_recommendations_affected_dates
  ON public.revenue_recommendations (
    listing_id,
    affected_start_date,
    affected_end_date
  );
CREATE INDEX idx_revenue_recommendations_decision_due
  ON public.revenue_recommendations (decision_due_at)
  WHERE status = 'pending_approval' AND decision_due_at IS NOT NULL;

CREATE TABLE public.revenue_recommendation_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL
    REFERENCES public.revenue_recommendations(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN (
      'property',
      'reservation',
      'inventory',
      'pricing',
      'market',
      'cost',
      'constraint',
      'strategy',
      'adjustment',
      'decision'
    )
  ),
  metric_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  definition_version TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  stay_start DATE NOT NULL,
  stay_end DATE NOT NULL,
  comparison_type TEXT NOT NULL DEFAULT 'none' CHECK (
    comparison_type IN (
      'none',
      'prior_snapshot',
      'prior_year',
      'same_time_last_year',
      'market',
      'comp_set',
      'target',
      'strategy'
    )
  ),
  benchmark_json JSONB,
  freshness_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (freshness_state IN ('current', 'stale', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (
    recommendation_id,
    source_type,
    source_reference,
    metric_key,
    stay_start,
    stay_end,
    comparison_type
  ),
  CHECK (stay_start <= stay_end),
  CHECK (benchmark_json IS NULL OR JSONB_TYPEOF(benchmark_json) = 'object')
);

CREATE INDEX idx_revenue_evidence_recommendation
  ON public.revenue_recommendation_evidence (
    recommendation_id,
    evidence_type,
    metric_key
  );
CREATE INDEX idx_revenue_evidence_source
  ON public.revenue_recommendation_evidence (
    source_type,
    source_reference,
    observed_at DESC
  );

-- ==========================================================
-- 4. Decisions, execution verification, and outcomes
-- ==========================================================

CREATE TABLE public.revenue_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL
    REFERENCES public.revenue_recommendations(id) ON DELETE RESTRICT,
  recommendation_version INTEGER NOT NULL CHECK (recommendation_version > 0),
  decision TEXT NOT NULL CHECK (
    decision IN ('approved', 'declined', 'deferred', 'changes_requested')
  ),
  reason_code TEXT NOT NULL CHECK (BTRIM(reason_code) <> ''),
  reason_note TEXT CHECK (reason_note IS NULL OR CHAR_LENGTH(reason_note) <= 5000),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_at TIMESTAMPTZ,
  review_trigger_json JSONB CHECK (
    review_trigger_json IS NULL OR JSONB_TYPEOF(review_trigger_json) = 'object'
  ),
  implementation_note TEXT CHECK (
    implementation_note IS NULL OR CHAR_LENGTH(implementation_note) <= 5000
  ),
  CHECK (
    decision <> 'deferred'
    OR review_at IS NOT NULL
    OR review_trigger_json IS NOT NULL
  )
);

CREATE INDEX idx_revenue_decisions_recommendation
  ON public.revenue_decisions (recommendation_id, decided_at DESC);
CREATE INDEX idx_revenue_decisions_actor
  ON public.revenue_decisions (actor_id, decided_at DESC);

CREATE TABLE public.revenue_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL UNIQUE
    REFERENCES public.revenue_recommendations(id) ON DELETE RESTRICT,
  adjustment_id UUID NOT NULL UNIQUE
    REFERENCES public.adjustments(id) ON DELETE RESTRICT,
  execution_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (execution_mode = 'manual'),
  intended_state_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(intended_state_json) = 'object'
  ),
  before_state_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(before_state_json) = 'object'
  ),
  observed_state_json JSONB CHECK (
    observed_state_json IS NULL OR JSONB_TYPEOF(observed_state_json) = 'object'
  ),
  executed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  executed_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed')),
  exception_note TEXT CHECK (
    exception_note IS NULL OR CHAR_LENGTH(exception_note) <= 5000
  ),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (BTRIM(idempotency_key) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (executed_at IS NULL AND executed_by IS NULL)
    OR (executed_at IS NOT NULL AND executed_by IS NOT NULL)
  ),
  CHECK (
    verification_status = 'pending'
    OR (
      observed_state_json IS NOT NULL
      AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL
    )
  ),
  CHECK (verification_status <> 'failed' OR exception_note IS NOT NULL)
);

CREATE INDEX idx_revenue_executions_verification
  ON public.revenue_executions (verification_status, updated_at DESC);
CREATE INDEX idx_revenue_executions_executed_at
  ON public.revenue_executions (executed_at DESC)
  WHERE executed_at IS NOT NULL;

CREATE TABLE public.revenue_outcome_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL UNIQUE
    REFERENCES public.revenue_recommendations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL UNIQUE
    REFERENCES public.revenue_executions(id) ON DELETE RESTRICT,
  measurement_start DATE NOT NULL,
  measurement_end DATE NOT NULL,
  expected_effect_json JSONB NOT NULL CHECK (
    JSONB_TYPEOF(expected_effect_json) = 'object'
  ),
  actual_effect_json JSONB CHECK (
    actual_effect_json IS NULL OR JSONB_TYPEOF(actual_effect_json) = 'object'
  ),
  comparison_method TEXT NOT NULL,
  confounders_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (
    JSONB_TYPEOF(confounders_json) = 'array'
  ),
  result TEXT CHECK (result IN ('positive', 'neutral', 'negative', 'inconclusive')),
  lesson_json JSONB CHECK (
    lesson_json IS NULL OR JSONB_TYPEOF(lesson_json) = 'object'
  ),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (measurement_start <= measurement_end),
  CHECK (
    result IS NULL
    OR (
      actual_effect_json IS NOT NULL
      AND lesson_json IS NOT NULL
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  ),
  CHECK (
    result IS NOT NULL OR (reviewed_by IS NULL AND reviewed_at IS NULL)
  )
);

CREATE INDEX idx_revenue_outcomes_measurement_due
  ON public.revenue_outcome_reviews (measurement_end)
  WHERE result IS NULL;
CREATE INDEX idx_revenue_outcomes_result
  ON public.revenue_outcome_reviews (result, reviewed_at DESC)
  WHERE result IS NOT NULL;

-- ==========================================================
-- 5. Data-quality issue registry
-- ==========================================================

CREATE TABLE public.revenue_data_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  review_run_id UUID
    REFERENCES public.revenue_review_runs(id) ON DELETE RESTRICT,
  issue_key TEXT NOT NULL CHECK (BTRIM(issue_key) <> ''),
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocking')),
  title TEXT NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 3 AND 300),
  details_json JSONB NOT NULL CHECK (JSONB_TYPEOF(details_json) = 'object'),
  source_references TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'superseded')),
  blocks_profile BOOLEAN NOT NULL DEFAULT FALSE,
  blocks_recommendation BOOLEAN NOT NULL DEFAULT FALSE,
  blocks_execution BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note TEXT CHECK (
    resolution_note IS NULL OR CHAR_LENGTH(resolution_note) <= 5000
  ),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, issue_key),
  CHECK (
    status <> 'resolved'
    OR (resolution_note IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX idx_revenue_issues_listing_status
  ON public.revenue_data_issues (listing_id, status, severity, created_at DESC);
CREATE INDEX idx_revenue_issues_review
  ON public.revenue_data_issues (review_run_id)
  WHERE review_run_id IS NOT NULL;
CREATE INDEX idx_revenue_issues_blocking
  ON public.revenue_data_issues (listing_id, updated_at DESC)
  WHERE status IN ('open', 'acknowledged')
    AND (blocks_profile OR blocks_recommendation OR blocks_execution);
CREATE INDEX idx_revenue_issues_owner
  ON public.revenue_data_issues (owner_id, status, updated_at DESC)
  WHERE owner_id IS NOT NULL AND status IN ('open', 'acknowledged');

-- ==========================================================
-- 6. Governance and integrity triggers
-- ==========================================================

CREATE OR REPLACE FUNCTION public.enforce_revenue_profile_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing_client_id UUID;
BEGIN
  SELECT client_id INTO listing_client_id
  FROM public.listings
  WHERE id = NEW.listing_id;

  IF listing_client_id IS NULL OR listing_client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'Revenue profile client_id must match the listing client';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'superseded' THEN
      RAISE EXCEPTION 'Superseded revenue profiles are immutable';
    END IF;

    IF OLD.status = 'current' THEN
      IF NEW.status = 'superseded'
         AND auth.uid() IS NOT NULL
         AND NOT public.has_permission('revenue', 'publish') THEN
        RAISE EXCEPTION 'revenue:publish is required to supersede a current profile';
      END IF;
      IF NEW.status <> 'superseded'
         OR NEW.client_id IS DISTINCT FROM OLD.client_id
         OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
         OR NEW.lifecycle_mode IS DISTINCT FROM OLD.lifecycle_mode
         OR NEW.profile_json IS DISTINCT FROM OLD.profile_json
         OR NEW.source_snapshot_ids IS DISTINCT FROM OLD.source_snapshot_ids
         OR NEW.data_confidence IS DISTINCT FROM OLD.data_confidence
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
         OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        RAISE EXCEPTION 'Current revenue profiles may only move to superseded';
      END IF;
    ELSIF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('draft', 'needs_confirmation', 'current'))
      OR (
        OLD.status = 'needs_confirmation'
        AND NEW.status IN ('draft', 'needs_confirmation', 'current')
      )
    ) THEN
      RAISE EXCEPTION 'Invalid revenue profile transition: % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'current' AND (TG_OP = 'INSERT' OR OLD.status <> 'current') THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.has_permission('revenue', 'publish') THEN
      RAISE EXCEPTION 'revenue:publish is required to confirm a profile';
    END IF;
    NEW.confirmed_by := COALESCE(auth.uid(), NEW.confirmed_by);
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_profile_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_profile_governance
  BEFORE INSERT OR UPDATE ON public.revenue_property_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_profile_governance();
CREATE TRIGGER trg_revenue_profiles_updated_at
  BEFORE UPDATE ON public.revenue_property_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_strategy_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_record public.revenue_property_profiles%ROWTYPE;
  prior_record public.revenue_strategy_versions%ROWTYPE;
BEGIN
  SELECT * INTO profile_record
  FROM public.revenue_property_profiles
  WHERE id = NEW.profile_id;

  IF NOT FOUND OR profile_record.listing_id <> NEW.listing_id THEN
    RAISE EXCEPTION 'Revenue strategy profile must belong to the same listing';
  END IF;

  IF NEW.prior_version_id IS NOT NULL THEN
    SELECT * INTO prior_record
    FROM public.revenue_strategy_versions
    WHERE id = NEW.prior_version_id;
    IF NOT FOUND
       OR prior_record.listing_id <> NEW.listing_id
       OR prior_record.version >= NEW.version
       OR prior_record.status NOT IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'Prior strategy must be an earlier version for the same listing';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'superseded' THEN
      RAISE EXCEPTION 'Superseded revenue strategies are immutable';
    END IF;

    IF OLD.status = 'approved' THEN
      IF NEW.status = 'superseded'
         AND auth.uid() IS NOT NULL
         AND NOT public.has_permission('revenue', 'publish') THEN
        RAISE EXCEPTION 'revenue:publish is required to supersede an approved strategy';
      END IF;
      IF NEW.status <> 'superseded'
         OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
         OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
         OR NEW.prior_version_id IS DISTINCT FROM OLD.prior_version_id
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.objective_json IS DISTINCT FROM OLD.objective_json
         OR NEW.constraints_json IS DISTINCT FROM OLD.constraints_json
         OR NEW.pricing_policy_json IS DISTINCT FROM OLD.pricing_policy_json
         OR NEW.distribution_policy_json IS DISTINCT FROM OLD.distribution_policy_json
         OR NEW.measurement_plan_json IS DISTINCT FROM OLD.measurement_plan_json
         OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Approved revenue strategies may only move to superseded';
      END IF;
    ELSIF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('draft', 'pending_approval'))
      OR (
        OLD.status = 'pending_approval'
        AND NEW.status IN ('draft', 'pending_approval', 'approved')
      )
    ) THEN
      RAISE EXCEPTION 'Invalid revenue strategy transition: % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN
    IF profile_record.status <> 'current' THEN
      RAISE EXCEPTION 'Only a current revenue profile can support an approved strategy';
    END IF;
    IF auth.uid() IS NOT NULL
       AND NOT public.has_permission('revenue', 'publish') THEN
      RAISE EXCEPTION 'revenue:publish is required to approve a strategy';
    END IF;
    NEW.approved_by := COALESCE(auth.uid(), NEW.approved_by);
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
    NEW.effective_from := COALESCE(NEW.effective_from, NOW());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_strategy_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_strategy_governance
  BEFORE INSERT OR UPDATE ON public.revenue_strategy_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_strategy_governance();
CREATE TRIGGER trg_revenue_strategies_updated_at
  BEFORE UPDATE ON public.revenue_strategy_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_review_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_record public.revenue_property_profiles%ROWTYPE;
  strategy_record public.revenue_strategy_versions%ROWTYPE;
  matching_record BOOLEAN;
BEGIN
  SELECT * INTO profile_record
  FROM public.revenue_property_profiles
  WHERE id = NEW.profile_id;
  SELECT * INTO strategy_record
  FROM public.revenue_strategy_versions
  WHERE id = NEW.strategy_version_id;

  IF profile_record.id IS NULL
     OR strategy_record.id IS NULL
     OR profile_record.listing_id <> NEW.listing_id
     OR strategy_record.listing_id <> NEW.listing_id
     OR strategy_record.profile_id <> NEW.profile_id THEN
    RAISE EXCEPTION 'Revenue review profile and strategy must match the listing';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF profile_record.status <> 'current' OR strategy_record.status <> 'approved' THEN
      RAISE EXCEPTION 'Revenue reviews require a current profile and approved strategy';
    END IF;
  ELSIF OLD.completed_at IS NOT NULL THEN
    IF NEW.listing_id IS DISTINCT FROM OLD.listing_id
       OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
       OR NEW.strategy_version_id IS DISTINCT FROM OLD.strategy_version_id
       OR NEW.trigger_type IS DISTINCT FROM OLD.trigger_type
       OR NEW.trigger_reference IS DISTINCT FROM OLD.trigger_reference
       OR NEW.window_start IS DISTINCT FROM OLD.window_start
       OR NEW.window_end IS DISTINCT FROM OLD.window_end
       OR NEW.as_of IS DISTINCT FROM OLD.as_of
       OR NEW.frozen_source_manifest IS DISTINCT FROM OLD.frozen_source_manifest
       OR NEW.diagnostic_results_json IS DISTINCT FROM OLD.diagnostic_results_json
       OR NEW.agent_run_id IS DISTINCT FROM OLD.agent_run_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'Completed revenue review evidence is immutable';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.primary_state IS DISTINCT FROM OLD.primary_state THEN
    IF NOT (
      OLD.primary_state IS NULL
      OR (
        OLD.primary_state = 'recommendation_pending'
        AND NEW.primary_state IN (
          'deferred', 'declined', 'approved_for_execution'
        )
      )
      OR (
        OLD.primary_state = 'deferred'
        AND NEW.primary_state IN (
          'recommendation_pending', 'declined', 'approved_for_execution'
        )
      )
      OR (
        OLD.primary_state = 'approved_for_execution'
        AND NEW.primary_state IN ('verification_failed', 'outcome_pending')
      )
      OR (
        OLD.primary_state = 'verification_failed'
        AND NEW.primary_state IN ('approved_for_execution', 'outcome_pending')
      )
      OR (
        OLD.primary_state = 'outcome_pending'
        AND NEW.primary_state = 'completed'
      )
    ) THEN
      RAISE EXCEPTION 'Invalid revenue review transition: % to %',
        OLD.primary_state, NEW.primary_state;
    END IF;

    IF NEW.primary_state = 'recommendation_pending' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.revenue_recommendations recommendation
        WHERE recommendation.review_run_id = NEW.id
          AND recommendation.status = 'pending_approval'
      ) INTO matching_record;
      IF NOT matching_record THEN
        RAISE EXCEPTION 'Recommendation-pending review requires a pending recommendation';
      END IF;
    ELSIF NEW.primary_state = 'data_blocked' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.revenue_data_issues issue
        WHERE issue.review_run_id = NEW.id
          AND issue.status IN ('open', 'acknowledged')
          AND (
            issue.blocks_profile
            OR issue.blocks_recommendation
            OR issue.blocks_execution
          )
      ) INTO matching_record;
      IF NOT matching_record THEN
        RAISE EXCEPTION 'Data-blocked review requires an open blocking data issue';
      END IF;
    ELSIF NEW.primary_state IN ('deferred', 'declined', 'approved_for_execution') THEN
      IF auth.uid() IS NOT NULL
         AND NOT public.has_permission('revenue', 'publish') THEN
        RAISE EXCEPTION 'revenue:publish is required for the review decision state';
      END IF;
      SELECT EXISTS (
        SELECT 1
        FROM public.revenue_recommendations recommendation
        WHERE recommendation.review_run_id = NEW.id
          AND recommendation.status = CASE NEW.primary_state
            WHEN 'approved_for_execution' THEN 'approved'
            ELSE NEW.primary_state
          END
      ) INTO matching_record;
      IF NOT matching_record THEN
        RAISE EXCEPTION 'Review decision state requires a matching recommendation state';
      END IF;
    ELSIF NEW.primary_state IN (
      'verification_failed', 'outcome_pending', 'completed'
    ) THEN
      IF auth.uid() IS NOT NULL
         AND NOT public.has_permission('revenue', 'control') THEN
        RAISE EXCEPTION 'revenue:control is required for execution/outcome review states';
      END IF;

      IF NEW.primary_state = 'verification_failed' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.revenue_executions execution
          JOIN public.revenue_recommendations recommendation
            ON recommendation.id = execution.recommendation_id
          WHERE recommendation.review_run_id = NEW.id
            AND execution.verification_status = 'failed'
        ) INTO matching_record;
      ELSIF NEW.primary_state = 'outcome_pending' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.revenue_executions execution
          JOIN public.revenue_recommendations recommendation
            ON recommendation.id = execution.recommendation_id
          WHERE recommendation.review_run_id = NEW.id
            AND execution.verification_status = 'verified'
        ) INTO matching_record;
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public.revenue_outcome_reviews outcome
          JOIN public.revenue_recommendations recommendation
            ON recommendation.id = outcome.recommendation_id
          WHERE recommendation.review_run_id = NEW.id
            AND outcome.result IS NOT NULL
        ) INTO matching_record;
      END IF;

      IF NOT matching_record THEN
        RAISE EXCEPTION 'Review state requires matching execution or outcome evidence';
      END IF;
    END IF;
  END IF;

  IF NEW.primary_state IS NOT NULL AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_review_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_review_governance
  BEFORE INSERT OR UPDATE ON public.revenue_review_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_review_governance();
CREATE TRIGGER trg_revenue_reviews_updated_at
  BEFORE UPDATE ON public.revenue_review_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_recommendation_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  review_listing_id UUID;
  matching_decision BOOLEAN;
  superseded_record public.revenue_recommendations%ROWTYPE;
BEGIN
  SELECT listing_id INTO review_listing_id
  FROM public.revenue_review_runs
  WHERE id = NEW.review_run_id;

  IF review_listing_id IS NULL OR review_listing_id <> NEW.listing_id THEN
    RAISE EXCEPTION 'Revenue recommendation must match its review listing';
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO superseded_record
    FROM public.revenue_recommendations
    WHERE id = NEW.supersedes_id;
    IF NOT FOUND
       OR superseded_record.listing_id <> NEW.listing_id
       OR superseded_record.version >= NEW.version THEN
      RAISE EXCEPTION 'Superseded recommendation must be an earlier version for the same listing';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' AND (
      NEW.review_run_id IS DISTINCT FROM OLD.review_run_id
      OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.verdict IS DISTINCT FROM OLD.verdict
      OR NEW.problem_json IS DISTINCT FROM OLD.problem_json
      OR NEW.inference_json IS DISTINCT FROM OLD.inference_json
      OR NEW.action_json IS DISTINCT FROM OLD.action_json
      OR NEW.expected_effect_json IS DISTINCT FROM OLD.expected_effect_json
      OR NEW.risk_json IS DISTINCT FROM OLD.risk_json
      OR NEW.guardrails_json IS DISTINCT FROM OLD.guardrails_json
      OR NEW.confidence IS DISTINCT FROM OLD.confidence
      OR NEW.affected_start_date IS DISTINCT FROM OLD.affected_start_date
      OR NEW.affected_end_date IS DISTINCT FROM OLD.affected_end_date
      OR NEW.decision_due_at IS DISTINCT FROM OLD.decision_due_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.required_permission IS DISTINCT FROM OLD.required_permission
      OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
      RAISE EXCEPTION 'Submitted revenue recommendation content is immutable';
    END IF;

    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('draft', 'pending_approval', 'superseded'))
      OR (
        OLD.status = 'pending_approval'
        AND NEW.status IN (
          'pending_approval',
          'changes_requested',
          'deferred',
          'declined',
          'approved',
          'superseded',
          'expired'
        )
      )
      OR (OLD.status = 'changes_requested' AND NEW.status = 'superseded')
      OR (OLD.status = 'deferred' AND NEW.status IN ('pending_approval', 'superseded', 'expired'))
    ) THEN
      RAISE EXCEPTION 'Invalid revenue recommendation transition: % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status IN ('approved', 'declined', 'deferred', 'changes_requested')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.revenue_decisions d
      WHERE d.recommendation_id = NEW.id
        AND d.recommendation_version = NEW.version
        AND d.decision = NEW.status
    ) INTO matching_decision;

    IF NOT matching_decision THEN
      RAISE EXCEPTION 'Recommendation status requires a matching append-only decision';
    END IF;
  END IF;

  IF NEW.status = 'approved'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_permission('revenue', 'publish') THEN
    RAISE EXCEPTION 'revenue:publish is required to approve a recommendation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_recommendation_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_recommendation_governance
  BEFORE INSERT OR UPDATE ON public.revenue_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_recommendation_governance();
CREATE TRIGGER trg_revenue_recommendations_updated_at
  BEFORE UPDATE ON public.revenue_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_evidence_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recommendation_status TEXT;
BEGIN
  SELECT status INTO recommendation_status
  FROM public.revenue_recommendations
  WHERE id = NEW.recommendation_id;

  IF recommendation_status <> 'draft' THEN
    RAISE EXCEPTION 'Evidence can only be attached to a draft recommendation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_evidence_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_evidence_insert
  BEFORE INSERT ON public.revenue_recommendation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_evidence_insert();

CREATE OR REPLACE FUNCTION public.enforce_revenue_decision_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recommendation_record public.revenue_recommendations%ROWTYPE;
BEGIN
  SELECT * INTO recommendation_record
  FROM public.revenue_recommendations
  WHERE id = NEW.recommendation_id
  FOR UPDATE;

  IF NOT FOUND OR recommendation_record.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Decisions require a pending revenue recommendation';
  END IF;
  IF NEW.recommendation_version <> recommendation_record.version THEN
    RAISE EXCEPTION 'Decision version must match the recommendation version seen';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.actor_id <> auth.uid() THEN
    RAISE EXCEPTION 'Revenue decision actor must match the signed-in user';
  END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.has_permission('revenue', 'publish') THEN
    RAISE EXCEPTION 'revenue:publish is required to decide a recommendation';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    NEW.decided_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_decision_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_decision_insert
  BEFORE INSERT ON public.revenue_decisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_decision_insert();

CREATE OR REPLACE FUNCTION public.apply_revenue_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.revenue_recommendations
  SET status = NEW.decision
  WHERE id = NEW.recommendation_id
    AND version = NEW.recommendation_version
    AND status = 'pending_approval';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revenue decision could not advance its recommendation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_revenue_decision()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_decision_apply
  AFTER INSERT ON public.revenue_decisions
  FOR EACH ROW EXECUTE FUNCTION public.apply_revenue_decision();

CREATE OR REPLACE FUNCTION public.prevent_revenue_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_revenue_append_only_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.revenue_recommendation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_revenue_append_only_mutation();
CREATE TRIGGER trg_revenue_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.revenue_decisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_revenue_append_only_mutation();

CREATE OR REPLACE FUNCTION public.enforce_revenue_execution_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recommendation_status TEXT;
  recommendation_listing_id UUID;
  adjustment_listing_id UUID;
  adjustment_status TEXT;
  has_approval BOOLEAN;
BEGIN
  SELECT status, listing_id
  INTO recommendation_status, recommendation_listing_id
  FROM public.revenue_recommendations
  WHERE id = NEW.recommendation_id;

  SELECT listing_id, status
  INTO adjustment_listing_id, adjustment_status
  FROM public.adjustments
  WHERE id = NEW.adjustment_id;

  IF recommendation_listing_id IS NULL
     OR adjustment_listing_id IS NULL
     OR adjustment_listing_id <> recommendation_listing_id THEN
    RAISE EXCEPTION 'Revenue execution Adjustment must match the recommendation listing';
  END IF;
  IF adjustment_status IN ('controlled', 'rejected') THEN
    RAISE EXCEPTION 'Revenue execution cannot link a closed Adjustment';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.revenue_decisions d
    WHERE d.recommendation_id = NEW.recommendation_id
      AND d.decision = 'approved'
  ) INTO has_approval;

  IF TG_OP = 'INSERT'
     AND (recommendation_status <> 'approved' OR NOT has_approval) THEN
    RAISE EXCEPTION 'Only an approved recommendation may create an execution';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.verification_status IN ('verified', 'failed') THEN
      RAISE EXCEPTION 'Terminal revenue execution verification is immutable';
    END IF;
    IF NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id
       OR NEW.adjustment_id IS DISTINCT FROM OLD.adjustment_id
       OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode
       OR NEW.intended_state_json IS DISTINCT FROM OLD.intended_state_json
       OR NEW.before_state_json IS DISTINCT FROM OLD.before_state_json
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Revenue execution identity and intended/before state are immutable';
    END IF;
  END IF;

  IF NEW.verification_status IN ('verified', 'failed')
     AND (TG_OP = 'INSERT' OR NEW.verification_status <> OLD.verification_status) THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.has_permission('revenue', 'control') THEN
      RAISE EXCEPTION 'revenue:control is required to verify execution';
    END IF;
    NEW.verified_by := COALESCE(auth.uid(), NEW.verified_by);
    NEW.verified_at := COALESCE(NEW.verified_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_execution_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_execution_governance
  BEFORE INSERT OR UPDATE ON public.revenue_executions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_execution_governance();
CREATE TRIGGER trg_revenue_executions_updated_at
  BEFORE UPDATE ON public.revenue_executions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_outcome_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution_record public.revenue_executions%ROWTYPE;
BEGIN
  SELECT * INTO execution_record
  FROM public.revenue_executions
  WHERE id = NEW.execution_id;

  IF NOT FOUND
     OR execution_record.recommendation_id <> NEW.recommendation_id
     OR execution_record.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Outcome reviews require a verified execution for the recommendation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.result IS NOT NULL THEN
    RAISE EXCEPTION 'Completed revenue outcome reviews are immutable';
  END IF;

  IF NEW.result IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.result IS NULL) THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.has_permission('revenue', 'control') THEN
      RAISE EXCEPTION 'revenue:control is required to complete an outcome review';
    END IF;
    NEW.reviewed_by := COALESCE(auth.uid(), NEW.reviewed_by);
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_outcome_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_outcome_governance
  BEFORE INSERT OR UPDATE ON public.revenue_outcome_reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_outcome_governance();
CREATE TRIGGER trg_revenue_outcomes_updated_at
  BEFORE UPDATE ON public.revenue_outcome_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_revenue_data_issue_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  review_listing_id UUID;
BEGIN
  IF NEW.review_run_id IS NOT NULL THEN
    SELECT listing_id INTO review_listing_id
    FROM public.revenue_review_runs
    WHERE id = NEW.review_run_id;
    IF review_listing_id IS NULL OR review_listing_id <> NEW.listing_id THEN
      RAISE EXCEPTION 'Revenue data issue review must belong to the same listing';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'Superseded revenue data issues are immutable';
  END IF;

  IF NEW.status = 'resolved' AND (TG_OP = 'INSERT' OR OLD.status <> 'resolved') THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
  ELSIF NEW.status <> 'resolved' THEN
    NEW.resolved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_data_issue_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_data_issue_governance
  BEFORE INSERT OR UPDATE ON public.revenue_data_issues
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_data_issue_governance();
CREATE TRIGGER trg_revenue_data_issues_updated_at
  BEFORE UPDATE ON public.revenue_data_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- An Adjustment that is linked to Revenue Manager execution cannot become
-- controlled until the refreshed observed state has passed verification.
CREATE OR REPLACE FUNCTION public.enforce_revenue_adjustment_control()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_verification_status TEXT;
BEGIN
  IF NEW.status = 'controlled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT verification_status INTO linked_verification_status
    FROM public.revenue_executions
    WHERE adjustment_id = NEW.id;

    IF linked_verification_status IS NOT NULL
       AND linked_verification_status <> 'verified' THEN
      RAISE EXCEPTION 'Revenue-linked adjustments require verified observed state before control';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_revenue_adjustment_control()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_adjustment_control
  BEFORE UPDATE OF status ON public.adjustments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revenue_adjustment_control();

-- ==========================================================
-- 7. Row-level security
-- ==========================================================

ALTER TABLE public.revenue_property_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_review_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_recommendation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_outcome_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_data_issues ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'revenue_property_profiles',
    'revenue_strategy_versions',
    'revenue_review_runs',
    'revenue_recommendations',
    'revenue_recommendation_evidence',
    'revenue_decisions',
    'revenue_executions',
    'revenue_outcome_reviews',
    'revenue_data_issues'
  ]
  LOOP
    EXECUTE FORMAT(
      'CREATE POLICY "Authorized users can view %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.has_permission(''revenue'', ''view'') AND public.has_permission(''listings'', ''view''))',
      table_name
    );
  END LOOP;
END $$;

CREATE POLICY "Revenue creators can create profiles"
  ON public.revenue_property_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'create')
    AND created_by = auth.uid()
    AND status IN ('draft', 'needs_confirmation')
  );
CREATE POLICY "Revenue managers can edit profiles"
  ON public.revenue_property_profiles FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'edit'))
  WITH CHECK (public.has_permission('revenue', 'edit'));
CREATE POLICY "Revenue approvers can confirm profiles"
  ON public.revenue_property_profiles FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'publish'))
  WITH CHECK (public.has_permission('revenue', 'publish'));

CREATE POLICY "Revenue creators can create strategy drafts"
  ON public.revenue_strategy_versions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'create')
    AND created_by = auth.uid()
    AND status = 'draft'
  );
CREATE POLICY "Revenue managers can edit strategy drafts"
  ON public.revenue_strategy_versions FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'edit'))
  WITH CHECK (public.has_permission('revenue', 'edit'));
CREATE POLICY "Revenue approvers can approve strategies"
  ON public.revenue_strategy_versions FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'publish'))
  WITH CHECK (public.has_permission('revenue', 'publish'));

CREATE POLICY "Revenue creators can create review runs"
  ON public.revenue_review_runs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'create')
    AND created_by = auth.uid()
    AND primary_state IS NULL
    AND completed_at IS NULL
  );
CREATE POLICY "Revenue managers can complete review runs"
  ON public.revenue_review_runs FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'edit'))
  WITH CHECK (public.has_permission('revenue', 'edit'));
CREATE POLICY "Revenue approvers can advance review decisions"
  ON public.revenue_review_runs FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'publish'))
  WITH CHECK (public.has_permission('revenue', 'publish'));
CREATE POLICY "Revenue controllers can advance execution outcomes"
  ON public.revenue_review_runs FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'control'))
  WITH CHECK (public.has_permission('revenue', 'control'));

CREATE POLICY "Revenue creators can create recommendation drafts"
  ON public.revenue_recommendations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'create')
    AND created_by = auth.uid()
    AND status = 'draft'
  );
CREATE POLICY "Revenue managers can submit recommendations"
  ON public.revenue_recommendations FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'edit'))
  WITH CHECK (public.has_permission('revenue', 'edit'));
CREATE POLICY "Revenue approvers can decide recommendations"
  ON public.revenue_recommendations FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'publish'))
  WITH CHECK (public.has_permission('revenue', 'publish'));

CREATE POLICY "Revenue creators can freeze recommendation evidence"
  ON public.revenue_recommendation_evidence FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('revenue', 'create'));

CREATE POLICY "Revenue approvers can record decisions"
  ON public.revenue_decisions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'publish')
    AND actor_id = auth.uid()
  );

CREATE POLICY "Revenue controllers can create executions"
  ON public.revenue_executions FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('revenue', 'control'));
CREATE POLICY "Revenue controllers can verify executions"
  ON public.revenue_executions FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'control'))
  WITH CHECK (public.has_permission('revenue', 'control'));

CREATE POLICY "Revenue controllers can create outcome reviews"
  ON public.revenue_outcome_reviews FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('revenue', 'control'));
CREATE POLICY "Revenue controllers can complete outcome reviews"
  ON public.revenue_outcome_reviews FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'control'))
  WITH CHECK (public.has_permission('revenue', 'control'));

CREATE POLICY "Revenue creators can create data issues"
  ON public.revenue_data_issues FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('revenue', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Revenue managers can resolve data issues"
  ON public.revenue_data_issues FOR UPDATE TO authenticated
  USING (public.has_permission('revenue', 'edit'))
  WITH CHECK (public.has_permission('revenue', 'edit'));

-- Intentionally no DELETE policies on durable Revenue Manager records.
-- Evidence and decisions additionally have database append-only triggers.
