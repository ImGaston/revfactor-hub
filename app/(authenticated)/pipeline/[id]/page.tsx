import { LeadDetailContent } from "./lead-detail-content"

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LeadDetailContent id={id} />
}
