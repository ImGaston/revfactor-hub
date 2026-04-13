"use client"

import { useState, useEffect } from "react"
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
  calendar: "Calendar",
  notes: "Notes",
  settings: "Settings",
  account: "Account",
  users: "Users",
  roadmap: "Ideas & Roadmap",
  listings: "Listings",
  "boards-tags": "Boards & Tags",
  knowledge: "Knowledge",
  new: "New Article",
  edit: "Edit",
  category: "Category",
}

type TopBarProps = {
  profile: Profile | null
  permissionMap: Record<string, boolean>
}

export function TopBar({ profile, permissionMap }: TopBarProps) {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const { overrides } = useBreadcrumbOverrides()
  const [cmdOpen, setCmdOpen] = useState(false)
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 !h-4" />
        <Breadcrumb className="flex-1">
          <BreadcrumbList>
            {segments.length === 0 ? (
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              segments.map((segment, index) => {
                const href = "/" + segments.slice(0, index + 1).join("/")
                const isLast = index === segments.length - 1
                const label =
                  overrides[segment] ?? routeLabels[segment] ?? segment

                return (
                  <span key={href} className="contents">
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
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
          className="hidden h-8 gap-2 text-muted-foreground md:flex"
          onClick={() => setCmdOpen(true)}
        >
          <Search className="size-3.5" />
          <span className="text-xs">Search...</span>
          <kbd className="pointer-events-none ml-2 inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
            {isMac ? <span className="text-xs">&#8984;</span> : <span className="text-xs">Ctrl</span>}
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
