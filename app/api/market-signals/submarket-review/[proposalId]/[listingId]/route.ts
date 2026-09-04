import { NextResponse } from "next/server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function POST(request: Request, context: { params: Promise<{ proposalId: string; listingId: string }> }) {
  if (!(await hasPermission("market_signals", "edit"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { proposalId, listingId } = await context.params
  const body = await request.json().catch(() => null) as { decision?: string; notes?: string } | null
  if (!body || !["accepted", "rejected"].includes(body.decision ?? "")) return NextResponse.json({ error: "decision must be accepted or rejected" }, { status: 400 })
  const db = await createClient()
  const { data, error } = await db.from("revenue_market_proposal_listings").update({ review_status: body.decision, review_notes: body.notes?.slice(0, 2000) ?? null, reviewed_at: new Date().toISOString() }).eq("proposal_id", proposalId).eq("listing_id", listingId).eq("review_status", "needs_review").select("proposal_id,listing_id,review_status,review_notes,reviewed_at").maybeSingle()
  if (error) return NextResponse.json({ error: "Candidate review failed" }, { status: 503 })
  if (!data) return NextResponse.json({ error: "Candidate not found or already reviewed" }, { status: 409 })
  return NextResponse.json({ readOnly: false, candidate: data })
}
