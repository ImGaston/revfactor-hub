import { Suspense } from "react"
import { AdjustmentDetailContent } from "@/app/(authenticated)/adjustments/[id]/adjustment-detail-content"
import { AdjustmentDetailModal } from "@/app/(authenticated)/adjustments/[id]/adjustment-detail-modal"
import { AdjustmentDetailSkeleton } from "@/app/(authenticated)/adjustments/[id]/adjustment-detail-skeleton"

// Intercepts client-side navigations to /adjustments/[id] and shows the
// adjustment detail in a modal over the queue. Hard loads (paste, refresh)
// fall through to the full page at adjustments/[id]/page.tsx.
export default async function AdjustmentModalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <AdjustmentDetailModal>
      <Suspense fallback={<AdjustmentDetailSkeleton />}>
        <AdjustmentDetailContent id={id} variant="modal" />
      </Suspense>
    </AdjustmentDetailModal>
  )
}
