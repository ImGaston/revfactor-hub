import { redirect } from "next/navigation"
import { hasPermission } from "@/lib/permissions.server"
import { buildAshwoodWorkspace } from "@/lib/revenue-manager/workspace"
import { RevenueManagerView } from "./revenue-manager-view"

export default async function RevenueManagerPage() {
  const canView = await hasPermission("revenue", "view")
  if (!canView) redirect("/")

  return <RevenueManagerView workspace={buildAshwoodWorkspace()} />
}
