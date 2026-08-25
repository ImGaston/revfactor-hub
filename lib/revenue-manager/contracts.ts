import { z } from "zod"

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
const isoDateTimeSchema = z.string().datetime({ offset: true })

export const REVENUE_CONTRACT_VERSIONS = {
  profile: "revenue-profile.v1",
  metric: "revenue-metric.v1",
  diagnostic: "revenue-diagnostic.v1",
  recommendation: "revenue-recommendation.v1",
} as const

export const confidenceSchema = z.enum(["high", "medium", "low", "unknown"])
export const verificationStateSchema = z.enum([
  "observed",
  "inferred",
  "human_confirmed",
  "superseded",
])
export const freshnessStateSchema = z.enum(["current", "stale", "unknown"])

export const dateRangeSchema = z
  .object({
    start: isoDateSchema,
    end: isoDateSchema,
  })
  .refine(({ start, end }) => start <= end, {
    message: "Date range start must be on or before end",
  })

export const fieldEvidenceSchema = z
  .object({
    value: z.unknown(),
    unit: z.string().min(1).nullable().default(null),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().default(null),
    sourceType: z.string().min(1),
    sourceReference: z.string().min(1),
    observedAt: isoDateTimeSchema,
    confidence: confidenceSchema,
    verificationState: verificationStateSchema,
    notes: z.string().nullable().default(null),
  })
  .refine((field) => Object.prototype.hasOwnProperty.call(field, "value"), {
    message:
      "Evidence value is required; use null for an explicitly unknown value",
    path: ["value"],
  })

export const metricEvidenceSchema = z.object({
  schemaVersion: z.literal(REVENUE_CONTRACT_VERSIONS.metric),
  evidenceId: z.string().min(1),
  metricKey: z.string().min(1),
  propertyKey: z.string().min(1),
  stayRange: dateRangeSchema,
  asOf: isoDateTimeSchema,
  grain: z.enum([
    "daily",
    "weekly",
    "monthly",
    "window",
    "reservation",
    "stay_night",
  ]),
  sourceSnapshotId: z.string().min(1),
  sourceType: z.string().min(1),
  definitionVersion: z.string().min(1),
  comparisonType: z.enum([
    "none",
    "prior_snapshot",
    "prior_year",
    "same_time_last_year",
    "market",
    "comp_set",
    "target",
    "strategy",
  ]),
  benchmark: z
    .object({
      scope: z.string().min(1),
      definition: z.string().min(1),
      value: z.number().finite().nullable(),
      unit: z.string().min(1),
    })
    .nullable()
    .default(null),
  value: z.number().finite().nullable(),
  unit: z.string().min(1),
  numerator: z.number().finite().nullable().default(null),
  denominator: z.number().finite().nullable().default(null),
  freshness: freshnessStateSchema,
  exclusions: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
})

const evidenceSectionSchema = z
  .record(z.string(), fieldEvidenceSchema)
  .refine((section) => Object.keys(section).length > 0, {
    message: "Profile evidence sections must contain at least one field",
  })

export const revenuePropertyProfileSchema = z.object({
  schemaVersion: z.literal(REVENUE_CONTRACT_VERSIONS.profile),
  propertyKey: z.string().min(1),
  displayName: z.string().min(1),
  version: z.number().int().positive(),
  lifecycleMode: z.enum([
    "launching",
    "live_new_to_revfactor",
    "takeover",
    "existing_managed",
  ]),
  status: z.enum(["draft", "needs_confirmation", "current", "superseded"]),
  dataConfidence: confidenceSchema,
  identity: evidenceSectionSchema,
  positioning: evidenceSectionSchema,
  objective: evidenceSectionSchema,
  economics: evidenceSectionSchema,
  inventoryOperations: evidenceSectionSchema,
  pricingStrategy: evidenceSectionSchema,
  distribution: evidenceSectionSchema,
  demandMarket: evidenceSectionSchema,
  policies: evidenceSectionSchema,
  dataHealth: evidenceSectionSchema,
  sourceSnapshotIds: z.array(z.string().min(1)),
  createdAt: isoDateTimeSchema,
})

export const diagnosticCandidateSchema = z.object({
  schemaVersion: z.literal(REVENUE_CONTRACT_VERSIONS.diagnostic),
  candidateId: z.string().min(1),
  propertyKey: z.string().min(1),
  family: z.enum([
    "pace",
    "price",
    "restrictions",
    "inventory",
    "channel_economics",
    "stay_economics",
    "market",
    "listing_funnel",
    "operations",
  ]),
  title: z.string().min(1),
  affectedRange: dateRangeSchema.nullable(),
  factEvidenceIds: z.array(z.string().min(1)).min(1),
  inference: z.string().min(1),
  competingExplanations: z.array(z.string().min(1)),
  confidence: confidenceSchema,
  estimatedImpact: z.object({
    low: z.number().nullable(),
    high: z.number().nullable(),
    unit: z.string(),
  }),
  urgency: z.number().min(0).max(1),
  reversibility: z.number().min(0).max(1),
  riskOfDoingNothing: z.number().min(0).max(1),
  riskOfActing: z.number().min(0).max(1),
  constraintConflicts: z.array(z.string().min(1)),
  overlapsActiveWork: z.boolean(),
})

export const revenueRecommendationSchema = z.object({
  schemaVersion: z.literal(REVENUE_CONTRACT_VERSIONS.recommendation),
  recommendationId: z.string().min(1),
  version: z.number().int().positive(),
  propertyKey: z.string().min(1),
  reviewRunId: z.string().min(1),
  strategyVersionId: z.string().min(1),
  listingOrChannel: z.string().min(1),
  title: z.string().min(1),
  verdict: z.string().min(1),
  problemStatement: z.string().min(1),
  affectedStayRange: dateRangeSchema,
  affectedBookingRange: dateRangeSchema.nullable(),
  factEvidenceIds: z.array(z.string().min(1)).min(1),
  inference: z.string().min(1),
  competingExplanations: z.array(z.string().min(1)),
  proposedAction: z
    .object({
      actionType: z.string().min(1),
      before: z.unknown(),
      after: z.unknown(),
      implementationNotes: z.string().nullable(),
    })
    .refine(
      (action) =>
        Object.prototype.hasOwnProperty.call(action, "before") &&
        Object.prototype.hasOwnProperty.call(action, "after"),
      { message: "Proposed actions require explicit before and after values" }
    ),
  expectedEffect: z.object({
    metricKey: z.string().min(1),
    low: z.number().nullable(),
    high: z.number().nullable(),
    unit: z.string().min(1),
    outcomeWindow: dateRangeSchema,
  }),
  risks: z.array(z.string().min(1)).min(1),
  guardrails: z.array(z.string().min(1)).min(1),
  confidence: confidenceSchema,
  confidenceReasons: z.array(z.string().min(1)).min(1),
  requiredPermission: z.string().min(1),
  decisionDueAt: isoDateTimeSchema,
  reversalPlan: z.string().min(1),
  reviewTrigger: z.string().min(1),
  conflicts: z.array(z.string().min(1)),
  status: z.enum([
    "draft",
    "pending_approval",
    "changes_requested",
    "deferred",
    "declined",
    "approved",
    "superseded",
    "expired",
  ]),
})

export type FieldEvidence = z.infer<typeof fieldEvidenceSchema>
export type MetricEvidence = z.infer<typeof metricEvidenceSchema>
export type RevenuePropertyProfile = z.infer<
  typeof revenuePropertyProfileSchema
>
export type DiagnosticCandidate = z.infer<typeof diagnosticCandidateSchema>
export type RevenueRecommendation = z.infer<typeof revenueRecommendationSchema>
