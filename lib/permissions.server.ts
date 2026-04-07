// Server-only permission functions — uses next/headers via Supabase server client
import { createClient } from "@/lib/supabase/server"
import type { Role, RolePermission, Resource, Action } from "@/lib/permissions"

/**
 * Server-side: Check if the current user's role has a specific permission.
 * super_admin always returns true.
 */
export async function hasPermission(
  resource: Resource,
  action: Action
): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (!profile) return false

  // super_admin always has all permissions
  if (profile.role === "super_admin") return true

  const { data: perm } = await supabase
    .from("role_permissions")
    .select("allowed")
    .eq("role_name", profile.role)
    .eq("resource", resource)
    .eq("action", action)
    .single()

  return perm?.allowed ?? false
}

/**
 * Server-side: Get all permissions for a specific role.
 */
export async function getRolePermissions(
  roleName: string
): Promise<RolePermission[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("role_permissions")
    .select("*")
    .eq("role_name", roleName)
    .order("resource")
    .order("action")

  return data ?? []
}

/**
 * Server-side: Get all roles with their permissions.
 */
export async function getAllRolesWithPermissions(): Promise<
  (Role & { permissions: RolePermission[] })[]
> {
  const supabase = await createClient()

  const [{ data: roles }, { data: permissions }] = await Promise.all([
    supabase.from("roles").select("*").order("is_system", { ascending: false }).order("name"),
    supabase.from("role_permissions").select("*").order("resource").order("action"),
  ])

  return (roles ?? []).map((role) => ({
    ...role,
    permissions: (permissions ?? []).filter((p) => p.role_name === role.name),
  }))
}
