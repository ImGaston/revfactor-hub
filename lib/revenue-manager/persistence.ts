import {
  revenuePropertyProfileSchema,
  revenueRecommendationSchema,
  type RevenuePropertyProfile,
  type RevenueRecommendation,
} from "@/lib/revenue-manager/contracts"

export type JsonObject = Record<string, unknown>

export type RevenueProfileStatus =
  | "draft"
  | "needs_confirmation"
  | "current"
  | "superseded"

export type RevenueStrategyStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "superseded"

export type RevenueReviewState =
  | "no_action"
  | "data_blocked"
  | "recommendation_pending"
  | "deferred"
  | "declined"
  | "approved_for_execution"
  | "verification_failed"
  | "outcome_pending"
  | "completed"

export type RevenueRecommendationStatus =
  | "draft"
  | "pending_approval"
  | "changes_requested"
  | "deferred"
  | "declined"
  | "approved"
  | "superseded"
  | "expired"

export type RevenuePropertyProfileRow = {
  id: string
  client_id: string
  listing_id: string
  version: number
  schema_version: "revenue-profile.v1"
  lifecycle_mode:
    | "launching"
    | "live_new_to_revfactor"
    | "takeover"
    | "existing_managed"
  profile_json: unknown
  source_snapshot_ids: unknown
  data_confidence: "high" | "medium" | "low" | "unknown"
  status: RevenueProfileStatus
  created_by: string | null
  created_at: string
  confirmed_by: string | null
  confirmed_at: string | null
  updated_at: string
}

export type RevenueStrategyVersionRow = {
  id: string
  listing_id: string
  profile_id: string
  prior_version_id: string | null
  version: number
  objective_json: JsonObject
  constraints_json: JsonObject
  pricing_policy_json: JsonObject
  distribution_policy_json: JsonObject
  measurement_plan_json: JsonObject
  status: RevenueStrategyStatus
  effective_from: string | null
  approved_by: string | null
  approved_at: string | null
  change_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RevenueReviewRunRow = {
  id: string
  listing_id: string
  profile_id: string
  strategy_version_id: string
  trigger_type:
    | "property_added"
    | "user_requested"
    | "scheduled"
    | "source_changed"
    | "outcome_due"
    | "data_issue_resolved"
  trigger_reference: string | null
  window_start: string
  window_end: string
  as_of: string
  frozen_source_manifest: JsonObject
  diagnostic_results_json: JsonObject
  primary_state: RevenueReviewState | null
  agent_run_id: string | null
  created_by: string | null
  started_at: string
  completed_at: string | null
  next_review_at: string | null
  updated_at: string
}

export type RevenueRecommendationRow = {
  id: string
  review_run_id: string
  listing_id: string
  version: number
  schema_version: "revenue-recommendation.v1"
  title: string
  verdict: string
  problem_json: JsonObject
  inference_json: JsonObject
  action_json: JsonObject
  expected_effect_json: JsonObject
  risk_json: JsonObject
  guardrails_json: JsonObject
  confidence: "high" | "medium" | "low" | "unknown"
  affected_start_date: string
  affected_end_date: string
  status: RevenueRecommendationStatus
  decision_due_at: string | null
  expires_at: string | null
  required_permission: "revenue:publish"
  supersedes_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type PersistedRecommendationProblem = {
  propertyKey: string
  strategyVersionId: string
  listingOrChannel: string
  problemStatement: string
  affectedBookingRange: { start: string; end: string } | null
  factEvidenceIds: string[]
}

type PersistedRecommendationInference = {
  inference: string
  competingExplanations: string[]
}

type PersistedRecommendationAction = {
  proposedAction: {
    actionType: string
    before: unknown
    after: unknown
    implementationNotes: string | null
  }
  reversalPlan: string
  reviewTrigger: string
  conflicts: string[]
}

type PersistedRecommendationRisk = {
  risks: string[]
  confidenceReasons: string[]
}

type PersistedRecommendationGuardrails = {
  guardrails: string[]
}

export type RevenueDataIssueRow = {
  id: string
  listing_id: string
  review_run_id: string | null
  issue_key: string
  issue_type: string
  severity: "info" | "warning" | "blocking"
  title: string
  details_json: JsonObject
  source_references: string[]
  status: "open" | "acknowledged" | "resolved" | "superseded"
  blocks_profile: boolean
  blocks_recommendation: boolean
  blocks_execution: boolean
  owner_id: string | null
  resolution_note: string | null
  resolved_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RevenueRecommendationPersistencePayload = Pick<
  RevenueRecommendationRow,
  | "version"
  | "schema_version"
  | "title"
  | "verdict"
  | "problem_json"
  | "inference_json"
  | "action_json"
  | "expected_effect_json"
  | "risk_json"
  | "guardrails_json"
  | "confidence"
  | "affected_start_date"
  | "affected_end_date"
  | "status"
  | "decision_due_at"
  | "required_permission"
>

export function parsePersistedProfile(
  row: RevenuePropertyProfileRow
): RevenuePropertyProfile {
  return revenuePropertyProfileSchema.parse(row.profile_json)
}

export function serializeRecommendationForPersistence(
  recommendation: RevenueRecommendation
): RevenueRecommendationPersistencePayload {
  return {
    version: recommendation.version,
    schema_version: recommendation.schemaVersion,
    title: recommendation.title,
    verdict: recommendation.verdict,
    problem_json: {
      propertyKey: recommendation.propertyKey,
      strategyVersionId: recommendation.strategyVersionId,
      listingOrChannel: recommendation.listingOrChannel,
      problemStatement: recommendation.problemStatement,
      affectedBookingRange: recommendation.affectedBookingRange,
      factEvidenceIds: recommendation.factEvidenceIds,
    },
    inference_json: {
      inference: recommendation.inference,
      competingExplanations: recommendation.competingExplanations,
    },
    action_json: {
      proposedAction: recommendation.proposedAction,
      reversalPlan: recommendation.reversalPlan,
      reviewTrigger: recommendation.reviewTrigger,
      conflicts: recommendation.conflicts,
    },
    expected_effect_json: { ...recommendation.expectedEffect },
    risk_json: {
      risks: recommendation.risks,
      confidenceReasons: recommendation.confidenceReasons,
    },
    guardrails_json: { guardrails: recommendation.guardrails },
    confidence: recommendation.confidence,
    affected_start_date: recommendation.affectedStayRange.start,
    affected_end_date: recommendation.affectedStayRange.end,
    status: recommendation.status,
    decision_due_at: recommendation.decisionDueAt,
    required_permission: "revenue:publish",
  }
}

export function parsePersistedRecommendation(
  row: RevenueRecommendationRow
): RevenueRecommendation {
  if (!row.decision_due_at) {
    throw new Error(
      "Persisted recommendation requires decision_due_at before contract hydration"
    )
  }
  const problem = row.problem_json as PersistedRecommendationProblem
  const inference = row.inference_json as PersistedRecommendationInference
  const action = row.action_json as PersistedRecommendationAction
  const risk = row.risk_json as PersistedRecommendationRisk
  const guardrails = row.guardrails_json as PersistedRecommendationGuardrails

  return revenueRecommendationSchema.parse({
    schemaVersion: row.schema_version,
    recommendationId: row.id,
    version: row.version,
    propertyKey: problem.propertyKey,
    reviewRunId: row.review_run_id,
    strategyVersionId: problem.strategyVersionId,
    listingOrChannel: problem.listingOrChannel,
    title: row.title,
    verdict: row.verdict,
    problemStatement: problem.problemStatement,
    affectedBookingRange: problem.affectedBookingRange,
    factEvidenceIds: problem.factEvidenceIds,
    inference: inference.inference,
    competingExplanations: inference.competingExplanations,
    proposedAction: action.proposedAction,
    expectedEffect: row.expected_effect_json,
    risks: risk.risks,
    guardrails: guardrails.guardrails,
    confidence: row.confidence,
    confidenceReasons: risk.confidenceReasons,
    affectedStayRange: {
      start: row.affected_start_date,
      end: row.affected_end_date,
    },
    decisionDueAt: row.decision_due_at,
    requiredPermission: row.required_permission,
    reversalPlan: action.reversalPlan,
    reviewTrigger: action.reviewTrigger,
    conflicts: action.conflicts,
    status: row.status,
  })
}
