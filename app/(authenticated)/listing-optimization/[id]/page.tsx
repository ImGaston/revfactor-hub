import Link from "next/link"
import { notFound } from "next/navigation"
import { Send } from "lucide-react"

import { hasPermission } from "@/lib/permissions.server"
import { loadStaffReport } from "@/lib/listing-optimization.server"
import { createClient } from "@/lib/supabase/server"
import { checkCoverage } from "@/lib/listing-optimization-checks"
import PortalShell from "@/app/portal/layout"
import { OptimizationPortal } from "@/app/portal/optimization/optimization-portal"
import { ReviewWorkspace } from "./review-workspace"

export default async function ListingOptimizationReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, canEdit] = await Promise.all([loadStaffReport(id), hasPermission("listings", "edit")])
  if (!data) notFound()
  const coverage = checkCoverage(data.report.checks)
  // Other reviews of this owner still waiting for the owner message: send them together.
  let otherUnsent = 0
  if (!data.ownerMessageSentAt && (data.status === "draft" || data.status === "published")) {
    const supabase = await createClient()
    const { count } = await supabase
      .from("listing_optimization_reports")
      .select("id", { count: "exact", head: true })
      .eq("client_id", data.clientId)
      .in("status", ["draft", "published"])
      .is("owner_message_sent_at", null)
      .neq("id", id)
    otherUnsent = count ?? 0
  }

  return (
    <div>
      <ReviewWorkspace
        reportId={id}
        status={data.status}
        clientName={data.clientName}
        canEdit={canEdit}
        channelManager={data.channelManager}
        coverage={{ checked: coverage.checked, total: coverage.total, complete: coverage.complete }}
        ownerMessage={data.ownerMessage}
        ownerMessageSentAt={data.ownerMessageSentAt}
      />
      {otherUnsent > 0 && (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm md:mx-6">
          <span>
            {data.clientName ?? "This owner"} has {otherUnsent} other {otherUnsent === 1 ? "review" : "reviews"} waiting.
            Send them together in one message instead of one per listing.
          </span>
          <Link
            href={`/listing-optimization/owner/${data.clientId}`}
            className="ml-auto inline-flex items-center gap-1 font-medium hover:underline"
          >
            <Send className="size-4" />
            Send to owner
          </Link>
        </div>
      )}
      {/* Exactly what the owner sees in the portal, read-only for staff. */}
      <PortalShell>
        <OptimizationPortal
          reports={[data.report]}
          token={null}
          ownerName={data.clientName ?? "Owner"}
          canDecide={false}
          preview={false}
        />
      </PortalShell>
    </div>
  )
}
