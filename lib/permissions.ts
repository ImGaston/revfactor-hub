// Shared constants, types, and pure functions — safe for client & server components

export const RESOURCES = [
  { key: "clients", label: "Clients", description: "Client profiles and contact information" },
  { key: "listings", label: "Listings", description: "Property listings and their links" },
  { key: "tasks", label: "Tasks", description: "Task board and assignments" },
  { key: "pipeline", label: "Pipeline", description: "Sales pipeline and leads" },
  { key: "roadmap", label: "Roadmap", description: "Ideas and roadmap items" },
  { key: "calendar", label: "Calendar", description: "Calendar events and scheduling" },
  { key: "notes", label: "Notes", description: "Internal notes and insights" },
  { key: "onboarding", label: "Onboarding", description: "Client onboarding steps" },
  { key: "users", label: "Users", description: "User management and invitations" },
  { key: "settings", label: "Settings", description: "System settings and configuration" },
  { key: "financials", label: "Financials", description: "Billing, revenue, ADR, RevPAR data" },
  { key: "knowledge", label: "Knowledge", description: "Policies, SOPs, and internal knowledge base" },
] as const

export const ACTIONS = ["view", "create", "edit", "delete", "publish"] as const

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
