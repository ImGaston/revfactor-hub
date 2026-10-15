import { notFound } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { loadOwnerReviews } from "@/lib/listing-optimization.server"
import { OwnerSendPanel } from "./owner-send-panel"

export default async function OwnerReviewsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const [data, canEdit] = await Promise.all([loadOwnerReviews(clientId), hasPermission("listings", "edit")])
  if (!data) notFound()

  return (
    <OwnerSendPanel
      clientId={clientId}
      clientName={data.clientName}
      reviews={data.pending}
      sentCount={data.sentCount}
      canEdit={canEdit}
    />
  )
}
