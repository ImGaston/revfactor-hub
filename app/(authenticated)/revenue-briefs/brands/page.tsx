import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { listRevenueBriefBrands } from "@/lib/revenue-brief/brand.server"
import { createClient } from "@/lib/supabase/server"
import { RevenueBriefBrandManager } from "./revenue-brief-brand-manager"

export default async function RevenueBriefBrandsPage() {
  if (!(await hasPermission("pipeline", "view"))) redirect("/")

  const supabase = await createClient()
  const [{ data: clients }, brands] = await Promise.all([
    supabase.from("clients_basic").select("id,name").order("name"),
    listRevenueBriefBrands(),
  ])

  return <RevenueBriefBrandManager brands={brands} clients={clients ?? []} />
}
