"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/status-badge"
import { CLIENT_TABS, DEFAULT_CLIENT_TAB, parseClientTab, type ClientTab } from "@/lib/client-tabs"
import { JourneyTab } from "./journey-tab"
import { OnboardingTab } from "./onboarding-tab"
import { ProfileTab } from "./profile-tab"
import { TicketsTab } from "./tickets-tab"
import { AdjustmentsTab } from "./adjustments-tab"

/**
 * Top-level tabs on /clients/[id]. The Legacy tab is server-rendered with the
 * page (today's client page, unchanged). The other tabs mount — and fetch
 * their data — only when first opened, then stay mounted so switching back is
 * instant. The active tab lives in `?tab=` for deep links; it is written with
 * history.replaceState so switching never re-runs the page's server queries.
 */
export function ClientTabs({
  clientId,
  name,
  status,
  businessName,
  initialTab,
  canViewSupport,
  canViewAdjustments,
  legacy,
}: {
  clientId: string
  name: string
  status: string
  businessName: string | null
  initialTab: ClientTab
  canViewSupport: boolean
  canViewAdjustments: boolean
  legacy: ReactNode
}) {
  const visibleTabs = CLIENT_TABS.filter(
    (t) => (t.value !== "tickets" || canViewSupport) && (t.value !== "adjustments" || canViewAdjustments)
  )
  const startTab = visibleTabs.some((t) => t.value === initialTab) ? initialTab : DEFAULT_CLIENT_TAB
  const [tab, setTab] = useState<ClientTab>(startTab)
  const [visited, setVisited] = useState<Set<ClientTab>>(() => new Set([DEFAULT_CLIENT_TAB, startTab]))

  // A navigation to this page with a different ?tab= (e.g. a link) re-renders
  // with a new initialTab; follow it without remounting the Legacy tab.
  const [prevStartTab, setPrevStartTab] = useState(startTab)
  if (startTab !== prevStartTab) {
    setPrevStartTab(startTab)
    setTab(startTab)
    setVisited((current) => (current.has(startTab) ? current : new Set(current).add(startTab)))
  }

  function changeTab(value: string) {
    const next = parseClientTab(value)
    setTab(next)
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)))
    const url = new URL(window.location.href)
    if (next === DEFAULT_CLIENT_TAB) url.searchParams.delete("tab")
    else url.searchParams.set("tab", next)
    // Pass null, not history.state: Next only syncs its router URL (and
    // useSearchParams) for states it didn't write itself.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/clients">
            <ArrowLeft className="mr-1 size-4" />
            Back to clients
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <StatusBadge status={status} />
        </div>
        {businessName && <p className="mt-1 text-sm text-muted-foreground">{businessName}</p>}
      </div>

      <Tabs value={tab} onValueChange={changeTab} className="gap-6">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {visibleTabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="legacy" forceMount className="data-[state=inactive]:hidden">
          {legacy}
        </TabsContent>
        {visited.has("onboarding") && (
          <TabsContent value="onboarding" forceMount className="data-[state=inactive]:hidden">
            <OnboardingTab clientId={clientId} />
          </TabsContent>
        )}
        {visited.has("journey") && (
          <TabsContent value="journey" forceMount className="data-[state=inactive]:hidden">
            <JourneyTab clientId={clientId} />
          </TabsContent>
        )}
        {visited.has("profile") && (
          <TabsContent value="profile" forceMount className="data-[state=inactive]:hidden">
            <ProfileTab clientId={clientId} />
          </TabsContent>
        )}
        {canViewSupport && visited.has("tickets") && (
          <TabsContent value="tickets" forceMount className="data-[state=inactive]:hidden">
            <TicketsTab clientId={clientId} />
          </TabsContent>
        )}
        {canViewAdjustments && visited.has("adjustments") && (
          <TabsContent value="adjustments" forceMount className="data-[state=inactive]:hidden">
            <AdjustmentsTab clientId={clientId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
