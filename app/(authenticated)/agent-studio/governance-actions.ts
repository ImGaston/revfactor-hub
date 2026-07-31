"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  DEFAULT_AGENT_STUDIO_INSTRUCTIONS,
  SYNTHETIC_CLIENT_ID,
  isAgentStudioModelId,
  type AgentStudioModelId,
} from "@/lib/agent-studio"
import { getAgentStudioPricing } from "@/lib/agent-studio-pricing.server"
import {
  getAssemblyClient,
  getClientChannels,
  isAssemblyConfigured,
  listAssemblyMessages,
} from "@/lib/assembly"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { runAgentStudio } from "./actions"

const redactShadowText = (value: string) =>
  value
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted email]"
    )
    .replace(
      /(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g,
      "[redacted phone]"
    )
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[redacted URL]")

const savePlaybookSchema = z.object({
  playbookId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().trim().min(20).max(12_000),
  modelId: z.string().min(1).max(100),
  maxInputTokens: z.number().int().min(1_000).max(1_000_000),
  maxOutputTokens: z.number().int().min(100).max(10_000),
  maxRunCostUsd: z.number().positive().max(100),
  changeNote: z.string().trim().max(500).nullable().optional(),
})

const feedbackSchema = z.object({
  runId: z.string().uuid(),
  conversationId: z.string().uuid(),
  overallRating: z.number().int().min(1).max(5),
  factualAccuracy: z.number().int().min(1).max(5).nullable().optional(),
  tone: z.number().int().min(1).max(5).nullable().optional(),
  helpfulness: z.number().int().min(1).max(5).nullable().optional(),
  safety: z.number().int().min(1).max(5).nullable().optional(),
  contextUse: z.number().int().min(1).max(5).nullable().optional(),
  expectedDisposition: z
    .enum(["answer", "clarify", "escalate"])
    .nullable()
    .optional(),
  correctedResponse: z.string().trim().max(20_000).nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
  lessonAction: z
    .enum([
      "none",
      "example",
      "knowledge",
      "instruction",
      "regression",
      "data_issue",
    ])
    .default("none"),
})

const settingsSchema = z.object({
  maxInputTokens: z.number().int().min(1_000).max(1_000_000),
  maxOutputTokens: z.number().int().min(100).max(10_000),
  maxRunCostUsd: z.number().positive().max(100),
  maxRunDurationMs: z.number().int().min(5_000).max(300_000),
  dailyBudgetUsd: z.number().positive().max(10_000),
  monthlyBudgetUsd: z.number().positive().max(100_000),
  retentionDays: z.number().int().min(7).max(730),
  assemblyContextMessages: z.number().int().min(5).max(100),
  requireSendApproval: z.boolean(),
})

async function authenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {}
) {
  const supabase = await createClient()
  await supabase.from("agent_audit_events").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  })
}

export async function savePlaybookVersionAction(input: unknown) {
  const canCreate = await hasPermission("agent_studio", "create")
  if (!canCreate) return { ok: false as const, error: "You cannot create playbooks." }

  const parsed = savePlaybookSchema.safeParse(input)
  if (!parsed.success || !isAgentStudioModelId(parsed.data.modelId)) {
    return { ok: false as const, error: "The playbook configuration is invalid." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  let playbookId = parsed.data.playbookId ?? null
  if (!playbookId) {
    const { data: playbook, error } = await supabase
      .from("agent_playbooks")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || null,
        created_by: user.id,
      })
      .select("id")
      .single()
    if (error || !playbook) {
      return { ok: false as const, error: error?.message ?? "Playbook creation failed." }
    }
    playbookId = playbook.id
  } else {
    const canEdit = await hasPermission("agent_studio", "edit")
    if (!canEdit) return { ok: false as const, error: "You cannot edit playbooks." }
    await supabase
      .from("agent_playbooks")
      .update({
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .eq("id", playbookId)
  }

  const { data: latest } = await supabase
    .from("agent_playbook_versions")
    .select("version")
    .eq("playbook_id", playbookId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = Number(latest?.version ?? 0) + 1

  const { data: version, error } = await supabase
    .from("agent_playbook_versions")
    .insert({
      playbook_id: playbookId,
      version: nextVersion,
      status: "draft",
      instructions: parsed.data.instructions,
      model_id: parsed.data.modelId,
      allowed_tools: ["searchKnowledge"],
      max_input_tokens: parsed.data.maxInputTokens,
      max_output_tokens: parsed.data.maxOutputTokens,
      max_run_cost_usd: parsed.data.maxRunCostUsd,
      change_note: parsed.data.changeNote || null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !version) {
    return { ok: false as const, error: error?.message ?? "Version creation failed." }
  }

  await audit(user.id, "playbook.version_created", "agent_playbook_version", version.id, {
    playbookId,
    version: nextVersion,
    modelId: parsed.data.modelId,
  })
  revalidatePath("/agent-studio")
  return { ok: true as const, id: version.id }
}

export async function movePlaybookVersionAction(
  versionId: string,
  status: "testing" | "approved" | "archived"
) {
  const requiredAction = status === "approved" ? "publish" : "edit"
  const allowed = await hasPermission("agent_studio", requiredAction)
  if (!allowed) {
    return {
      ok: false as const,
      error:
        status === "approved"
          ? "Publishing permission is required."
          : "Editing permission is required.",
    }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { error } = await supabase
    .from("agent_playbook_versions")
    .update({ status })
    .eq("id", versionId)
  if (error) return { ok: false as const, error: error.message }

  await audit(user.id, `playbook.${status}`, "agent_playbook_version", versionId)
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

export async function requestProductionApprovalAction(
  playbookVersionId: string,
  rationale: string
) {
  const canEdit = await hasPermission("agent_studio", "edit")
  if (!canEdit) return { ok: false as const, error: "Editing permission is required." }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { data: version } = await supabase
    .from("agent_playbook_versions")
    .select("id, status")
    .eq("id", playbookVersionId)
    .maybeSingle()
  if (!version || version.status !== "approved") {
    return {
      ok: false as const,
      error: "Only an approved playbook version can request production promotion.",
    }
  }

  const { data: request, error } = await supabase
    .from("agent_approval_requests")
    .insert({
      request_type: "promote_production",
      playbook_version_id: playbookVersionId,
      rationale: rationale.trim() || null,
      requested_by: user.id,
    })
    .select("id")
    .single()
  if (error || !request) {
    return { ok: false as const, error: error?.message ?? "Approval request failed." }
  }

  await audit(user.id, "approval.requested", "agent_approval_request", request.id, {
    playbookVersionId,
  })
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

export async function decideApprovalAction(
  approvalId: string,
  decision: "approved" | "rejected",
  note: string
) {
  const canControl = await hasPermission("agent_studio", "control")
  if (!canControl) {
    return { ok: false as const, error: "Production-control permission is required." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { data: request } = await supabase
    .from("agent_approval_requests")
    .select("requested_by, status")
    .eq("id", approvalId)
    .maybeSingle()
  if (!request || request.status !== "pending") {
    return { ok: false as const, error: "This approval is no longer pending." }
  }
  if (request.requested_by === user.id) {
    return {
      ok: false as const,
      error: "A different team member must decide this approval.",
    }
  }

  const { error } = await supabase
    .from("agent_approval_requests")
    .update({
      status: decision,
      decision_note: note.trim() || null,
    })
    .eq("id", approvalId)
  if (error) return { ok: false as const, error: error.message }

  await audit(user.id, `approval.${decision}`, "agent_approval_request", approvalId)
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

export async function promotePlaybookToProductionAction(
  playbookVersionId: string
) {
  const canControl = await hasPermission("agent_studio", "control")
  if (!canControl) {
    return { ok: false as const, error: "Production-control permission is required." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { data: approval } = await supabase
    .from("agent_approval_requests")
    .select("id, requested_by, decided_by, status, expires_at")
    .eq("request_type", "promote_production")
    .eq("playbook_version_id", playbookVersionId)
    .eq("status", "approved")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (
    !approval ||
    !approval.decided_by ||
    approval.requested_by === approval.decided_by
  ) {
    return {
      ok: false as const,
      error: "A valid two-person approval is required before production promotion.",
    }
  }

  const { error } = await supabase
    .from("agent_playbook_versions")
    .update({ status: "production" })
    .eq("id", playbookVersionId)
    .eq("status", "approved")
  if (error) return { ok: false as const, error: error.message }

  await audit(
    user.id,
    "playbook.production",
    "agent_playbook_version",
    playbookVersionId,
    { approvalId: approval.id }
  )
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

export async function submitRunFeedbackAction(input: unknown) {
  const canCreate = await hasPermission("agent_studio", "create")
  if (!canCreate) return { ok: false as const, error: "You cannot rate Studio runs." }

  const parsed = feedbackSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: "The feedback is invalid." }
  }
  if (
    parsed.data.lessonAction === "knowledge" &&
    !parsed.data.correctedResponse
  ) {
    return {
      ok: false as const,
      error: "Add the corrected client answer before creating a Knowledge draft.",
    }
  }
  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { error } = await supabase.from("agent_feedback").upsert(
    {
      run_id: parsed.data.runId,
      conversation_id: parsed.data.conversationId,
      overall_rating: parsed.data.overallRating,
      factual_accuracy: parsed.data.factualAccuracy ?? null,
      tone: parsed.data.tone ?? null,
      helpfulness: parsed.data.helpfulness ?? null,
      safety: parsed.data.safety ?? null,
      context_use: parsed.data.contextUse ?? null,
      expected_disposition: parsed.data.expectedDisposition ?? null,
      corrected_response: parsed.data.correctedResponse || null,
      notes: parsed.data.notes || null,
      lesson_action: parsed.data.lessonAction,
      created_by: user.id,
    },
    { onConflict: "run_id,created_by" }
  )
  if (error) return { ok: false as const, error: error.message }

  if (parsed.data.lessonAction === "regression") {
    const [{ data: run }, { data: messages }] = await Promise.all([
      supabase
        .from("agent_runs")
        .select("input_snapshot, disposition")
        .eq("id", parsed.data.runId)
        .maybeSingle(),
      supabase
        .from("agent_messages")
        .select("role, content")
        .eq("conversation_id", parsed.data.conversationId)
        .order("created_at"),
    ])

    await supabase.from("agent_evaluation_cases").insert({
      name: `Regression from run ${parsed.data.runId.slice(0, 8)}`,
      description: parsed.data.notes || "Created from Studio feedback.",
      case_type: "regression",
      messages: messages ?? [],
      frozen_source_snapshot: run?.input_snapshot ?? null,
      expected_disposition:
        parsed.data.expectedDisposition ?? run?.disposition ?? null,
      rubric: parsed.data.correctedResponse
        ? `Prefer behavior consistent with this reviewed answer: ${parsed.data.correctedResponse}`
        : parsed.data.notes || null,
      created_from_conversation_id: parsed.data.conversationId,
      created_by: user.id,
    })
  }

  if (parsed.data.lessonAction === "knowledge") {
    const canCreateKnowledge = await hasPermission("knowledge", "create")
    if (!canCreateKnowledge) {
      return {
        ok: false as const,
        error: "You cannot create Knowledge drafts.",
      }
    }
    const { data: latestUserMessage } = await supabase
      .from("agent_messages")
      .select("content")
      .eq("conversation_id", parsed.data.conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const question = redactShadowText(
      latestUserMessage?.content || "Studio-reviewed client question"
    ).slice(0, 240)
    const title = `FAQ · ${question}`.slice(0, 120)
    const slug = `studio-faq-${parsed.data.runId.slice(0, 8)}`
    const { data: article, error: articleError } = await supabase
      .from("knowledge_articles")
      .insert({
        title,
        slug,
        excerpt: parsed.data.notes || question,
        content_html: "",
        author_id: user.id,
        status: "draft",
        article_type: "faq",
        audience: "client_safe",
        canonical_question: question,
        approved_answer: redactShadowText(
          parsed.data.correctedResponse || ""
        ),
        escalation_guidance: null,
        source_notes: `Created from reviewed Agent Studio run ${parsed.data.runId.slice(0, 8)}.`,
        review_status: "needs_review",
        agent_enabled: false,
      })
      .select("id")
      .single()
    if (articleError || !article) {
      return {
        ok: false as const,
        error: articleError?.message ?? "Knowledge draft creation failed.",
      }
    }
    const { data: faqTag } = await supabase
      .from("knowledge_tags")
      .select("id")
      .eq("name", "FAQ")
      .maybeSingle()
    if (faqTag) {
      await supabase.from("knowledge_article_tags").insert({
        article_id: article.id,
        tag_id: faqTag.id,
      })
    }
    await audit(
      user.id,
      "knowledge.draft_created",
      "knowledge_article",
      article.id,
      { runId: parsed.data.runId }
    )
  }

  await audit(user.id, "feedback.saved", "agent_run", parsed.data.runId, {
    rating: parsed.data.overallRating,
    lessonAction: parsed.data.lessonAction,
  })
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

function normalizeCaseMessages(
  value: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return []
    }
    const role = "role" in item ? item.role : null
    const content = "content" in item ? item.content : null
    return (role === "user" || role === "assistant") &&
      typeof content === "string"
      ? [{ role, content }]
      : []
  })
}

export async function runEvaluationCaseAction(input: {
  caseId: string
  playbookVersionId: string
  modelIds: string[]
}) {
  const canCreate = await hasPermission("agent_studio", "create")
  if (!canCreate) return { ok: false as const, error: "You cannot run evaluations." }
  if (
    !z.string().uuid().safeParse(input.caseId).success ||
    !z.string().uuid().safeParse(input.playbookVersionId).success ||
    input.modelIds.length < 1 ||
    input.modelIds.length > 4 ||
    !input.modelIds.every(isAgentStudioModelId)
  ) {
    return { ok: false as const, error: "The evaluation configuration is invalid." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { data: evaluationCase } = await supabase
    .from("agent_evaluation_cases")
    .select("*")
    .eq("id", input.caseId)
    .eq("active", true)
    .maybeSingle()
  if (!evaluationCase) {
    return { ok: false as const, error: "The evaluation case is unavailable." }
  }

  const messages = normalizeCaseMessages(evaluationCase.messages)
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user")
  if (lastUserIndex < 0) {
    return { ok: false as const, error: "The evaluation case has no user message." }
  }

  const { data: batch, error: batchError } = await supabase
    .from("agent_evaluation_batches")
    .insert({
      name: `${evaluationCase.name} · ${new Date().toLocaleDateString()}`,
      playbook_version_id: input.playbookVersionId,
      model_ids: input.modelIds,
      status: "running",
      total_cases: input.modelIds.length,
      created_by: user.id,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (batchError || !batch) {
    return { ok: false as const, error: batchError?.message ?? "Evaluation could not start." }
  }

  let passedCases = 0
  let completedCases = 0
  let totalCostUsd = 0

  for (const rawModelId of input.modelIds) {
    const modelId = rawModelId as AgentStudioModelId
    const result = await runAgentStudio({
      clientId: evaluationCase.synthetic_client
        ? SYNTHETIC_CLIENT_ID
        : evaluationCase.client_id,
      modelId,
      playbookVersionId: input.playbookVersionId,
      instructions: DEFAULT_AGENT_STUDIO_INSTRUCTIONS,
      message: messages[lastUserIndex].content,
      history: messages.slice(0, lastUserIndex),
      frozenSourceSnapshot: evaluationCase.frozen_source_snapshot ?? undefined,
    })

    let passed = false
    let dispositionMatch = false
    let notes = ""
    let runId: string | null = null

    if (result.ok) {
      runId = result.run.id
      totalCostUsd += result.run.usage.estimatedCostUsd
      dispositionMatch =
        !evaluationCase.expected_disposition ||
        result.run.disposition === evaluationCase.expected_disposition
      const lowerReply = result.run.reply.toLowerCase()
      const includesRequired = (
        evaluationCase.expected_must_include ?? []
      ).every((term: string) => lowerReply.includes(term.toLowerCase()))
      const excludesForbidden = (
        evaluationCase.expected_must_not_include ?? []
      ).every((term: string) => !lowerReply.includes(term.toLowerCase()))
      passed = dispositionMatch && includesRequired && excludesForbidden
      notes = [
        dispositionMatch ? "Disposition matched." : "Disposition differed.",
        includesRequired ? "Required content present." : "Required content missing.",
        excludesForbidden
          ? "Forbidden content absent."
          : "Forbidden content detected.",
      ].join(" ")

      if (result.run.conversationId) {
        await supabase
          .from("agent_conversations")
          .update({ source: evaluationCase.case_type === "shadow" ? "shadow" : "evaluation" })
          .eq("id", result.run.conversationId)
      }
    } else {
      notes = result.error
    }

    if (passed) passedCases += 1
    completedCases += 1
    await supabase.from("agent_evaluation_results").insert({
      batch_id: batch.id,
      case_id: evaluationCase.id,
      run_id: runId,
      model_id: modelId,
      passed,
      score: passed ? 100 : 0,
      disposition_match: dispositionMatch,
      rubric_notes: notes,
    })
    await supabase
      .from("agent_evaluation_batches")
      .update({
        completed_cases: completedCases,
        passed_cases: passedCases,
        total_cost_usd: totalCostUsd,
      })
      .eq("id", batch.id)
  }

  await supabase
    .from("agent_evaluation_batches")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_cases: completedCases,
      passed_cases: passedCases,
      total_cost_usd: totalCostUsd,
    })
    .eq("id", batch.id)

  await audit(user.id, "evaluation.completed", "agent_evaluation_batch", batch.id, {
    caseId: evaluationCase.id,
    modelIds: input.modelIds,
    passedCases,
    totalCases: input.modelIds.length,
    totalCostUsd,
  })
  revalidatePath("/agent-studio")
  return {
    ok: true as const,
    batchId: batch.id,
    passedCases,
    totalCases: input.modelIds.length,
  }
}

export async function createShadowCaseAction(clientId: string) {
  const [canCreate, canViewClients] = await Promise.all([
    hasPermission("agent_studio", "create"),
    hasPermission("clients", "view"),
  ])
  if (!canCreate || !canViewClients) {
    return { ok: false as const, error: "You cannot create shadow cases." }
  }
  if (!isAssemblyConfigured()) {
    return { ok: false as const, error: "Assembly is not configured." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, assembly_client_id")
    .eq("id", clientId)
    .eq("status", "active")
    .maybeSingle()
  if (!client?.assembly_client_id) {
    return { ok: false as const, error: "This client is not linked to Assembly." }
  }

  const channels = await getClientChannels(client.assembly_client_id)
  const channel = [...channels.company, ...(channels.individual ? [channels.individual] : [])]
    .sort((a, b) =>
      (b.lastMessageDate ?? b.updatedAt).localeCompare(
        a.lastMessageDate ?? a.updatedAt
      )
    )[0]
  if (!channel) return { ok: false as const, error: "No Assembly channel was found." }

  const response = await listAssemblyMessages(channel.id, { limit: 50 })
  const chronological = (response.data ?? []).slice().reverse()
  let incoming: (typeof chronological)[number] | null = null
  let actualReply: (typeof chronological)[number] | null = null
  for (let index = chronological.length - 1; index > 0; index -= 1) {
    const candidateReply = chronological[index]
    const candidateIncoming = chronological[index - 1]
    if (
      candidateReply.senderId !== client.assembly_client_id &&
      candidateIncoming.senderId === client.assembly_client_id
    ) {
      incoming = candidateIncoming
      actualReply = candidateReply
      break
    }
  }
  if (!incoming || !actualReply) {
    return {
      ok: false as const,
      error: "No recent client-message/team-reply pair was found.",
    }
  }

  const { data: evaluationCase, error } = await supabase
    .from("agent_evaluation_cases")
    .insert({
      name: `Shadow replay · ${client.name} · ${new Date(incoming.createdAt).toLocaleDateString()}`,
      description:
        "Replays a real incoming Assembly message without sending the generated draft.",
      case_type: "shadow",
      client_id: client.id,
      synthetic_client: false,
      messages: [{ role: "user", content: redactShadowText(incoming.text) }],
      frozen_source_snapshot: {
        incomingAssemblyMessageId: incoming.id,
        actualTeamReplyId: actualReply.id,
        actualTeamReply: redactShadowText(actualReply.text),
        sourceCapturedAt: new Date().toISOString(),
      },
      rubric:
        "Compare the generated draft with the actual RevFactor team reply captured in the frozen source snapshot.",
      created_by: user.id,
    })
    .select("id")
    .single()
  if (error || !evaluationCase) {
    return { ok: false as const, error: error?.message ?? "Shadow case creation failed." }
  }

  await audit(user.id, "shadow_case.created", "agent_evaluation_case", evaluationCase.id, {
    clientId: client.id,
  })
  revalidatePath("/agent-studio")
  return { ok: true as const, id: evaluationCase.id }
}

export async function checkStudioIntegrationsAction() {
  const canView = await hasPermission("agent_studio", "view")
  if (!canView) return { ok: false as const, error: "You do not have access." }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const checks: Array<{
    integration: "assembly" | "pricelabs" | "ai_gateway"
    status: "connected" | "stale" | "partial" | "unavailable"
    latency_ms: number
    last_source_update_at: string | null
    details: Record<string, unknown>
    checked_by: string
  }> = []

  let startedAt = Date.now()
  try {
    const pricing = await getAgentStudioPricing()
    checks.push({
      integration: "ai_gateway",
      status:
        pricing.length > 0 &&
        Boolean(
          process.env.AI_GATEWAY_API_KEY ||
            process.env.VERCEL_OIDC_TOKEN ||
            process.env.VERCEL
        )
          ? "connected"
          : "partial",
      latency_ms: Date.now() - startedAt,
      last_source_update_at: pricing[0]?.fetchedAt ?? null,
      details: {
        configured: Boolean(
          process.env.AI_GATEWAY_API_KEY ||
            process.env.VERCEL_OIDC_TOKEN ||
            process.env.VERCEL
        ),
        comparisonModels: pricing.length,
      },
      checked_by: user.id,
    })
  } catch {
    checks.push({
      integration: "ai_gateway",
      status: "unavailable",
      latency_ms: Date.now() - startedAt,
      last_source_update_at: null,
      details: { configured: false },
      checked_by: user.id,
    })
  }

  startedAt = Date.now()
  const { data: listings } = await supabase
    .from("listings")
    .select("id, pl_synced_at")
    .eq("status", "active")
    .order("pl_synced_at", { ascending: false, nullsFirst: false })
    .limit(500)
  const syncedListings = (listings ?? []).filter((listing) => listing.pl_synced_at)
  const latestPriceLabsSync = syncedListings[0]?.pl_synced_at ?? null
  const stalePriceLabs =
    !latestPriceLabsSync ||
    Date.now() - new Date(latestPriceLabsSync).getTime() > 36 * 60 * 60 * 1_000
  checks.push({
    integration: "pricelabs",
    status: !process.env.PRICELABS_API_KEY
      ? "unavailable"
      : syncedListings.length < (listings?.length ?? 0)
        ? "partial"
        : stalePriceLabs
          ? "stale"
          : "connected",
    latency_ms: Date.now() - startedAt,
    last_source_update_at: latestPriceLabsSync,
    details: {
      configured: Boolean(process.env.PRICELABS_API_KEY),
      activeListings: listings?.length ?? 0,
      syncedListings: syncedListings.length,
      staleAfterHours: 36,
    },
    checked_by: user.id,
  })

  startedAt = Date.now()
  let assemblyStatus: "connected" | "partial" | "unavailable" =
    isAssemblyConfigured() ? "partial" : "unavailable"
  const { data: linkedClient } = await supabase
    .from("clients")
    .select("assembly_client_id")
    .eq("status", "active")
    .not("assembly_client_id", "is", null)
    .limit(1)
    .maybeSingle()
  if (isAssemblyConfigured() && linkedClient?.assembly_client_id) {
    const assemblyClient = await getAssemblyClient(linkedClient.assembly_client_id)
    assemblyStatus = assemblyClient ? "connected" : "partial"
  }
  checks.push({
    integration: "assembly",
    status: assemblyStatus,
    latency_ms: Date.now() - startedAt,
    last_source_update_at: null,
    details: {
      configured: isAssemblyConfigured(),
      linkedClientProbe: Boolean(linkedClient?.assembly_client_id),
      readOnly: true,
    },
    checked_by: user.id,
  })

  const { error } = await supabase.from("agent_integration_checks").insert(checks)
  if (error) return { ok: false as const, error: error.message }

  await audit(user.id, "integrations.checked", "agent_studio", null, {
    statuses: Object.fromEntries(
      checks.map((check) => [check.integration, check.status])
    ),
  })
  revalidatePath("/agent-studio")
  return { ok: true as const }
}

export async function updateStudioSettingsAction(input: unknown) {
  const canControl = await hasPermission("agent_studio", "control")
  if (!canControl) {
    return { ok: false as const, error: "Production-control permission is required." }
  }
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: "The Studio policy settings are invalid." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false as const, error: "Your session has expired." }

  const { error } = await supabase
    .from("agent_studio_settings")
    .update({
      max_input_tokens: parsed.data.maxInputTokens,
      max_output_tokens: parsed.data.maxOutputTokens,
      max_run_cost_usd: parsed.data.maxRunCostUsd,
      max_run_duration_ms: parsed.data.maxRunDurationMs,
      daily_budget_usd: parsed.data.dailyBudgetUsd,
      monthly_budget_usd: parsed.data.monthlyBudgetUsd,
      retention_days: parsed.data.retentionDays,
      assembly_context_messages: parsed.data.assemblyContextMessages,
      require_send_approval: parsed.data.requireSendApproval,
      updated_by: user.id,
    })
    .eq("id", true)
  if (error) return { ok: false as const, error: error.message }

  await audit(user.id, "settings.updated", "agent_studio_settings", "true", {
    retentionDays: parsed.data.retentionDays,
    maxRunCostUsd: parsed.data.maxRunCostUsd,
    dailyBudgetUsd: parsed.data.dailyBudgetUsd,
    monthlyBudgetUsd: parsed.data.monthlyBudgetUsd,
  })
  revalidatePath("/agent-studio")
  return { ok: true as const }
}
