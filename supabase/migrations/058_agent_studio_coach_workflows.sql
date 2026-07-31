-- Studio Coach: editable observable workflows and a separate cost ledger.

ALTER TABLE agent_playbook_versions
  ADD COLUMN workflow JSONB NOT NULL DEFAULT $$
  {
    "version": 1,
    "nodes": [
      {"id":"classify-intent","label":"Classify intent","kind":"input","responseType":"all","instruction":"Identify the client's actual question and classify the required outcome as answer, clarify, or escalate."},
      {"id":"select-evidence","label":"Select evidence","kind":"process","responseType":"all","instruction":"Choose only relevant client, PriceLabs, Assembly, task, and approved Knowledge evidence."},
      {"id":"validate-sufficiency","label":"Validate sufficiency","kind":"decision","responseType":"all","instruction":"Check date grain, freshness, client scope, and whether the evidence directly supports the requested comparison."},
      {"id":"answer-branch","label":"Answer with evidence","kind":"process","responseType":"answer","instruction":"Lead with the direct answer, distinguish exact from approximate metrics, add the clearest interpretation, and state any material limitation."},
      {"id":"clarify-branch","label":"Ask one question","kind":"process","responseType":"clarify","instruction":"Explain what is known, identify the single missing fact that blocks a reliable answer, and ask one focused question."},
      {"id":"escalate-branch","label":"Escalate safely","kind":"process","responseType":"escalate","instruction":"Summarize the verified context and why human review is required without promising an outcome or response time."},
      {"id":"quality-check","label":"Client-ready check","kind":"output","responseType":"all","instruction":"Verify factual grounding, plain language, appropriate tone, no unsupported action claims, and a clear next step."}
    ],
    "edges": [
      {"id":"classify-to-evidence","source":"classify-intent","target":"select-evidence","condition":null},
      {"id":"evidence-to-validate","source":"select-evidence","target":"validate-sufficiency","condition":null},
      {"id":"validate-to-answer","source":"validate-sufficiency","target":"answer-branch","condition":"Evidence is sufficient"},
      {"id":"validate-to-clarify","source":"validate-sufficiency","target":"clarify-branch","condition":"One answerable fact is missing"},
      {"id":"validate-to-escalate","source":"validate-sufficiency","target":"escalate-branch","condition":"Policy or risk requires human review"},
      {"id":"answer-to-quality","source":"answer-branch","target":"quality-check","condition":null},
      {"id":"clarify-to-quality","source":"clarify-branch","target":"quality-check","condition":null},
      {"id":"escalate-to-quality","source":"escalate-branch","target":"quality-check","condition":null}
    ]
  }
  $$::JSONB,
  ADD CONSTRAINT agent_playbook_versions_workflow_object
    CHECK (JSONB_TYPEOF(workflow) = 'object');

CREATE TABLE agent_coach_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  comparison_run_ids UUID[] NOT NULL DEFAULT '{}',
  model_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  output JSONB NOT NULL DEFAULT '{}'::JSONB,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0
    CHECK (estimated_cost_usd >= 0),
  pricing_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_coach_reviews_recent
  ON agent_coach_reviews (created_at DESC);
CREATE INDEX idx_agent_coach_reviews_anchor
  ON agent_coach_reviews (anchor_run_id, created_at DESC);

ALTER TABLE agent_coach_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view agent coach reviews"
  ON agent_coach_reviews FOR SELECT TO authenticated
  USING (public.has_permission('agent_studio', 'view'));

CREATE POLICY "Authorized users can create agent coach reviews"
  ON agent_coach_reviews FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('agent_studio', 'create')
    AND created_by = auth.uid()
  );

CREATE POLICY "Authorized users can delete agent coach reviews"
  ON agent_coach_reviews FOR DELETE TO authenticated
  USING (public.has_permission('agent_studio', 'delete'));
