import { after, NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateAutomaticSuggestedAnswers } from "@/lib/support-answers.server"
import { runSupportCapture } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"
// Leaves room for the post-response Hub drafts (AI Gateway + Jev) in after().
// Drafts cut off by the limit are picked up by /api/cron/support-drafts.
export const maxDuration = 300

const NO_STORE = { "Cache-Control": "no-store" }

/** Ticket ids this capture created (not ones it matched or skipped). */
function createdTicketIds(body: unknown): string[] {
  const tickets = (body as { tickets?: { outcome?: string; ticket_id?: string | null }[] } | null)?.tickets
  return (tickets ?? []).flatMap((t) => (t.outcome === "created" && t.ticket_id ? [t.ticket_id] : []))
}

/**
 * One call per chat message processed by the capture bot: new asks become
 * tickets, and the message's effects on existing tickets become events. The
 * whole message is written in one transaction (apply_support_capture), and
 * every item is idempotent by a key derived from the message.
 * Contract: docs/support/grok-review-decisions.md.
 *
 * After the response is sent, the Hub drafts a suggested answer for each new
 * ticket (at most once per ticket; never over a bot draft). It never delays
 * or fails the capture response.
 */
export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "support:write")
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400, headers: NO_STORE })
  }

  try {
    const admin = createAdminClient()
    const result = await runSupportCapture(admin, body)
    const newTicketIds = result.status === 200 ? createdTicketIds(result.body) : []
    if (newTicketIds.length) {
      after(async () => {
        try {
          const drafts = await generateAutomaticSuggestedAnswers(admin, newTicketIds, "auto")
          for (const d of drafts) {
            if (d.status === "failed") console.error(`[api/v1/support-captures] draft failed for ${d.ticketId}: ${d.error}`)
          }
        } catch (error) {
          console.error(
            "[api/v1/support-captures] drafts failed:",
            error instanceof Error ? error.message : error
          )
        }
      })
    }
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error(
      "[api/v1/support-captures] capture failed:",
      error instanceof Error ? error.message : error
    )
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE })
  }
}
