import { redirect } from "next/navigation"

import { isAirRoiConfigured } from "@/lib/airroi.server"
import { hasPermission } from "@/lib/permissions.server"
import { RevenueBriefBuilder } from "./revenue-brief-builder"

export default async function RevenueBriefsPage() {
  if (!(await hasPermission("ghl", "view"))) redirect("/")

  return <RevenueBriefBuilder airRoiConfigured={isAirRoiConfigured()} />
}
