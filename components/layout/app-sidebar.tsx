"use client"

import {
  Settings,
  LogOut,
  ChevronsUpDown,
  ChevronRight,
  User as UserIcon,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import type { Profile } from "@/lib/supabase/profile"
import {
  NAV_ITEMS,
  buildNavTree,
  NavGroupIcon,
  isNavItemActive,
  type NavConfig,
  type NavItem,
  type NavTreeGroup,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

const NAV_BUTTON =
  "relative z-1 rounded-xl transition-colors duration-150 ease-(--ease-snappy) data-active:bg-transparent group-data-[collapsible=icon]:rounded-full"

const NAV_SUB_BUTTON =
  "relative z-1 rounded-xl transition-colors duration-150 ease-(--ease-snappy) data-active:bg-transparent"

type PillRect = { top: number; left: number; width: number; height: number }

export function AppSidebar({
  profile,
  permissionMap,
  navConfig,
}: {
  profile: Profile | null
  permissionMap: Record<string, boolean>
  navConfig: NavConfig
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { isMobile, setOpenMobile, state } = useSidebar()

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
  const visibleNavItems = React.useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (item.superAdminOnly) return isSuperAdmin
        if (!item.resource) return true
        return isSuperAdmin || permissionMap[`${item.resource}:view`] === true
      }),
    [isSuperAdmin, permissionMap]
  )

  const tree = React.useMemo(
    () => buildNavTree(visibleNavItems, navConfig),
    [visibleNavItems, navConfig]
  )

  // Icon-only rail: folders can't show their children, so flatten everything
  // (each item keeps its tooltip). Folder order is preserved.
  const flatRail = state === "collapsed" && !isMobile

  // Folder open state. Unset = folder default, except the folder holding the
  // current route, which opens itself on navigation.
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  const activeGroupId = React.useMemo(
    () =>
      tree.groups.find((g) => g.items.some((i) => isNavItemActive(i, pathname)))
        ?.group.id ?? null,
    [tree, pathname]
  )
  React.useEffect(() => {
    if (!activeGroupId) return
    setOpenGroups((prev) =>
      prev[activeGroupId] === true ? prev : { ...prev, [activeGroupId]: true }
    )
  }, [activeGroupId])

  function isGroupOpen(g: NavTreeGroup) {
    return openGroups[g.group.id] ?? !g.group.default_collapsed
  }

  // The active pill is measured from the DOM: rows are no longer a uniform
  // height (folder children are shorter and indented), so the old
  // index × step trick no longer works.
  const menuRef = React.useRef<HTMLUListElement>(null)
  const [pill, setPill] = React.useState<PillRect | null>(null)
  const openKey = tree.groups.map((g) => (isGroupOpen(g) ? "1" : "0")).join("")

  React.useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const active = menu.querySelector<HTMLElement>('[data-nav-active="true"]')
    if (!active) {
      setPill(null)
      return
    }
    const menuRect = menu.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    setPill({
      top: rect.top - menuRect.top,
      left: rect.left - menuRect.left,
      width: rect.width,
      height: rect.height,
    })
  }, [pathname, openKey, flatRail, visibleNavItems, navConfig])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  function renderTopLevelItem(item: NavItem) {
    const active = isNavItemActive(item, pathname)
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.title}
          className={NAV_BUTTON}
        >
          <Link
            href={item.href}
            onClick={closeMobileSidebar}
            data-nav-active={active ? "true" : undefined}
          >
            <item.icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  function renderGroup(g: NavTreeGroup) {
    const open = isGroupOpen(g)
    const containsActive = g.group.id === activeGroupId
    // Closed folder holding the current route: the pill sits on the header.
    const headerActive = containsActive && !open
    return (
      <Collapsible
        key={g.group.id}
        open={open}
        onOpenChange={(next) =>
          setOpenGroups((prev) => ({ ...prev, [g.group.id]: next }))
        }
        className="group/collapsible"
        asChild
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              tooltip={g.group.label}
              isActive={headerActive}
              className={NAV_BUTTON}
              data-nav-active={headerActive ? "true" : undefined}
            >
              <NavGroupIcon name={g.group.icon} />
              <span>{g.group.label}</span>
              <ChevronRight className="ml-auto size-4 transition-transform duration-200 ease-(--ease-snappy) group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {g.items.map((item) => {
                const active = isNavItemActive(item, pathname)
                return (
                  <SidebarMenuSubItem key={item.key}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={active}
                      className={NAV_SUB_BUTTON}
                    >
                      <Link
                        href={item.href}
                        onClick={closeMobileSidebar}
                        data-nav-active={active ? "true" : undefined}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                )
              })}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    )
  }

  const settingsActive = pathname.startsWith("/settings")

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
            <SidebarMenu ref={menuRef} className="relative">
              {pill && (
                <span
                  aria-hidden
                  style={pill}
                  className={cn(
                    "pointer-events-none absolute z-0 rounded-xl bg-sidebar-accent shadow-e1 transition-[top,left,width,height] duration-[560ms] ease-(--ease-bouncy) motion-reduce:transition-none",
                    flatRail && "rounded-full"
                  )}
                />
              )}
              {tree.topLevel.map(renderTopLevelItem)}
              {tree.groups.map((g) =>
                flatRail ? g.items.map(renderTopLevelItem) : renderGroup(g)
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={settingsActive}
                  tooltip="Settings"
                  className={NAV_BUTTON}
                >
                  <Link
                    href="/settings/account"
                    onClick={closeMobileSidebar}
                    data-nav-active={settingsActive ? "true" : undefined}
                  >
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
