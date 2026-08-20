"use client"

import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CheckSquare,
  ClipboardList,
  Lightbulb,
  Funnel,
  Building2,
  DollarSign,
  BookOpen,
  Bot,
  SlidersHorizontal,
  Settings,
  LogOut,
  ChevronsUpDown,
  User as UserIcon,
  FileChartColumnIncreasing,
} from "lucide-react"
import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import type { Profile } from "@/lib/supabase/profile"

type NavItem = {
  title: string
  href: string
  icon: React.ComponentType
  resource?: string
  superAdminOnly?: boolean
}

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Clients", href: "/clients", icon: Users, resource: "clients" },
  {
    title: "Listings",
    href: "/listings",
    icon: Building2,
    resource: "listings",
  },
  {
    title: "Reservations",
    href: "/reservations",
    icon: CalendarCheck,
    resource: "reservations",
  },
  { title: "Tasks", href: "/tasks", icon: CheckSquare, resource: "tasks" },
  {
    title: "Adjustments",
    href: "/adjustments",
    icon: SlidersHorizontal,
    resource: "adjustments",
  },
  {
    title: "Onboarding",
    href: "/onboarding",
    icon: ClipboardList,
    resource: "onboarding",
  },
  {
    title: "Projects & Roadmap",
    href: "/roadmap",
    icon: Lightbulb,
    resource: "roadmap",
  },
  { title: "Pipeline", href: "/pipeline", icon: Funnel, resource: "pipeline" },
  {
    title: "Revenue Briefs",
    href: "/revenue-briefs",
    icon: FileChartColumnIncreasing,
    resource: "pipeline",
  },
  {
    title: "Knowledge",
    href: "/knowledge",
    icon: BookOpen,
    resource: "knowledge",
  },
  {
    title: "Agent Studio",
    href: "/agent-studio",
    icon: Bot,
    resource: "agent_studio",
  },
  {
    title: "Financials",
    href: "/financials",
    icon: DollarSign,
    superAdminOnly: true,
  },
]

const NAV_BUTTON =
  "relative z-1 rounded-xl transition-colors duration-150 ease-(--ease-snappy) data-active:bg-transparent group-data-[collapsible=icon]:rounded-full"

export function AppSidebar({
  profile,
  permissionMap,
}: {
  profile: Profile | null
  permissionMap: Record<string, boolean>
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { isMobile, setOpenMobile } = useSidebar()

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false)
  }

  const displayName = profile?.full_name || profile?.email || "User"
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  const roleBadge = (profile?.role ?? "admin")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

  const isSuperAdmin = profile?.role === "super_admin"
  const visibleNavItems = navItems.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin
    if (!item.resource) return true
    return isSuperAdmin || permissionMap[`${item.resource}:view`] === true
  })

  // El indice basta para posicionar la pill: cada fila es h-9 con gap-0.5, o sea
  // un paso constante. Nada de getBoundingClientRect ni ResizeObserver.
  // OJO: si alguna vez se agrega un SidebarMenuBadge, un submenu o una fila de
  // otra altura, el paso deja de ser uniforme y esto hay que medirlo de verdad.
  const activeIndex = React.useMemo(() => {
    const i = visibleNavItems.findIndex((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    )
    if (i !== -1) return i
    return pathname.startsWith("/settings") ? visibleNavItems.length : -1
  }, [visibleNavItems, pathname])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Image
                    src="/revfactor-logo/RevFactor_Favicon_Cedar.png"
                    alt="RF"
                    width={32}
                    height={32}
                    className="block dark:hidden"
                  />
                  <Image
                    src="/revfactor-logo/RevFactor_Favicon_Bone.png"
                    alt="RF"
                    width={32}
                    height={32}
                    className="hidden dark:block"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Revfactor</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Hub
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="relative [--nav-step:2.375rem] group-data-[collapsible=icon]:[--nav-step:2.125rem]">
              {activeIndex >= 0 && (
                <span
                  aria-hidden
                  style={{ "--nav-i": activeIndex } as React.CSSProperties}
                  className="pointer-events-none absolute inset-x-0 top-0 z-0 h-9 translate-y-[calc(var(--nav-i)*var(--nav-step))] rounded-xl bg-sidebar-accent shadow-e1 transition-transform duration-[560ms] ease-(--ease-bouncy) group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:rounded-full motion-reduce:transition-none"
                />
              )}
              {visibleNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                    tooltip={item.title}
                    className={NAV_BUTTON}
                  >
                    <Link href={item.href} onClick={closeMobileSidebar}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/settings")}
                  tooltip="Settings"
                  className={NAV_BUTTON}
                >
                  <Link href="/settings/account" onClick={closeMobileSidebar}>
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8">
                    {profile?.avatar_url && (
                      <AvatarImage src={profile.avatar_url} />
                    )}
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {displayName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {roleBadge}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-dropdown-menu-trigger-width]"
              >
                <DropdownMenuItem asChild>
                  <Link href="/settings/account" onClick={closeMobileSidebar}>
                    <UserIcon />
                    <span>Account</span>
                  </Link>
                </DropdownMenuItem>
                {profile?.role === "super_admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/settings/users" onClick={closeMobileSidebar}>
                      <Settings />
                      <span>Manage Users</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
