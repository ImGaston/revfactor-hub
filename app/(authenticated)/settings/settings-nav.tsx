"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const allTabs = [
  { label: "Account", href: "/settings/account", adminOnly: false },
  { label: "Users", href: "/settings/users", adminOnly: true },
  { label: "Clients", href: "/settings/clients", adminOnly: true },
  { label: "Listings", href: "/settings/listings", adminOnly: true },
  { label: "Boards & Tags", href: "/settings/boards-tags", adminOnly: true },
  { label: "Onboarding", href: "/settings/onboarding", adminOnly: true },
]

export function SettingsNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = allTabs.filter((t) => !t.adminOnly || isSuperAdmin)

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
