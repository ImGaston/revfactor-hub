import type { Metadata } from "next"
import { FileSearch2 } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { resolvePortalAccess } from "@/lib/assembly-portal-session.server"
import { loadPublishedReports } from "@/lib/listing-optimization.server"
import { loadPreviewReports } from "@/lib/listing-optimization-preview.server"
import { OptimizationPortal } from "./optimization-portal"

export const metadata: Metadata = {
  title: "Listing review | RevFactor",
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
          <EmptyMedia
            variant="icon"
            className="rf-empty-icon"
            aria-hidden="true"
          >
            <FileSearch2 />
          </EmptyMedia>
          <EmptyTitle>
            <h1 className="rf-empty-title">Listing review</h1>
          </EmptyTitle>
          <EmptyDescription className="rf-empty-copy">{text}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}

export default async function OptimizationPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; preview?: string }>
}) {
  const params = await searchParams

  // Local preview with fixture data only; never in production and never
  // touching the database.
  if (
    process.env.NODE_ENV !== "production" &&
    (params.preview === "1" || params.preview === "multi") &&
    !params.token
  ) {
    return (
      <OptimizationPortal
        reports={await loadPreviewReports(params.preview === "multi")}
        token={null}
        ownerName="Preview owner"
        canDecide
        preview
      />
    )
  }

  const access = await resolvePortalAccess(params.token)
  if (!access.ok)
    return (
      <Notice text={MESSAGES[access.reason] ?? MESSAGES["invalid-token"]} />
    )

  let reports
  try {
    reports = await loadPublishedReports(access.viewer.hubClientId)
  } catch (error) {
    console.error("listing optimization portal: load failed", error)
    return (
      <Notice text="We couldn't load your listing review. Please try again in a minute." />
    )
  }

  return (
    <OptimizationPortal
      reports={reports}
      token={typeof params.token === "string" ? params.token : null}
      ownerName={access.viewer.displayName}
      canDecide={!access.viewer.isInternal}
      preview={false}
    />
  )
}
