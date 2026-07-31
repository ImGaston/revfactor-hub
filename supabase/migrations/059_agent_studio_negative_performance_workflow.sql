-- Add an explicit negative-performance workflow without overwriting edits to
-- existing answer, clarify, escalation, or common workflow steps.

ALTER TABLE agent_playbook_versions
  ALTER COLUMN workflow SET DEFAULT $$
  {
    "version": 1,
    "nodes": [
      {"id":"classify-intent","label":"Classify intent","kind":"input","responseType":"all","instruction":"Identify the client's actual question and classify the required outcome as answer, clarify, or escalate."},
      {"id":"select-evidence","label":"Select evidence","kind":"process","responseType":"all","instruction":"Choose only relevant client, PriceLabs, Assembly, task, and approved Knowledge evidence."},
      {"id":"validate-sufficiency","label":"Validate sufficiency","kind":"decision","responseType":"all","instruction":"Check date grain, freshness, client scope, and whether the evidence directly supports the requested comparison."},
      {"id":"answer-branch","label":"Answer with evidence","kind":"process","responseType":"answer","instruction":"Lead with the direct answer, distinguish exact from approximate metrics, add the clearest interpretation, and state any material limitation."},
      {"id":"negative-performance-gate","label":"Confirm negative performance","kind":"decision","responseType":"negative","instruction":"Treat performance as negative only when a verified metric materially trails the relevant market, same-time-last-year pace, final last-year result, or an explicit target for the requested horizon. Do not diagnose underperformance from one unlabeled metric."},
      {"id":"negative-performance-frame","label":"Frame the result constructively","kind":"process","responseType":"negative","instruction":"Acknowledge the concern and state the verified gap plainly. Separate observed facts from possible causes, avoid blame, false optimism, and recovery promises, and mention positive context only when it materially changes the interpretation. Offer at most three evidence-backed, controllable levers as hypotheses to investigate, not automatic recommendations."},
      {"id":"negative-performance-route","label":"Choose answer, brainstorm, or escalate","kind":"decision","responseType":"negative","instruction":"Give a client-ready next step when the evidence supports the cause and action. Flag an internal brainstorm when the cause is uncertain but low risk. Escalate when the gap is material, repeated, or unexplained; data is stale or conflicting; the client raises churn, refund, cancellation, or a sensitive dispute; or a requested action requires approval."},
      {"id":"clarify-branch","label":"Ask one question","kind":"process","responseType":"clarify","instruction":"Explain what is known, identify the single missing fact that blocks a reliable answer, and ask one focused question."},
      {"id":"escalate-branch","label":"Escalate safely","kind":"process","responseType":"escalate","instruction":"Summarize the verified context and why human review is required without promising an outcome or response time."},
      {"id":"quality-check","label":"Client-ready check","kind":"output","responseType":"all","instruction":"Verify factual grounding, plain language, appropriate tone, no unsupported action claims, and a clear next step."}
    ],
    "edges": [
      {"id":"classify-to-evidence","source":"classify-intent","target":"select-evidence","condition":null},
      {"id":"evidence-to-validate","source":"select-evidence","target":"validate-sufficiency","condition":null},
      {"id":"validate-to-answer","source":"validate-sufficiency","target":"answer-branch","condition":"Evidence is sufficient"},
      {"id":"validate-to-negative","source":"validate-sufficiency","target":"negative-performance-gate","condition":"Verified performance materially trails a valid benchmark"},
      {"id":"validate-to-clarify","source":"validate-sufficiency","target":"clarify-branch","condition":"One answerable fact is missing"},
      {"id":"validate-to-escalate","source":"validate-sufficiency","target":"escalate-branch","condition":"Policy or risk requires human review"},
      {"id":"answer-to-quality","source":"answer-branch","target":"quality-check","condition":null},
      {"id":"negative-gate-to-frame","source":"negative-performance-gate","target":"negative-performance-frame","condition":"The comparison is valid"},
      {"id":"negative-frame-to-route","source":"negative-performance-frame","target":"negative-performance-route","condition":null},
      {"id":"negative-route-to-quality","source":"negative-performance-route","target":"quality-check","condition":"Client-ready, brainstorm internally, or escalate"},
      {"id":"clarify-to-quality","source":"clarify-branch","target":"quality-check","condition":null},
      {"id":"escalate-to-quality","source":"escalate-branch","target":"quality-check","condition":null}
    ]
  }
  $$::JSONB;

UPDATE agent_playbook_versions
SET workflow = JSONB_SET(
  JSONB_SET(
    workflow,
    '{nodes}',
    COALESCE(workflow->'nodes', '[]'::JSONB) || $$
    [
      {"id":"negative-performance-gate","label":"Confirm negative performance","kind":"decision","responseType":"negative","instruction":"Treat performance as negative only when a verified metric materially trails the relevant market, same-time-last-year pace, final last-year result, or an explicit target for the requested horizon. Do not diagnose underperformance from one unlabeled metric."},
      {"id":"negative-performance-frame","label":"Frame the result constructively","kind":"process","responseType":"negative","instruction":"Acknowledge the concern and state the verified gap plainly. Separate observed facts from possible causes, avoid blame, false optimism, and recovery promises, and mention positive context only when it materially changes the interpretation. Offer at most three evidence-backed, controllable levers as hypotheses to investigate, not automatic recommendations."},
      {"id":"negative-performance-route","label":"Choose answer, brainstorm, or escalate","kind":"decision","responseType":"negative","instruction":"Give a client-ready next step when the evidence supports the cause and action. Flag an internal brainstorm when the cause is uncertain but low risk. Escalate when the gap is material, repeated, or unexplained; data is stale or conflicting; the client raises churn, refund, cancellation, or a sensitive dispute; or a requested action requires approval."}
    ]
    $$::JSONB,
    true
  ),
  '{edges}',
  COALESCE(workflow->'edges', '[]'::JSONB) ||
    CASE
      WHEN workflow->'nodes' @> '[{"id":"validate-sufficiency"}]'::JSONB
        AND workflow->'nodes' @> '[{"id":"quality-check"}]'::JSONB
      THEN $$
      [
        {"id":"validate-to-negative","source":"validate-sufficiency","target":"negative-performance-gate","condition":"Verified performance materially trails a valid benchmark"},
        {"id":"negative-gate-to-frame","source":"negative-performance-gate","target":"negative-performance-frame","condition":"The comparison is valid"},
        {"id":"negative-frame-to-route","source":"negative-performance-frame","target":"negative-performance-route","condition":null},
        {"id":"negative-route-to-quality","source":"negative-performance-route","target":"quality-check","condition":"Client-ready, brainstorm internally, or escalate"}
      ]
      $$::JSONB
      ELSE '[]'::JSONB
    END,
  true
)
WHERE JSONB_TYPEOF(workflow) = 'object'
  AND NOT EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(COALESCE(workflow->'nodes', '[]'::JSONB)) AS node
    WHERE node->>'responseType' = 'negative'
  );

-- Keep common output checks at the end of every branch. Existing workflows
-- received the new nodes by append so this preserves all user-authored order
-- while moving only common output nodes behind the new decision path.
UPDATE agent_playbook_versions
SET workflow = JSONB_SET(
  workflow,
  '{nodes}',
  (
    SELECT JSONB_AGG(node ORDER BY is_common_output, ordinal)
    FROM (
      SELECT
        node,
        ordinal,
        CASE
          WHEN node->>'kind' = 'output' AND node->>'responseType' = 'all'
          THEN 1
          ELSE 0
        END AS is_common_output
      FROM JSONB_ARRAY_ELEMENTS(workflow->'nodes')
        WITH ORDINALITY AS items(node, ordinal)
    ) AS ordered_nodes
  ),
  true
)
WHERE JSONB_TYPEOF(workflow) = 'object'
  AND EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(COALESCE(workflow->'nodes', '[]'::JSONB)) AS node
    WHERE node->>'responseType' = 'negative'
  );
