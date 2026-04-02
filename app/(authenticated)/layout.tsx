import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { TopBar } from "@/components/layout/top-bar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumb-context"
import { getProfile } from "@/lib/supabase/profile"

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getProfile()

  return (
    <TooltipProvider>
      <BreadcrumbProvider>
        <SidebarProvider>
          <AppSidebar profile={profile} />
          <SidebarInset>
            <TopBar />
            <main className="flex-1 p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </BreadcrumbProvider>
    </TooltipProvider>
  )
}
