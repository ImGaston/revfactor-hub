import { redirect } from "next/navigation"

import {
  SYNTHETIC_CLIENT_ID,
  type AgentStudioClientOption,
} from "@/lib/agent-studio"
import { loadAgentStudioGovernance } from "@/lib/agent-studio-governance.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { AgentStudioShell } from "./agent-studio-shell"

export default async function AgentStudioPage() {
  const canUseStudio = await hasPermission("agent_studio", "view")
  if (!canUseStudio) redirect("/")

  const canViewClients = await hasPermission("clients", "view")
  const supabase = await createClient()

  const [{ data: clients }, governance] = await Promise.all([
    canViewClients
      ? supabase
          .from("clients")
          .select("id, name, status")
          .eq("status", "active")
          .order("name")
          .limit(250)
      : Promise.resolve({ data: [] }),
    loadAgentStudioGovernance(),
  ])

  const clientOptions: AgentStudioClientOption[] = [
    {
      id: SYNTHETIC_CLIENT_ID,
      name: "Harbor & Pine Stays",
      status: "Synthetic sandbox",
      synthetic: true,
    },
    ...(clients ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
    })),
  ]

  const gatewayConfigured = Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL
  )

  return (
    <AgentStudioShell
      clients={clientOptions}
      gatewayConfigured={gatewayConfigured}
      governance={governance}
    />
  )
}
