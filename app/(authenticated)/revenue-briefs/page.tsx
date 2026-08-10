import { redirect } from "next/navigation"

import { isAirRoiConfigured } from "@/lib/airroi.server"
import { hasPermission } from "@/lib/permissions.server"
import { listRevenueBriefBrands } from "@/lib/revenue-brief/brand.server"
import { RevenueBriefBuilder } from "./revenue-brief-builder"

export default async function RevenueBriefsPage() {
  if (!(await hasPermission("pipeline", "view"))) redirect("/")

  const brands = await listRevenueBriefBrands()

  return (
    <RevenueBriefBuilder
      airRoiConfigured={isAirRoiConfigured()}
      brands={brands}
    />
  )
}
