import { notFound } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { loadStaffReport } from "@/lib/listing-optimization.server"
import { checkCoverage } from "@/lib/listing-optimization-checks"
import PortalShell from "@/app/portal/layout"
import { OptimizationPortal } from "@/app/portal/optimization/optimization-portal"
import { ReportStatusControls } from "./report-status-controls"

export default async function ListingOptimizationReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, canEdit] = await Promise.all([loadStaffReport(id), hasPermission("listings", "edit")])
  if (!data) notFound()
  const coverage = checkCoverage(data.report.checks)

  return (
    <div>
      <ReportStatusControls
        reportId={id}
        status={data.status}
        clientName={data.clientName}
        canEdit={canEdit}
        channelManager={data.channelManager}
        coverage={{ checked: coverage.checked, total: coverage.total, complete: coverage.complete }}
      />
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
