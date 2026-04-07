"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { RESOURCES, ACTIONS } from "@/lib/permissions"

async function requireSuperAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated", supabase }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "super_admin") return { error: "Unauthorized", supabase }
  return { error: null, supabase }
}

export async function createRole(formData: FormData) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  const name = (formData.get("name") as string)?.trim().toLowerCase().replace(/\s+/g, "_")
  const description = (formData.get("description") as string)?.trim() || null

  if (!name) return { error: "Role name is required" }
  if (name === "super_admin") return { error: "Cannot create a role with this name" }

  const admin = createAdminClient()

  // Create role
  const { error: roleError } = await admin
    .from("roles")
    .insert({ name, description, is_system: false })

  if (roleError) {
    if (roleError.code === "23505") return { error: "A role with this name already exists" }
    return { error: roleError.message }
  }

  // Seed permissions (all false by default, with view enabled for common resources)
  const permissions = []
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      permissions.push({
        role_name: name,
        resource: resource.key,
        action,
        allowed: false,
      })
    }
  }

  const { error: permError } = await admin.from("role_permissions").insert(permissions)
  if (permError) return { error: permError.message }

  revalidatePath("/settings/roles")
  return { error: null }
}

export async function updateRoleDescription(roleName: string, description: string) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  const admin = createAdminClient()
  const { error } = await admin
    .from("roles")
    .update({ description, updated_at: new Date().toISOString() })
    .eq("name", roleName)

  if (error) return { error: error.message }

  revalidatePath("/settings/roles")
  return { error: null }
}

export async function deleteRole(roleName: string) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  const admin = createAdminClient()

  // Can't delete system roles
  const { data: role } = await admin
    .from("roles")
    .select("is_system")
    .eq("name", roleName)
    .single()

  if (role?.is_system) return { error: "Cannot delete system roles" }

  // Check if any user is using this role
  const { data: usersWithRole } = await admin
    .from("profiles")
    .select("id")
    .eq("role", roleName)

  if (usersWithRole && usersWithRole.length > 0) {
    return {
      error: `Cannot delete role "${roleName}" — ${usersWithRole.length} user(s) are assigned to it. Reassign them first.`,
    }
  }

  // Delete role (cascades to permissions)
  const { error } = await admin.from("roles").delete().eq("name", roleName)

  if (error) return { error: error.message }

  revalidatePath("/settings/roles")
  return { error: null }
}

export async function togglePermission(
  roleName: string,
  resource: string,
  action: string,
  allowed: boolean
) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  // Can't modify super_admin permissions
  if (roleName === "super_admin") return { error: "Cannot modify super_admin permissions" }

  const admin = createAdminClient()

  const { error } = await admin
    .from("role_permissions")
    .update({ allowed })
    .eq("role_name", roleName)
    .eq("resource", resource)
    .eq("action", action)

  if (error) return { error: error.message }

  revalidatePath("/settings/roles")
  return { error: null }
}

export async function bulkToggleResource(
  roleName: string,
  resource: string,
  allowed: boolean
) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  if (roleName === "super_admin") return { error: "Cannot modify super_admin permissions" }

  const admin = createAdminClient()

  const { error } = await admin
    .from("role_permissions")
    .update({ allowed })
    .eq("role_name", roleName)
    .eq("resource", resource)

  if (error) return { error: error.message }

  revalidatePath("/settings/roles")
  return { error: null }
}

export async function updateUserRole(userId: string, newRole: string) {
  const { error: authError } = await requireSuperAdmin()
  if (authError) return { error: authError }

  const admin = createAdminClient()

  // Verify role exists
  const { data: role } = await admin
    .from("roles")
    .select("name")
    .eq("name", newRole)
    .single()

  if (!role) return { error: "Role does not exist" }

  const { error } = await admin
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", userId)

  if (error) return { error: error.message }

  revalidatePath("/settings/roles")
  revalidatePath("/settings/users")
  return { error: null }
}
