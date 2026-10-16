import type { Metadata } from "next"
import { PlugZap } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { resolvePortalAccess } from "@/lib/assembly-portal-session.server"
import { loadPortalConnections } from "@/lib/pms-connections.server"
import type { PortalPmsConnection } from "@/lib/pms-connections"
import { ConnectionsPortal } from "./connections-portal"

export const metadata: Metadata = {
  title: "Connect your PMS | RevFactor",
  robots: { index: false, follow: false },
}

// Rendered per request: identity comes from the Assembly session token.
export const dynamic = "force-dynamic"

const MESSAGES: Record<string, string> = {
  "missing-token": "Open this page from your RevFactor portal.",
  "invalid-token": "Your session expired. Reload the page from your portal.",
  misconfigured: "This page isn't set up yet. Please message us in the portal.",
  "no-client":
    "We couldn't match your account yet. Please message us in the portal.",
}

function Notice({ text }: { text: string }) {
  return (
    <main className="rf-portal-main rf-empty-shell">
      <Empty className="rf-empty-card">
        <span className="rf-wordmark">revfactor</span>
        <EmptyHeader className="rf-empty-header">
          <EmptyMedia variant="icon" className="rf-empty-icon" aria-hidden="true">
            <PlugZap />
          </EmptyMedia>
          <EmptyTitle>
            <h1 className="rf-empty-title">Connect your PMS</h1>
          </EmptyTitle>
          <EmptyDescription className="rf-empty-copy">{text}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}

const PREVIEW_CONNECTIONS: PortalPmsConnection[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "hospitable",
    providerLabel: "Hospitable",
    status: "connected",
    tokenLast4: "9f2c",
    createdAt: "2026-10-16T15:00:00.000Z",
    remindAt: "2027-09-16",
    expiresAt: null,
    propertyCount: 2,
    lastValidatedAt: "2026-10-16T15:00:00.000Z",
    propertyNames: ["Lakeside Cabin", "Downtown Loft"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    provider: "guesty",
    providerLabel: "Guesty",
    status: "pending_verification",
    tokenLast4: "a71e",
    createdAt: "2026-10-16T15:05:00.000Z",
    remindAt: "2027-09-16",
    expiresAt: null,
    propertyCount: null,
    lastValidatedAt: null,
    propertyNames: [],
  },
]

export default async function ConnectionsPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; preview?: string }>
}) {
  const params = await searchParams

  // Local preview with fixture data only; never in production and never
  // touching the database or a provider.
  if (
    process.env.NODE_ENV !== "production" &&
    (params.preview === "1" || params.preview === "empty") &&
    !params.token
  ) {
    return (
      <ConnectionsPortal
        connections={params.preview === "empty" ? [] : PREVIEW_CONNECTIONS}
        token={null}
        canSubmit
        preview
      />
    )
  }

  const access = await resolvePortalAccess(params.token)
  if (!access.ok)
    return <Notice text={MESSAGES[access.reason] ?? MESSAGES["invalid-token"]} />

  const loaded = await loadPortalConnections(access.viewer.hubClientId)
  if (!loaded.ok)
    return (
      <Notice
        text={
          loaded.reason === "not_ready"
            ? "This page isn't set up yet. Please message us in the portal."
            : "We couldn't load your connections. Please try again in a minute."
        }
      />
    )

  return (
    <ConnectionsPortal
      connections={loaded.connections}
      token={typeof params.token === "string" ? params.token : null}
      canSubmit={!access.viewer.isInternal}
      preview={false}
    />
  )
}
