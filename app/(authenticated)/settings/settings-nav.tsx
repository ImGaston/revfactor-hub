"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

type Tab = {
  label: string
  href: string
  /** Permission key required to see this tab. null = visible to all. */
  permission: string | null
}

const allTabs: Tab[] = [
  { label: "Account", href: "/settings/account", permission: null },
  { label: "Users", href: "/settings/users", permission: "users:view" },
  { label: "Roles & Permissions", href: "/settings/roles", permission: "users:edit" },
  { label: "Clients", href: "/settings/clients", permission: "clients:edit" },
  { label: "Listings", href: "/settings/listings", permission: "listings:edit" },
  { label: "Boards & Tags", href: "/settings/boards-tags", permission: "settings:edit" },
  { label: "Onboarding", href: "/settings/onboarding", permission: "onboarding:edit" },
]

export function SettingsNav({
  permissions,
}: {
  permissions: Record<string, boolean>
  /** @deprecated use permissions instead */
  isSuperAdmin?: boolean
}) {
  const pathname = usePathname()
  const tabs = allTabs.filter(
    (t) => t.permission === null || permissions[t.permission]
  )

  return (
    <nav className="flex gap-1 border-b overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "shrink-0 px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
            pathname === tab.href
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
