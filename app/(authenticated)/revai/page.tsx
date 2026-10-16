import { redirect } from "next/navigation"

import { RevAiWorkspace } from "@/components/revai/revai-workspace"
import { hasPermission } from "@/lib/permissions.server"
import { getWikifactor } from "@/lib/revai/wikifactor.server"

export default async function RevAiPage() {
  if (!(await hasPermission("agent_studio", "view"))) redirect("/")

  const { corpus } = getWikifactor()
  const snapshotLabel = `Wikifactor ${corpus.base.sha.slice(0, 7)} · ${corpus.docs.length} pages · synced ${corpus.generatedAt.slice(0, 10)}`

  return <RevAiWorkspace snapshotLabel={snapshotLabel} />
}
