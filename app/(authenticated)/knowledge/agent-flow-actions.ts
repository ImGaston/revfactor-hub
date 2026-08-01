"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  compileAgentFlow,
  DEFAULT_AGENT_FLOW_GRAPH,
  normalizeAgentFlowGraph,
  validateAgentFlowGraph,
} from "@/lib/agent-flows"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

const flowMetadataSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
})

const saveDraftSchema = flowMetadataSchema.extend({
  flowId: z.string().uuid(),
  versionId: z.string().uuid(),
  graph: z.unknown(),
  changeNote: z.string().trim().max(500).nullable().optional(),
})

const transitionSchema = z.object({
  versionId: z.string().uuid(),
  targetStatus: z.enum(["testing", "approved", "production", "archived"]),
})

type ActionResult<T extends Record<string, unknown> | undefined = undefined> =
  | (T extends Record<string, unknown> ? { ok: true } & T : { ok: true })
  | { ok: false; error: string }

async function authenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createAgentFlowAction(
  input: unknown
): Promise<ActionResult<{ flowId: string; versionId: string }>> {
  if (!(await hasPermission("knowledge", "create"))) {
    return {
      ok: false,
      error: "You do not have permission to create Agent Flows.",
    }
  }

  const parsed = flowMetadataSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Add a flow name between 2 and 120 characters." }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false, error: "Your session has expired." }

  const { data: flow, error: flowError } = await supabase
    .from("agent_flows")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single()

  if (flowError || !flow) {
    return {
      ok: false,
      error:
        flowError?.code === "23505"
          ? "An active Agent Flow already uses that name."
          : (flowError?.message ?? "The Agent Flow could not be created."),
    }
  }

  const graph = structuredClone(DEFAULT_AGENT_FLOW_GRAPH)
  const compiledInstructions = compileAgentFlow(parsed.data.name, 1, graph)
  const { data: version, error: versionError } = await supabase
    .from("agent_flow_versions")
    .insert({
      flow_id: flow.id,
      version: 1,
      status: "draft",
      graph,
      compiled_instructions: compiledInstructions,
      change_note: "Initial visual workflow",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (versionError || !version) {
    return {
      ok: false,
      error:
        versionError?.message ?? "The first flow version could not be created.",
    }
  }

  revalidatePath("/knowledge")
  return { ok: true, flowId: flow.id, versionId: version.id }
}

export async function saveAgentFlowDraftAction(
  input: unknown
): Promise<ActionResult<{ compiledInstructions: string }>> {
  if (!(await hasPermission("knowledge", "edit"))) {
    return {
      ok: false,
      error: "You do not have permission to edit Agent Flows.",
    }
  }

  const parsed = saveDraftSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "The flow draft is invalid." }
  }

  const graph = normalizeAgentFlowGraph(parsed.data.graph)
  const validation = validateAgentFlowGraph(graph)

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false, error: "Your session has expired." }

  const { data: version } = await supabase
    .from("agent_flow_versions")
    .select("version, status, flow_id")
    .eq("id", parsed.data.versionId)
    .eq("flow_id", parsed.data.flowId)
    .maybeSingle()

  if (!version)
    return { ok: false, error: "This Agent Flow version no longer exists." }
  if (version.status !== "draft") {
    return {
      ok: false,
      error: "Create a new draft before changing this version.",
    }
  }

  const compiledInstructions = validation.valid
    ? compileAgentFlow(parsed.data.name, Number(version.version), graph)
    : `[Agent Flow draft: ${parsed.data.name} v${Number(version.version)}]\nThis draft has ${validation.issues.length} validation issue(s) and cannot move to testing until they are resolved.`

  const { error: flowError } = await supabase
    .from("agent_flows")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      updated_by: user.id,
    })
    .eq("id", parsed.data.flowId)
  if (flowError) return { ok: false, error: flowError.message }

  const { error: versionError } = await supabase
    .from("agent_flow_versions")
    .update({
      graph,
      compiled_instructions: compiledInstructions,
      change_note: parsed.data.changeNote || null,
    })
    .eq("id", parsed.data.versionId)
    .eq("status", "draft")
  if (versionError) return { ok: false, error: versionError.message }

  revalidatePath(`/knowledge/flows/${parsed.data.flowId}`)
  revalidatePath("/knowledge")
  return { ok: true, compiledInstructions }
}

export async function createAgentFlowDraftVersionAction(
  sourceVersionId: string
): Promise<ActionResult<{ versionId: string }>> {
  if (!(await hasPermission("knowledge", "edit"))) {
    return {
      ok: false,
      error: "You do not have permission to version Agent Flows.",
    }
  }

  const parsedId = z.string().uuid().safeParse(sourceVersionId)
  if (!parsedId.success)
    return { ok: false, error: "The source version is invalid." }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false, error: "Your session has expired." }

  const { data: source } = await supabase
    .from("agent_flow_versions")
    .select("flow_id, version, graph, change_note")
    .eq("id", parsedId.data)
    .maybeSingle()
  if (!source) return { ok: false, error: "The source version was not found." }

  const [{ data: latest }, { data: flow }] = await Promise.all([
    supabase
      .from("agent_flow_versions")
      .select("version")
      .eq("flow_id", source.flow_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_flows")
      .select("name")
      .eq("id", source.flow_id)
      .maybeSingle(),
  ])
  if (!flow) return { ok: false, error: "The Agent Flow was not found." }

  const nextVersion = Number(latest?.version ?? 0) + 1
  const graph = normalizeAgentFlowGraph(source.graph)
  const validation = validateAgentFlowGraph(graph)
  const compiledInstructions = validation.valid
    ? compileAgentFlow(flow.name, nextVersion, graph)
    : `[Agent Flow draft: ${flow.name} v${nextVersion}]\nThis draft has ${validation.issues.length} validation issue(s) and cannot move to testing until they are resolved.`
  const { data: version, error } = await supabase
    .from("agent_flow_versions")
    .insert({
      flow_id: source.flow_id,
      version: nextVersion,
      status: "draft",
      graph,
      compiled_instructions: compiledInstructions,
      change_note: `Drafted from version ${Number(source.version)}`,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !version) {
    return {
      ok: false,
      error: error?.message ?? "The draft version could not be created.",
    }
  }

  revalidatePath(`/knowledge/flows/${source.flow_id}`)
  revalidatePath("/knowledge")
  return { ok: true, versionId: version.id }
}

export async function transitionAgentFlowVersionAction(
  input: unknown
): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: "The requested transition is invalid." }

  const requiredPermissions: Array<Promise<boolean>> = []
  if (
    parsed.data.targetStatus === "approved" ||
    parsed.data.targetStatus === "production"
  ) {
    requiredPermissions.push(hasPermission("knowledge", "publish"))
  } else {
    requiredPermissions.push(hasPermission("knowledge", "edit"))
  }
  if (parsed.data.targetStatus === "production") {
    requiredPermissions.push(hasPermission("agent_studio", "control"))
  }
  if (!(await Promise.all(requiredPermissions)).every(Boolean)) {
    return {
      ok: false,
      error:
        parsed.data.targetStatus === "production"
          ? "Knowledge publishing and Agent Studio control permissions are required."
          : parsed.data.targetStatus === "approved"
            ? "Knowledge publishing permission is required."
            : "Knowledge editing permission is required.",
    }
  }

  const { supabase, user } = await authenticatedUser()
  if (!user) return { ok: false, error: "Your session has expired." }

  const { data: version } = await supabase
    .from("agent_flow_versions")
    .select("flow_id, graph, status")
    .eq("id", parsed.data.versionId)
    .maybeSingle()
  if (!version)
    return { ok: false, error: "The Agent Flow version was not found." }

  if (
    parsed.data.targetStatus === "archived" &&
    version.status === "production" &&
    !(await hasPermission("agent_studio", "control"))
  ) {
    return {
      ok: false,
      error:
        "Agent Studio control permission is required to archive production.",
    }
  }

  if (parsed.data.targetStatus !== "archived") {
    const validation = validateAgentFlowGraph(version.graph)
    if (!validation.valid) {
      return {
        ok: false,
        error: validation.issues[0]?.message ?? "The flow is invalid.",
      }
    }
  }

  const { error } = await supabase.rpc("transition_agent_flow_version", {
    p_version_id: parsed.data.versionId,
    p_target_status: parsed.data.targetStatus,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/knowledge/flows/${version.flow_id}`)
  revalidatePath("/knowledge")
  return { ok: true }
}
