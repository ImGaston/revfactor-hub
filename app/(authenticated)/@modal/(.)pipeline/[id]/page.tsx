import { Suspense } from "react"
import { LeadDetailContent } from "@/app/(authenticated)/pipeline/[id]/lead-detail-content"
import { LeadDetailModal } from "@/app/(authenticated)/pipeline/[id]/lead-detail-modal"
import { LeadDetailSkeleton } from "@/app/(authenticated)/pipeline/[id]/lead-detail-skeleton"

// Intercepts client-side navigations to /pipeline/[id] and shows the lead
// detail in a modal over the board. Hard loads (paste, refresh, share) fall
// through to the full page at pipeline/[id]/page.tsx.
export default async function LeadModalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <LeadDetailModal>
      <Suspense fallback={<LeadDetailSkeleton />}>
        <LeadDetailContent id={id} variant="modal" />
      </Suspense>
    </LeadDetailModal>
  )
}
