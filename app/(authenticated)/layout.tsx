import { cookies } from "next/headers"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { TopBar } from "@/components/layout/top-bar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumb-context"
import { getProfile } from "@/lib/supabase/profile"
import { getRolePermissions } from "@/lib/permissions.server"
import { buildPermissionMap } from "@/lib/permissions"
import { getNavConfig } from "@/lib/navigation.server"

export default async function AuthenticatedLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  const [profile, cookieStore, navConfig] = await Promise.all([
    getProfile(),
    cookies(),
    getNavConfig(),
  ])

  const permissions = profile ? await getRolePermissions(profile.role) : []
  const permissionMap =
    profile?.role === "super_admin" ? {} : buildPermissionMap(permissions)

  const sidebarCookie = cookieStore.get("sidebar_state")?.value
  const defaultOpen = sidebarCookie !== "false"

  return (
    <TooltipProvider>
      <BreadcrumbProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar
            profile={profile}
            permissionMap={permissionMap}
            navConfig={navConfig}
          />
          <SidebarInset className="min-w-0">
            <TopBar profile={profile} permissionMap={permissionMap} />
            <main className="flex-1 p-6">{children}</main>
            {modal}
          </SidebarInset>
        </SidebarProvider>
      </BreadcrumbProvider>
    </TooltipProvider>
  )
}
