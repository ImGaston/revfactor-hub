import { notFound } from "next/navigation"

import {
  normalizeAgentFlowGraph,
  type AgentFlowStatus,
} from "@/lib/agent-flows"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { AgentFlowBuilder } from "./agent-flow-builder"

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ version?: string }>
}

export default async function AgentFlowPage({ params, searchParams }: Props) {
  const [{ id: flowId }, query] = await Promise.all([params, searchParams])
  const supabase = await createClient()

  const [{ data: flow }, { data: versionsRaw }, { data: eventsRaw }] =
    await Promise.all([
      supabase
        .from("agent_flows")
        .select("id, name, description, created_at, updated_at, archived_at")
        .eq("id", flowId)
        .maybeSingle(),
      supabase
        .from("agent_flow_versions")
        .select(
          "id, flow_id, version, status, graph, compiled_instructions, change_note, created_at, updated_at, approved_at, promoted_at"
        )
        .eq("flow_id", flowId)
        .order("version", { ascending: false }),
      supabase
        .from("agent_flow_events")
        .select("id, version_id, event_type, details, created_at")
        .eq("flow_id", flowId)
        .order("created_at", { ascending: false })
        .limit(20),
    ])

  if (!flow) notFound()
  const versions = (versionsRaw ?? []).map((version) => ({
    ...version,
    version: Number(version.version),
    status: version.status as AgentFlowStatus,
    graph: normalizeAgentFlowGraph(version.graph),
    compiled_instructions: version.compiled_instructions ?? "",
  }))
  const selectedVersion =
    versions.find((version) => version.id === query.version) ?? versions[0]
  if (!selectedVersion) notFound()

  const [canEdit, canPublish, canControl] = await Promise.all([
    hasPermission("knowledge", "edit"),
    hasPermission("knowledge", "publish"),
    hasPermission("agent_studio", "control"),
  ])

  return (
    <AgentFlowBuilder
      flow={flow}
      version={selectedVersion}
      versions={versions.map(({ id, version, status, updated_at }) => ({
        id,
        version,
        status,
        updated_at,
      }))}
      events={(eventsRaw ?? []).map((event) => ({
        ...event,
        details:
          event.details && typeof event.details === "object"
            ? (event.details as Record<string, unknown>)
            : {},
      }))}
      permissions={{ canEdit, canPublish, canControl }}
    />
  )
}
