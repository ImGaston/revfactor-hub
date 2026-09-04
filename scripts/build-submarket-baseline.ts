import { writeFile } from "node:fs/promises"
import { createAdminClient } from "@/lib/supabase/admin"

async function main() {
  const db = createAdminClient()
  const slugs = ["asheville-area-nc", "lake-lure-nc", "knoxville-tn", "eastern-connecticut-ct"]
  const { data: proposals, error: proposalError } = await db.from("revenue_market_proposals").select("id,proposed_slug,proposed_name").in("proposed_slug", slugs)
  if (proposalError) throw proposalError
  const proposalIds = (proposals ?? []).map((p) => p.id)
  const { data: candidates, error: candidateError } = await db.from("revenue_market_proposal_listings").select("proposal_id,listing_id,review_status").in("proposal_id", proposalIds)
  if (candidateError) throw candidateError
  const listingIds = (candidates ?? []).map((c) => c.listing_id)
  const { data: reservations, error: reservationError } = await db.from("pricelabs_reservations_cache").select("hub_listing_id,rental_revenue,number_of_days,currency").eq("booking_status", "booked").eq("currency", "USD").in("hub_listing_id", listingIds)
  if (reservationError) throw reservationError
  const byListing = new Map<string, { reservations: number; revenue: number; nights: number }>()
  for (const row of reservations ?? []) { if (!row.hub_listing_id) continue; const current = byListing.get(row.hub_listing_id) ?? { reservations: 0, revenue: 0, nights: 0 }; current.reservations += 1; current.revenue += Number(row.rental_revenue) || 0; current.nights += Number(row.number_of_days) || 0; byListing.set(row.hub_listing_id, current) }
  const output = (proposals ?? []).map((proposal) => { const rows = (candidates ?? []).filter((c) => c.proposal_id === proposal.id).map((c) => ({ listing_key: `candidate-${c.listing_id.slice(0, 8)}`, review_status: c.review_status, baseline: byListing.get(c.listing_id) ?? { reservations: 0, revenue: 0, nights: 0 } })); return { ...proposal, listings: rows, aggregate: rows.reduce((a, r) => ({ reservations: a.reservations + r.baseline.reservations, revenue: a.revenue + r.baseline.revenue, nights: a.nights + r.baseline.nights }), { reservations: 0, revenue: 0, nights: 0 }) } })
  await writeFile("artifacts/submarket-adr-baseline.json", JSON.stringify({ version: 1, generated_at: new Date().toISOString(), read_only: true, currency: "USD", warning: "Thin samples are descriptive only and must not set automatic markup floors.", markets: output }, null, 2) + "\n")
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
