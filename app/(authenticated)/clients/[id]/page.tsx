export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Client Detail</h1>
      <p className="mt-2 text-muted-foreground">Client {id} — Coming soon.</p>
    </div>
  )
}
