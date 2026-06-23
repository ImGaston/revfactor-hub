import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isReportBuilderConfigured } from "@/lib/report-builder/client"
import { advanceReportBuilder } from "@/lib/report-builder/runner"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access.
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isReportBuilderConfigured()) {
    return NextResponse.json(
      { error: "PRICELABS_API_KEY not configured" },
      { status: 500 }
    )
  }

  try {
    const result = await advanceReportBuilder(createAdminClient(), {
      triggeredBy: "cron",
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error("Report Builder cron error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
