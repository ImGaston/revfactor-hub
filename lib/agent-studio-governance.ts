import type { AgentStudioModelId } from "@/lib/agent-studio"
import type { AgentWorkflow } from "@/lib/agent-studio-coach"

export type AgentPlaybookStatus =
  | "draft"
  | "testing"
  | "approved"
  | "production"
  | "archived"

export type AgentPlaybookVersionSummary = {
  id: string
  playbookId: string
  playbookName: string
  description: string | null
  version: number
  status: AgentPlaybookStatus
  instructions: string
  workflow: AgentWorkflow
  modelId: AgentStudioModelId
  allowedTools: string[]
  maxInputTokens: number
  maxOutputTokens: number
  maxRunCostUsd: number
  changeNote: string | null
  createdAt: string
  createdByName: string | null
}

export type AgentRunSummary = {
  id: string
  conversationId: string
  conversationTitle: string | null
  conversationSource: "playground" | "evaluation" | "shadow"
  clientName: string | null
  modelId: string
  playbookVersion: string | null
  status: "completed" | "failed" | "blocked"
  errorMessage: string | null
  disposition: "answer" | "clarify" | "escalate" | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  durationMs: number
  createdAt: string
  createdByName: string | null
  feedbackRating: number | null
}

export type AgentEvaluationCaseSummary = {
  id: string
  name: string
  description: string | null
  caseType: "regression" | "prompt_injection" | "shadow"
  messages: Array<{ role: "user" | "assistant"; content: string }>
  expectedDisposition: "answer" | "clarify" | "escalate" | null
  expectedMustInclude: string[]
  expectedMustNotInclude: string[]
  rubric: string | null
  active: boolean
  hasFrozenSnapshot: boolean
  createdAt: string
}

export type AgentEvaluationBatchSummary = {
  id: string
  name: string
  status: "pending" | "running" | "completed" | "failed" | "canceled"
  modelIds: string[]
  totalCases: number
  completedCases: number
  passedCases: number
  totalCostUsd: number
  createdAt: string
}

export type AgentIntegrationHealth = {
  integration: "assembly" | "pricelabs" | "ai_gateway"
  status: "connected" | "stale" | "partial" | "unavailable"
  latencyMs: number | null
  lastSourceUpdateAt: string | null
  details: Record<string, unknown>
  checkedAt: string
}

export type AgentStudioSettings = {
  maxInputTokens: number
  maxOutputTokens: number
  maxRunCostUsd: number
  maxRunDurationMs: number
  dailyBudgetUsd: number
  monthlyBudgetUsd: number
  retentionDays: number
  assemblyContextMessages: number
  requireSendApproval: boolean
}

export type AgentApprovalSummary = {
  id: string
  requestType: "promote_production" | "assembly_send"
  status: "pending" | "approved" | "rejected" | "canceled"
  playbookVersionId: string | null
  playbookLabel: string | null
  rationale: string | null
  requestedByName: string | null
  decidedByName: string | null
  decisionNote: string | null
  createdAt: string
}

export type AgentAuditSummary = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorName: string | null
  details: Record<string, unknown>
  createdAt: string
}

export type AgentStudioGovernanceSnapshot = {
  playbookVersions: AgentPlaybookVersionSummary[]
  recentRuns: AgentRunSummary[]
  evaluationCases: AgentEvaluationCaseSummary[]
  evaluationBatches: AgentEvaluationBatchSummary[]
  integrationHealth: AgentIntegrationHealth[]
  settings: AgentStudioSettings
  approvals: AgentApprovalSummary[]
  auditEvents: AgentAuditSummary[]
  canCreate: boolean
  canEdit: boolean
  canPublish: boolean
  canControl: boolean
}

export const DEFAULT_STUDIO_SETTINGS: AgentStudioSettings = {
  maxInputTokens: 30_000,
  maxOutputTokens: 1_200,
  maxRunCostUsd: 0.02,
  maxRunDurationMs: 45_000,
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 50,
  retentionDays: 90,
  assemblyContextMessages: 40,
  requireSendApproval: true,
}
