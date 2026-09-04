import { NextResponse } from "next/server"

import { collectRegisteredUniversitySources } from "@/lib/market-signals/university-collector.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/** Manual, read-only preview; deliberately does not persist collected events. */
export async function GET() {
  if (!(await hasPermission("market_signals", "view"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const result = await collectRegisteredUniversitySources(await createClient())
    return NextResponse.json({ ...result, generatedAt: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: "University source preview unavailable" }, { status: 503 })
  }
}
