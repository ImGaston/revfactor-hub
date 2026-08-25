"use client"

import { useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import { Search } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { useBreadcrumbOverrides } from "./breadcrumb-context"
import { CommandPalette } from "./command-palette"
import type { Profile } from "@/lib/supabase/profile"

const routeLabels: Record<string, string> = {
  "": "Dashboard",
  clients: "Clients",
  tasks: "Tasks",
  onboarding: "Onboarding",
  settings: "Settings",
  account: "Account",
  users: "Users",
  roadmap: "Projects & Roadmap",
  listings: "Listings",
  pipeline: "Pipeline",
  adjustments: "Adjustments",
  reservations: "Reservations",
  wins: "Wins",
  financials: "Financials",
  subscriptions: "Subscriptions",
  "adjustment-types": "Adjustment Types",
  "boards-tags": "Boards & Tags",
  knowledge: "Knowledge",
  "agent-studio": "Agent Studio",
  "revenue-manager": "Revenue Manager",
  "market-signals": "Market Signals",
  "revenue-briefs": "Revenue Briefs",
  new: "New Article",
  edit: "Edit",
  category: "Category",
}

// Detail routes use UUID segments; pages override them with a readable label
// (BreadcrumbSetter). A UUID with no override means nothing to the user — hide
// it instead of rendering the raw ID.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const subscribeToPlatform = () => () => undefined
const getPlatformSnapshot = () => /Mac|iPhone|iPad/.test(navigator.platform)
const getServerPlatformSnapshot = () => true

type TopBarProps = {
  profile: Profile | null
  permissionMap: Record<string, boolean>
}

export function TopBar({ profile, permissionMap }: TopBarProps) {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const { overrides } = useBreadcrumbOverrides()
  const [cmdOpen, setCmdOpen] = useState(false)
  const isMac = useSyncExternalStore(
    subscribeToPlatform,
    getPlatformSnapshot,
    getServerPlatformSnapshot
  )

  return (
    <>
      <header className="glass-chrome sticky top-0 z-30 flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-foreground/8 px-4 glass-panel">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 !h-4" />
        <Breadcrumb className="flex-1">
          <BreadcrumbList>
            {segments.length === 0 ? (
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              segments
                .map((segment, index) => ({
                  segment,
                  href: "/" + segments.slice(0, index + 1).join("/"),
                  label: overrides[segment] ?? routeLabels[segment] ?? segment,
                }))
                .filter(
                  (crumb) =>
                    !UUID_RE.test(crumb.segment) || overrides[crumb.segment]
                )
                .map((crumb, index, crumbs) => {
                  const isLast = index === crumbs.length - 1

                  return (
                    <span key={crumb.href} className="contents">
                      {index > 0 && <BreadcrumbSeparator />}
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink href={crumb.href}>
                            {crumb.label}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </span>
                  )
                })
            )}
          </BreadcrumbList>
        </Breadcrumb>

        <Button
          variant="outline"
          size="sm"
          className="hidden h-8 gap-2 bg-transparent text-muted-foreground md:flex md:w-56 md:justify-start"
          onClick={() => setCmdOpen(true)}
        >
          <Search className="size-3.5" />
          <span className="text-xs">Search...</span>
          <kbd className="pointer-events-none ml-auto inline-flex h-5 items-center gap-0.5 rounded-md border-transparent bg-foreground/8 px-1.5 font-mono text-[10px] font-medium select-none">
            {isMac ? (
              <span className="text-xs">&#8984;</span>
            ) : (
              <span className="text-xs">Ctrl</span>
            )}
            K
          </kbd>
        </Button>

        <ThemeToggle />
      </header>

      <CommandPalette
        profile={profile}
        permissionMap={permissionMap}
        open={cmdOpen}
        onOpenChange={setCmdOpen}
      />
    </>
  )
}
