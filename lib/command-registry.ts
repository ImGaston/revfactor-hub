import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  Users,
  Building2,
  CheckSquare,
  ClipboardList,
  Calendar,
  MessageSquare,
  Lightbulb,
  Funnel,
  DollarSign,
  Settings,
  Plus,
} from "lucide-react"
import type { Resource, Action } from "@/lib/permissions"

export type CommandCategory = "pages" | "actions" | "settings"

export type CommandDef = {
  id: string
  label: string
  icon: LucideIcon
  category: CommandCategory
  href?: string
  keywords?: string[]
  permission?: { resource: Resource; action: Action }
  superAdminOnly?: boolean
  contextRoutes?: string[]
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const commands: CommandDef[] = [
  // --- Pages ---
  { id: "nav-dashboard", label: "Go to Dashboard", icon: LayoutDashboard, category: "pages", href: "/", keywords: ["home"] },
  { id: "nav-clients", label: "Go to Clients", icon: Users, category: "pages", href: "/clients", permission: { resource: "clients", action: "view" }, contextRoutes: ["/clients"] },
  { id: "nav-listings", label: "Go to Listings", icon: Building2, category: "pages", href: "/listings", permission: { resource: "listings", action: "view" }, contextRoutes: ["/listings"] },
  { id: "nav-tasks", label: "Go to Tasks", icon: CheckSquare, category: "pages", href: "/tasks", permission: { resource: "tasks", action: "view" }, contextRoutes: ["/tasks"] },
  { id: "nav-onboarding", label: "Go to Onboarding", icon: ClipboardList, category: "pages", href: "/onboarding", permission: { resource: "onboarding", action: "view" }, contextRoutes: ["/onboarding"] },
  { id: "nav-calendar", label: "Go to Calendar", icon: Calendar, category: "pages", href: "/calendar", permission: { resource: "calendar", action: "view" }, contextRoutes: ["/calendar"] },
  { id: "nav-notes", label: "Go to Notes", icon: MessageSquare, category: "pages", href: "/notes", permission: { resource: "notes", action: "view" }, contextRoutes: ["/notes"] },
  { id: "nav-roadmap", label: "Go to Ideas & Roadmap", icon: Lightbulb, category: "pages", href: "/roadmap", permission: { resource: "roadmap", action: "view" }, contextRoutes: ["/roadmap"] },
  { id: "nav-pipeline", label: "Go to Pipeline", icon: Funnel, category: "pages", href: "/pipeline", permission: { resource: "pipeline", action: "view" }, contextRoutes: ["/pipeline"] },
  { id: "nav-financials", label: "Go to Financials", icon: DollarSign, category: "pages", href: "/financials", superAdminOnly: true, contextRoutes: ["/financials"] },

  // --- Actions ---
  { id: "action-new-client", label: "New Client", icon: Plus, category: "actions", href: "/settings/clients", keywords: ["create", "add", "client"], permission: { resource: "clients", action: "create" }, contextRoutes: ["/clients"] },
  { id: "action-new-task", label: "New Task", icon: Plus, category: "actions", href: "/tasks", keywords: ["create", "add", "task"], permission: { resource: "tasks", action: "create" }, contextRoutes: ["/tasks"] },
  { id: "action-new-lead", label: "New Lead", icon: Plus, category: "actions", href: "/pipeline", keywords: ["create", "add", "lead", "pipeline"], permission: { resource: "pipeline", action: "create" }, contextRoutes: ["/pipeline"] },
  { id: "action-new-idea", label: "New Idea", icon: Plus, category: "actions", href: "/roadmap", keywords: ["create", "add", "idea", "roadmap"], permission: { resource: "roadmap", action: "create" }, contextRoutes: ["/roadmap"] },

  // --- Settings ---
  { id: "settings-account", label: "Account Settings", icon: Settings, category: "settings", href: "/settings/account", keywords: ["profile", "password", "avatar"] },
  { id: "settings-users", label: "Manage Users", icon: Users, category: "settings", href: "/settings/users", superAdminOnly: true, keywords: ["team", "invite"] },
  { id: "settings-roles", label: "Manage Roles & Permissions", icon: Settings, category: "settings", href: "/settings/roles", superAdminOnly: true, keywords: ["permissions", "access"] },
  { id: "settings-clients", label: "Client Settings", icon: Settings, category: "settings", href: "/settings/clients", permission: { resource: "clients", action: "edit" }, keywords: ["manage clients"] },
  { id: "settings-listings", label: "Listing Settings", icon: Settings, category: "settings", href: "/settings/listings", permission: { resource: "listings", action: "edit" }, keywords: ["manage listings", "pricelabs", "sync"] },
  { id: "settings-boards", label: "Boards & Tags Settings", icon: Settings, category: "settings", href: "/settings/boards-tags", permission: { resource: "settings", action: "edit" }, keywords: ["boards", "tags"] },
  { id: "settings-onboarding", label: "Onboarding Settings", icon: Settings, category: "settings", href: "/settings/onboarding", permission: { resource: "onboarding", action: "edit" }, keywords: ["onboarding", "steps", "template"] },
]

// ---------------------------------------------------------------------------
// Permission filter
// ---------------------------------------------------------------------------

export function filterCommandsByPermission(
  cmds: CommandDef[],
  permissionMap: Record<string, boolean>,
  isSuperAdmin: boolean,
): CommandDef[] {
  return cmds.filter((cmd) => {
    if (cmd.superAdminOnly && !isSuperAdmin) return false
    if (cmd.permission) {
      if (isSuperAdmin) return true
      return permissionMap[`${cmd.permission.resource}:${cmd.permission.action}`] ?? false
    }
    return true
  })
}
