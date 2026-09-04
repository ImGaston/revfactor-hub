import { NextResponse } from "next/server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await hasPermission("market_signals", "view"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const db = await createClient()
  const { data: markets, error } = await db.from("revenue_markets").select("id,slug,name,status,center_lat,center_lon,radius_miles,market_kind").in("slug", ["asheville-area-nc", "lake-lure-nc", "knoxville-tn", "eastern-connecticut-ct"])
  if (error) return NextResponse.json({ error: "Submarket review unavailable" }, { status: 503 })
  const ids = (markets ?? []).map((market) => market.id)
  const [{ data: localities }, { data: proposals }] = await Promise.all([
    db.from("revenue_market_localities").select("market_id,slug,name,status").in("market_id", ids),
    db.from("revenue_market_proposals").select("id,proposed_slug,status").in("proposed_slug", ["asheville-area-nc", "lake-lure-nc", "knoxville-tn", "eastern-connecticut-ct"]),
  ])
  const proposalIds = (proposals ?? []).map((proposal) => proposal.id)
  const { data: candidates } = await db.from("revenue_market_proposal_listings").select("proposal_id,review_status,distance_miles,proposed_locality_slug").in("proposal_id", proposalIds)
  return NextResponse.json({ version: 1, readOnly: true, generatedAt: new Date().toISOString(), markets: (markets ?? []).map((market) => { const proposal = (proposals ?? []).find((row) => row.proposed_slug === market.slug); const rows = (candidates ?? []).filter((row) => row.proposal_id === proposal?.id); return { ...market, localities: (localities ?? []).filter((row) => row.market_id === market.id), proposalStatus: proposal?.status ?? null, candidateCount: rows.length, candidateReviewStatuses: rows.reduce<Record<string, number>>((acc, row) => { acc[row.review_status] = (acc[row.review_status] ?? 0) + 1; return acc }, {}) } }) })
}
