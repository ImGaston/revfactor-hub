import { NextRequest, NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  generateAutomaticSuggestedAnswers,
  isAiGatewayConfigured,
  listTicketsNeedingHubDraft,
} from "@/lib/support-answers.server"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

/**
 * Backfill Hub suggested answers for open tickets that have no draft (e.g.
 * tickets captured before this shipped, or drafts cut off by a timeout).
 * Idempotent: each ticket gets at most one automatic draft, a bot draft is
 * never replaced, and a re-run only picks up what is still missing. Run it
 * until `remaining` is 0 (scripts/backfill-support-drafts.ts does that).
 * Not scheduled in vercel.json. `?dryRun=1` lists without generating.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1"
  const requested = Number(request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(requested) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(requested))) : DEFAULT_LIMIT

  if (!dryRun && !isAiGatewayConfigured()) {
    return NextResponse.json({ error: "AI Gateway is not configured" }, { status: 503 })
  }

  try {
    const admin = createAdminClient()
    const pending = await listTicketsNeedingHubDraft(admin, MAX_LIMIT * 20)
    const batch = pending.slice(0, limit)
    if (dryRun) {
      return NextResponse.json(
        { dryRun, candidates: pending.length, next: batch.map((t) => t.ticket_number) },
        { headers: { "Cache-Control": "no-store" } }
      )
    }

    const results = await generateAutomaticSuggestedAnswers(
      admin,
      batch.map((t) => t.id),
      "backfill"
    )
    const numberById = new Map(batch.map((t) => [t.id, t.ticket_number]))
    const remaining = (await listTicketsNeedingHubDraft(admin, MAX_LIMIT * 20)).length
    return NextResponse.json(
      {
        dryRun,
        processed: results.map((r) => ({
          ticket_number: numberById.get(r.ticketId) ?? null,
          status: r.status,
          ...(r.status === "generated" ? { applied: r.applied } : {}),
          ...(r.status === "skipped" ? { reason: r.reason } : {}),
          ...(r.status === "failed" ? { error: r.error } : {}),
        })),
        remaining,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("[api/cron/support-drafts] backfill failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
