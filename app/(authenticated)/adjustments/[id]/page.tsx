import { AdjustmentDetailContent } from "./adjustment-detail-content"

export default async function AdjustmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <AdjustmentDetailContent id={id} />
}
