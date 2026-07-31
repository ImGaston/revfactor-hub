import {
  DEFAULT_STUDIO_SETTINGS,
  type AgentApprovalSummary,
  type AgentAuditSummary,
  type AgentEvaluationBatchSummary,
  type AgentEvaluationCaseSummary,
  type AgentIntegrationHealth,
  type AgentPlaybookVersionSummary,
  type AgentRunSummary,
  type AgentStudioGovernanceSnapshot,
} from "@/lib/agent-studio-governance"
import { isAgentStudioModelId } from "@/lib/agent-studio"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return record(value[0])
  return record(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function profileName(
  profileId: unknown,
  names: Map<string, string>
): string | null {
  return typeof profileId === "string" ? names.get(profileId) ?? null : null
}

function normalizeMessages(
  value: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const message = record(item)
    const role = message.role
    const content = message.content
    return (role === "user" || role === "assistant") &&
      typeof content === "string"
      ? [{ role, content }]
      : []
  })
}

export async function loadAgentStudioGovernance(): Promise<AgentStudioGovernanceSnapshot> {
  const [canCreate, canEdit, canPublish, canControl] = await Promise.all([
    hasPermission("agent_studio", "create"),
    hasPermission("agent_studio", "edit"),
    hasPermission("agent_studio", "publish"),
    hasPermission("agent_studio", "control"),
  ])
  const supabase = await createClient()

  const [
    { data: playbooks },
    { data: versions },
    { data: runs },
    { data: cases },
    { data: batches },
    { data: checks },
    { data: settingsRows },
    { data: approvals },
    { data: audits },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from("agent_playbooks")
      .select("id, name, description")
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("agent_playbook_versions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_runs")
      .select(
        `
          id, conversation_id, model_id, status, disposition,
          input_tokens, output_tokens, total_tokens, estimated_cost_usd,
          duration_ms, error_message, created_at, created_by, playbook_version_id,
          agent_conversations(title, source, clients(name)),
          agent_feedback(overall_rating)
        `
      )
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("agent_evaluation_cases")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("agent_evaluation_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_integration_checks")
      .select("*")
      .order("checked_at", { ascending: false })
      .limit(30),
    supabase.from("agent_studio_settings").select("*").eq("id", true).limit(1),
    supabase
      .from("agent_approval_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, full_name, email"),
  ])

  const profileNames = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile.full_name || profile.email,
    ])
  )
  const playbookMap = new Map(
    (playbooks ?? []).map((playbook) => [playbook.id, playbook])
  )
  const versionMap = new Map(
    (versions ?? []).map((version) => [version.id, version])
  )

  const playbookVersions: AgentPlaybookVersionSummary[] = (versions ?? [])
    .filter((version) => isAgentStudioModelId(version.model_id))
    .map((version) => {
      const playbook = playbookMap.get(version.playbook_id)
      return {
        id: version.id,
        playbookId: version.playbook_id,
        playbookName: playbook?.name ?? "Unknown playbook",
        description: playbook?.description ?? null,
        version: Number(version.version),
        status: version.status,
        instructions: version.instructions,
        modelId: version.model_id,
        allowedTools: version.allowed_tools ?? [],
        maxInputTokens: Number(version.max_input_tokens),
        maxOutputTokens: Number(version.max_output_tokens),
        maxRunCostUsd: Number(version.max_run_cost_usd),
        changeNote: version.change_note,
        createdAt: version.created_at,
        createdByName: profileName(version.created_by, profileNames),
      }
    })

  const recentRuns: AgentRunSummary[] = (runs ?? []).map((run) => {
    const conversation = firstRecord(run.agent_conversations)
    const client = firstRecord(conversation.clients)
    const feedback = firstRecord(run.agent_feedback)
    const version = run.playbook_version_id
      ? versionMap.get(run.playbook_version_id)
      : null
    const playbook = version ? playbookMap.get(version.playbook_id) : null
    const conversationSource = conversation.source

    return {
      id: run.id,
      conversationId: run.conversation_id,
      conversationTitle: stringValue(conversation.title),
      conversationSource:
        conversationSource === "evaluation" || conversationSource === "shadow"
          ? conversationSource
          : "playground",
      clientName: stringValue(client.name),
      modelId: run.model_id,
      playbookVersion:
        version && playbook
          ? `${playbook.name} v${version.version}`
          : null,
      status: run.status,
      errorMessage: run.error_message,
      disposition: run.disposition,
      inputTokens: Number(run.input_tokens),
      outputTokens: Number(run.output_tokens),
      totalTokens: Number(run.total_tokens),
      estimatedCostUsd: Number(run.estimated_cost_usd),
      durationMs: Number(run.duration_ms),
      createdAt: run.created_at,
      createdByName: profileName(run.created_by, profileNames),
      feedbackRating:
        typeof feedback.overall_rating === "number"
          ? feedback.overall_rating
          : null,
    }
  })

  const evaluationCases: AgentEvaluationCaseSummary[] = (cases ?? []).map(
    (evaluationCase) => ({
      id: evaluationCase.id,
      name: evaluationCase.name,
      description: evaluationCase.description,
      caseType: evaluationCase.case_type,
      messages: normalizeMessages(evaluationCase.messages),
      expectedDisposition: evaluationCase.expected_disposition,
      expectedMustInclude: evaluationCase.expected_must_include ?? [],
      expectedMustNotInclude: evaluationCase.expected_must_not_include ?? [],
      rubric: evaluationCase.rubric,
      active: evaluationCase.active,
      hasFrozenSnapshot: evaluationCase.frozen_source_snapshot != null,
      createdAt: evaluationCase.created_at,
    })
  )

  const evaluationBatches: AgentEvaluationBatchSummary[] = (batches ?? []).map(
    (batch) => ({
      id: batch.id,
      name: batch.name,
      status: batch.status,
      modelIds: batch.model_ids ?? [],
      totalCases: Number(batch.total_cases),
      completedCases: Number(batch.completed_cases),
      passedCases: Number(batch.passed_cases),
      totalCostUsd: Number(batch.total_cost_usd),
      createdAt: batch.created_at,
    })
  )

  // The query is newest-first. Keep the first row for each integration;
  // constructing a Map from every row would let older checks overwrite it.
  const latestIntegrationHealth = new Map<
    AgentIntegrationHealth["integration"],
    AgentIntegrationHealth
  >()
  for (const check of checks ?? []) {
    if (latestIntegrationHealth.has(check.integration)) continue
    latestIntegrationHealth.set(check.integration, {
      integration: check.integration,
      status: check.status,
      latencyMs:
        check.latency_ms == null ? null : Number(check.latency_ms),
      lastSourceUpdateAt: check.last_source_update_at,
      details: record(check.details),
      checkedAt: check.checked_at,
    })
  }
  const integrationHealth = Array.from(latestIntegrationHealth.values())

  const settingsRow = settingsRows?.[0]
  const settings = settingsRow
    ? {
        maxInputTokens: Number(settingsRow.max_input_tokens),
        maxOutputTokens: Number(settingsRow.max_output_tokens),
        maxRunCostUsd: Number(settingsRow.max_run_cost_usd),
        maxRunDurationMs: Number(settingsRow.max_run_duration_ms),
        dailyBudgetUsd: Number(settingsRow.daily_budget_usd),
        monthlyBudgetUsd: Number(settingsRow.monthly_budget_usd),
        retentionDays: Number(settingsRow.retention_days),
        assemblyContextMessages: Number(
          settingsRow.assembly_context_messages
        ),
        requireSendApproval: Boolean(settingsRow.require_send_approval),
      }
    : DEFAULT_STUDIO_SETTINGS

  const approvalSummaries: AgentApprovalSummary[] = (approvals ?? []).map(
    (approval) => {
      const version = approval.playbook_version_id
        ? versionMap.get(approval.playbook_version_id)
        : null
      const playbook = version ? playbookMap.get(version.playbook_id) : null
      return {
        id: approval.id,
        requestType: approval.request_type,
        status: approval.status,
        playbookVersionId: approval.playbook_version_id,
        playbookLabel:
          version && playbook
            ? `${playbook.name} v${version.version}`
            : null,
        rationale: approval.rationale,
        requestedByName: profileName(approval.requested_by, profileNames),
        decidedByName: profileName(approval.decided_by, profileNames),
        decisionNote: approval.decision_note,
        createdAt: approval.created_at,
      }
    }
  )

  const auditEvents: AgentAuditSummary[] = (audits ?? []).map((audit) => ({
    id: audit.id,
    action: audit.action,
    entityType: audit.entity_type,
    entityId: audit.entity_id,
    actorName: profileName(audit.actor_id, profileNames),
    details: record(audit.details),
    createdAt: audit.created_at,
  }))

  return {
    playbookVersions,
    recentRuns,
    evaluationCases,
    evaluationBatches,
    integrationHealth,
    settings,
    approvals: approvalSummaries,
    auditEvents,
    canCreate,
    canEdit,
    canPublish,
    canControl,
  }
}
