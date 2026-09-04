// Shared constants, types, and pure functions — safe for client & server components

export const RESOURCES = [
  { key: "clients", label: "Clients", description: "Client profiles and contact information" },
  { key: "listings", label: "Listings", description: "Property listings and their links" },
  { key: "tasks", label: "Tasks", description: "Task board and assignments" },
  { key: "pipeline", label: "Pipeline", description: "Sales pipeline and leads" },
  { key: "roadmap", label: "Roadmap", description: "Projects and roadmap tasks" },
  { key: "onboarding", label: "Onboarding", description: "Client onboarding steps" },
  { key: "users", label: "Users", description: "User management and invitations" },
  { key: "settings", label: "Settings", description: "System settings and configuration" },
  { key: "financials", label: "Financials", description: "Billing, revenue, ADR, RevPAR data" },
  { key: "knowledge", label: "Knowledge", description: "Policies, SOPs, and internal knowledge base" },
  { key: "adjustments", label: "Adjustments", description: "Change requests, triage queue, and control" },
  { key: "agent_studio", label: "Agent Studio", description: "Test and configure the client service AI sandbox" },
  { key: "reservations", label: "Reservations", description: "PriceLabs booking data (read-only, synced from BigQuery)" },
  { key: "revenue", label: "Revenue Manager", description: "Revenue profiles, reviews, recommendations, and decisions" },
  { key: "market_signals", label: "Market Signals", description: "Governed market events, evidence, and revenue review queues" },
  { key: "wins", label: "Wins", description: "Positive-performance detection and client message drafts" },
  { key: "team_credentials", label: "Team Credentials", description: "Shared logins for team apps (PriceLabs, OTA extranets, ...)" },
  { key: "monthly_summary", label: "Monthly Summary", description: "Portfolio counts and new/churned listings per month" },
  { key: "ghl", label: "GoHighLevel", description: "GoHighLevel workflows and secure listing reviews" },
] as const

export const ACTIONS = ["view", "create", "edit", "delete", "publish", "control"] as const

export type Resource = (typeof RESOURCES)[number]["key"]
export type Action = (typeof ACTIONS)[number]

export type RolePermission = {
  id: string
  role_name: string
  resource: string
  action: string
  allowed: boolean
}

export type Role = {
  id: string
  name: string
  description: string | null
  is_system: boolean
  created_at: string
  updated_at: string
}

/**
 * Build a permission map { "resource:action": boolean } for quick lookups.
 */
export function buildPermissionMap(
  permissions: RolePermission[]
): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const p of permissions) {
    map[`${p.resource}:${p.action}`] = p.allowed
  }
  return map
}

/**
 * Check a permission from the map.
 */
export function checkPermission(
  map: Record<string, boolean>,
  resource: Resource,
  action: Action
): boolean {
  return map[`${resource}:${action}`] ?? false
}
