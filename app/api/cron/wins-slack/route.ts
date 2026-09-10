import { NextRequest, NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { deliverWinSlackNotes } from "@/lib/wins-slack.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1"
  const runParam = request.nextUrl.searchParams.get("runId")
  const runId = runParam && UUID_RE.test(runParam) ? runParam : undefined

  try {
    const supabase = createAdminClient()
    const result = await deliverWinSlackNotes({
      supabase,
      runId,
      dryRun,
    })
    return NextResponse.json({
      dryRun,
      ...result,
    })
  } catch (err) {
    console.error("Wins Slack delivery error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
