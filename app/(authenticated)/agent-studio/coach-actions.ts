"use server"

import { NoObjectGeneratedError } from "ai"
import { z } from "zod"

import {
  AGENT_STUDIO_COACH_MODEL_ID,
  normalizeCoachScore,
  normalizeAgentWorkflow,
  type AgentCoachResult,
} from "@/lib/agent-studio-coach"
import { createAgentStudioCoach } from "@/lib/agent-studio-coach.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

const coachRunSchema = z.object({
  runId: z.string().uuid(),
})

type CoachPricing = {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  fetchedAt: string
}

const FALLBACK_COACH_PRICING: Omit<CoachPricing, "fetchedAt"> = {
  inputUsdPerMillion: 0.3,
  outputUsdPerMillion: 2.5,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : {}
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function clipped(value: unknown, maxLength: number): string {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? null)
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength)}…`
    : serialized
}

async function loadCoachPricing(): Promise<CoachPricing> {
  const fetchedAt = new Date().toISOString()
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Gateway catalog ${response.status}`)
    const payload = (await response.json()) as {
      data?: Array<{
        id?: string
        pricing?: { input?: string; output?: string }
      }>
    }
    const model = payload.data?.find(
      (candidate) => candidate.id === AGENT_STUDIO_COACH_MODEL_ID
    )
    const input = Number(model?.pricing?.input)
    const output = Number(model?.pricing?.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      throw new Error("Coach pricing is unavailable")
    }
    return {
      inputUsdPerMillion: input * 1_000_000,
      outputUsdPerMillion: output * 1_000_000,
      fetchedAt,
    }
  } catch {
    return { ...FALLBACK_COACH_PRICING, fetchedAt }
  }
}

function runSnapshot(
  run: Record<string, unknown>,
  messages: Map<string, string>
) {
  const feedback = firstRecord(run.agent_feedback)
  const requestId = stringValue(run.request_message_id)
  const responseId = stringValue(run.response_message_id)
  return {
    id: stringValue(run.id),
    createdAt: stringValue(run.created_at),
    modelId: stringValue(run.model_id),
    disposition: stringValue(run.disposition),
    confidence: stringValue(run.confidence),
    escalationReason: stringValue(run.escalation_reason),
    reviewNotes: Array.isArray(run.review_notes) ? run.review_notes : [],
    clientMessage: requestId ? messages.get(requestId) ?? null : null,
    draftReply: responseId ? messages.get(responseId) ?? null : null,
    feedback: {
      rating:
        typeof feedback.overall_rating === "number"
          ? feedback.overall_rating
          : null,
      correctedResponse: stringValue(feedback.corrected_response),
      notes: stringValue(feedback.notes),
      lessonAction: stringValue(feedback.lesson_action),
    },
  }
}

export async function coachAgentStudioRun(
  input: unknown
): Promise<AgentCoachResult> {
  const canCreate = await hasPermission("agent_studio", "create")
  if (!canCreate) {
    return { ok: false, error: "You cannot create Studio coaching reviews." }
  }

  const parsed = coachRunSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "The selected run is invalid." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Your session has expired." }

  const { data: anchorRun, error: anchorError } = await supabase
    .from("agent_runs")
    .select(
      `
        id, conversation_id, request_message_id, response_message_id,
        playbook_version_id, model_id, status, disposition, confidence,
        escalation_reason, review_notes, created_at,
        agent_conversations(title, source, client_id, synthetic_client),
        agent_feedback(
          overall_rating, corrected_response, notes, lesson_action
        )
      `
    )
    .eq("id", parsed.data.runId)
    .maybeSingle()

  if (anchorError || !anchorRun || anchorRun.status !== "completed") {
    return {
      ok: false,
      error: "Only a completed Agent Studio run can be coached.",
    }
  }

  let comparisonQuery = supabase
    .from("agent_runs")
    .select(
      `
        id, request_message_id, response_message_id, model_id, status,
        disposition, confidence, escalation_reason, review_notes, created_at,
        agent_feedback(
          overall_rating, corrected_response, notes, lesson_action
        )
      `
    )
    .eq("status", "completed")
    .neq("id", anchorRun.id)
    .order("created_at", { ascending: false })
    .limit(4)

  if (anchorRun.playbook_version_id) {
    comparisonQuery = comparisonQuery.eq(
      "playbook_version_id",
      anchorRun.playbook_version_id
    )
  } else if (anchorRun.disposition) {
    comparisonQuery = comparisonQuery.eq(
      "disposition",
      anchorRun.disposition
    )
  }

  const [{ data: comparisonRuns }, { data: sources }, playbookResult] =
    await Promise.all([
      comparisonQuery,
      supabase
        .from("agent_run_sources")
        .select("source_type, title, excerpt, payload, warning")
        .eq("run_id", anchorRun.id)
        .order("source_type"),
      anchorRun.playbook_version_id
        ? supabase
            .from("agent_playbook_versions")
            .select(
              "instructions, workflow, agent_playbooks(name, description)"
            )
            .eq("id", anchorRun.playbook_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const runs = [anchorRun, ...(comparisonRuns ?? [])]
  const messageIds = runs.flatMap((run) =>
    [run.request_message_id, run.response_message_id].filter(
      (id): id is string => typeof id === "string"
    )
  )
  const { data: messageRows } = messageIds.length
    ? await supabase
        .from("agent_messages")
        .select("id, content")
        .in("id", messageIds)
    : { data: [] }
  const messages = new Map(
    (messageRows ?? []).map((message) => [
      message.id,
      clipped(message.content, 5_000),
    ])
  )

  const playbook = firstRecord(playbookResult.data?.agent_playbooks)
  const comparisonSnapshots = (comparisonRuns ?? []).map((run) =>
    runSnapshot(run, messages)
  )
  const promptContext = {
    anchorRun: runSnapshot(anchorRun, messages),
    comparisonRuns: comparisonSnapshots,
    playbook: {
      name: stringValue(playbook.name) ?? "Session draft",
      description: stringValue(playbook.description),
      instructions: clipped(
        playbookResult.data?.instructions ?? "Custom session instructions",
        12_000
      ),
      workflow: playbookResult.data?.workflow ?? null,
    },
    anchorSources: (sources ?? []).map((source) => ({
      type: source.source_type,
      title: source.title,
      excerpt: source.excerpt,
      warning: source.warning,
      payloadExcerpt: clipped(source.payload, 6_000),
    })),
  }

  const startedAt = Date.now()
  const analyzedRunIds = runs.map((run) => run.id)
  try {
    const coach = createAgentStudioCoach({
      userId: user.id,
      anchorRunId: anchorRun.id,
    })
    const result = await coach.generate({
      prompt: `Review these Agent Studio runs and propose an editable process workflow.\n\n<studio_review_context>\n${JSON.stringify(
        promptContext,
        null,
        2
      )}\n</studio_review_context>`,
      timeout: { totalMs: 45_000, stepMs: 45_000 },
    })
    const pricing = await loadCoachPricing()
    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens:
        result.usage.totalTokens ??
        (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
    }
    const estimatedCostUsd =
      (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
      (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
    const durationMs = Date.now() - startedAt
    const output = {
      ...result.output,
      score: normalizeCoachScore(result.output.score),
      workflow: normalizeAgentWorkflow(result.output.workflow),
    }
    const { data: review, error: reviewError } = await supabase
      .from("agent_coach_reviews")
      .insert({
        anchor_run_id: anchorRun.id,
        comparison_run_ids: comparisonSnapshots.flatMap((run) =>
          run.id ? [run.id] : []
        ),
        model_id: AGENT_STUDIO_COACH_MODEL_ID,
        status: "completed",
        output,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        estimated_cost_usd: estimatedCostUsd,
        pricing_snapshot: pricing,
        duration_ms: durationMs,
        created_by: user.id,
      })
      .select("id, created_at")
      .single()

    if (reviewError || !review) {
      return {
        ok: false,
        error: reviewError?.message ?? "The coaching review could not be saved.",
      }
    }

    await supabase.from("agent_audit_events").insert({
      actor_id: user.id,
      action: "coach.review_created",
      entity_type: "agent_coach_review",
      entity_id: review.id,
      details: {
        anchorRunId: anchorRun.id,
        comparisonRunCount: comparisonSnapshots.length,
        modelId: AGENT_STUDIO_COACH_MODEL_ID,
        estimatedCostUsd,
      },
    })

    return {
      ok: true,
      review: {
        reviewId: review.id,
        modelId: AGENT_STUDIO_COACH_MODEL_ID,
        ...output,
        analyzedRunIds,
        usage: { ...usage, estimatedCostUsd },
        durationMs,
        createdAt: review.created_at,
      },
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const noObjectError = NoObjectGeneratedError.isInstance(error)
      ? error
      : null
    const pricing = await loadCoachPricing()
    const usage = {
      inputTokens: noObjectError?.usage?.inputTokens ?? 0,
      outputTokens: noObjectError?.usage?.outputTokens ?? 0,
      totalTokens:
        noObjectError?.usage?.totalTokens ??
        (noObjectError?.usage?.inputTokens ?? 0) +
          (noObjectError?.usage?.outputTokens ?? 0),
    }
    const estimatedCostUsd =
      (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
      (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
    const errorMessage =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "The coach model could not complete this review."
    await supabase.from("agent_coach_reviews").insert({
      anchor_run_id: anchorRun.id,
      comparison_run_ids: comparisonSnapshots.flatMap((run) =>
        run.id ? [run.id] : []
      ),
      model_id: AGENT_STUDIO_COACH_MODEL_ID,
      status: "failed",
      output: noObjectError
        ? {
            invalidOutput: clipped(noObjectError.text, 12_000),
            validationError: clipped(
              noObjectError.cause instanceof Error
                ? noObjectError.cause.message
                : null,
              4_000
            ),
            finishReason: noObjectError.finishReason,
          }
        : {},
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: estimatedCostUsd,
      pricing_snapshot: pricing,
      duration_ms: durationMs,
      error_message: errorMessage,
      created_by: user.id,
    })
    return {
      ok: false,
      error:
        "The Studio Coach could not complete this review. Try again or use fewer comparison runs.",
    }
  }
}
