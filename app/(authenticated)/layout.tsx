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
import { RevAiBubble } from "@/components/revai/revai-bubble"
import { RevAiProvider } from "@/components/revai/revai-provider"

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

  const canUseRevAi =
    profile?.role === "super_admin" || permissionMap["agent_studio:view"] === true

  const sidebarCookie = cookieStore.get("sidebar_state")?.value
  const defaultOpen = sidebarCookie !== "false"

  const shell = (
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
      {canUseRevAi ? <RevAiBubble /> : null}
    </SidebarProvider>
  )

  return (
    <TooltipProvider>
      <BreadcrumbProvider>
        {canUseRevAi && profile ? (
          <RevAiProvider userId={profile.id}>{shell}</RevAiProvider>
        ) : (
          shell
        )}
      </BreadcrumbProvider>
    </TooltipProvider>
  )
}
