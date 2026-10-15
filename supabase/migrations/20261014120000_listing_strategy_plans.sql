-- Listing strategy: one pricing plan per listing (Strategy, Goals, Comps and
-- Events tabs), the open questions that block it, and an append-only event log.
-- Ontology: Exception → Recommendation (plan, questions) → Decision (answers,
-- ApprovePricingPlan) → Execution (setup adjustment) → Outcome (pace vs goals).
-- Numbers stay in code (lib/pricing-plan.ts); the plan stores inputs only.

CREATE TABLE IF NOT EXISTS listing_pricing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  -- Owner's minimum, as payout per night after markups and discounts (Fede, 2026-10-13).
  floor_payout NUMERIC,
  base_price NUMERIC,
  max_price NUMERIC,
  booking_window TEXT,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,markup,fee,discounts:[{label,pct,kind,minNights,on}]}]
  seasons JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{name,dates,plMin,minStay,rules}]
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{month,occ,adr,days?}]
  anchors JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {breakEvenMonthly, ownerGoalAnnual, marketNote}
  comps JSONB NOT NULL DEFAULT '{}'::jsonb,      -- {rule, points:[{source,nightly,origin,note}]}
  events JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{name,dates,rule,status}]
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,      -- decided rules, plain strings
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_plan_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  who TEXT NOT NULL DEFAULT 'owner' CHECK (who IN ('owner', 'fede', 'ops')),
  question TEXT NOT NULL,
  why TEXT,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('choice', 'number', 'text')),
  options TEXT[] NOT NULL DEFAULT '{}',
  -- Decision text recorded when a given option is chosen: {"No, open it": "Open Dec 19 – Jan 3 ..."}
  decisions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Plan field this answer feeds (e.g. 'floor_payout'); null when informational.
  feeds TEXT,
  required_for_approval BOOLEAN NOT NULL DEFAULT false,
  answer TEXT,
  answered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_plan_questions_listing
  ON listing_plan_questions(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS listing_plan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES listing_pricing_plans(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'ProposePricingPlan', 'UpdatePricingPlan', 'AnswerPlanQuestion', 'AddPlanQuestion',
    'ApprovePricingPlan', 'ReopenPricingPlan'
  )),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_plan_events_listing
  ON listing_plan_events(listing_id, created_at);

ALTER TABLE listing_pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_plan_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_plan_events ENABLE ROW LEVEL SECURITY;

-- Permission-based internal access (migration 038), same as listing reviews.
CREATE POLICY "Listings users can view pricing plans" ON listing_pricing_plans
  FOR SELECT TO authenticated USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings editors can create pricing plans" ON listing_pricing_plans
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can edit pricing plans" ON listing_pricing_plans
  FOR UPDATE TO authenticated USING (public.has_permission('listings', 'edit')) WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings managers can delete pricing plans" ON listing_pricing_plans
  FOR DELETE TO authenticated USING (public.has_permission('listings', 'delete'));

CREATE POLICY "Listings users can view plan questions" ON listing_plan_questions
  FOR SELECT TO authenticated USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings editors can create plan questions" ON listing_plan_questions
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can edit plan questions" ON listing_plan_questions
  FOR UPDATE TO authenticated USING (public.has_permission('listings', 'edit')) WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings managers can delete plan questions" ON listing_plan_questions
  FOR DELETE TO authenticated USING (public.has_permission('listings', 'delete'));

-- Events are append-only: read and insert, never update or delete.
CREATE POLICY "Listings users can view plan events" ON listing_plan_events
  FOR SELECT TO authenticated USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings editors can log plan events" ON listing_plan_events
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('listings', 'edit'));

REVOKE ALL ON listing_pricing_plans, listing_plan_questions, listing_plan_events FROM anon;
