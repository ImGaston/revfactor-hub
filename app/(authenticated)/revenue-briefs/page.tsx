import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { RevenueBriefBuilder } from "./revenue-brief-builder"

export default async function RevenueBriefsPage() {
  if (!(await hasPermission("pipeline", "view"))) redirect("/")

  return <RevenueBriefBuilder />
}
