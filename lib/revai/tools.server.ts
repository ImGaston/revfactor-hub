import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { tool } from "ai"
import { z } from "zod"

import { loadAgentStudioPriceLabsReport } from "@/lib/agent-studio-pricelabs.server"
import { keywordSearchKnowledge } from "@/lib/knowledge-retrieval"
import { getWikifactor } from "@/lib/revai/wikifactor.server"
import { readWikifactorDoc, searchWikifactor } from "@/lib/revai/wikifactor"

// Read-only RevAI tools. Every number the model quotes comes from these
// queries or from code below; the model only words the answer. All queries run
// on the signed-in user's Supabase client, so RLS applies. Financial fields
// are returned only to super_admin, matching the /financials rule.

const OPEN_TICKET_STATUSES = ["new", "open", "in_progress", "awaiting_client"]
const OPEN_ADJUSTMENT_STATUSES = ["open", "resolved"]

function escapeLike(value: string): string {
  return value.replace(/[\\%_,()]/g, " ").trim()
}

function round(value: number | null | undefined, digits = 1): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function average(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (numbers.length === 0) return null
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
}

function gap(own: number | null, market: number | null): number | null {
  return own === null || market === null ? null : round(own - market)
}

export function createRevAiTools({
  supabase,
  isSuperAdmin,
}: {
  supabase: SupabaseClient
  isSuperAdmin: boolean
}) {
  return {
    searchWikifactor: tool({
      description:
        "Search Wikifactor, RevFactor's source of truth: BRAIN rules, the ontology, playbooks, policies, pricing skills/frameworks, decisions, metrics definitions, review items, and per-client/per-listing history pages. Use it for any how-we-work, policy, framework, definition, or client-history question.",
      inputSchema: z.object({
        query: z.string().min(2).max(300).describe("Focused keywords, e.g. 'minimum stay gap nights policy'"),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ query, limit }) => {
        const { corpus, index } = getWikifactor()
        const hits = searchWikifactor(index, query, limit ?? 6)
        return {
          snapshot: { baseSha: corpus.base.sha.slice(0, 7), generatedAt: corpus.generatedAt },
          hits,
          note: hits.length ? undefined : "Nothing in Wikifactor matched. Say it is not on file rather than guessing.",
        }
      },
    }),

    readWikifactorPage: tool({
      description:
        "Read one full Wikifactor page by path (from a search hit or a [[wiki link]]), e.g. 'BRAIN.md', 'ontology/README.md', 'playbooks/setup-spec.md'.",
      inputSchema: z.object({ path: z.string().min(2).max(200) }),
      execute: async ({ path }) => {
        const { corpus } = getWikifactor()
        return readWikifactorDoc(corpus, path) ?? { error: `No Wikifactor page at ${path}.` }
      },
    }),

    searchHubKnowledge: tool({
      description:
        "Search the Hub Knowledge base (published SOPs, policies and approved client answers written in the Hub).",
      inputSchema: z.object({ query: z.string().min(3).max(240) }),
      execute: async ({ query }) => {
        const { data, error } = await supabase
          .from("knowledge_articles")
          .select("id, title, slug, excerpt, content_html, canonical_question, approved_answer, escalation_guidance, updated_at")
          .eq("status", "published")
          .order("updated_at", { ascending: false })
          .limit(200)
        if (error) return { error: "Knowledge could not be read." }
        return {
          results: keywordSearchKnowledge(data ?? [], query, 4).map((article) => ({
            title: article.title,
            link: `/knowledge/${article.slug}`,
            approvedAnswer: article.approvedAnswer || null,
            content: article.content,
            updatedAt: article.sourceUpdatedAt,
          })),
        }
      },
    }),

    findClients: tool({
      description:
        "Find Hub clients by name, business name, email, or market. Returns ids needed by getClientDetail and getClientPerformance.",
      inputSchema: z.object({
        query: z.string().max(120).optional().describe("Leave empty to list by status"),
        status: z.enum(["active", "onboarding", "inactive", "any"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, status, limit }) => {
        let request = supabase
          .from("clients")
          .select("id, name, business_name, status, market, pms_name, onboarding_date, ending_date, churn_risk, listings(count)")
          .neq("status", "test")
          .order("name")
          .limit(limit ?? 15)
        if (status && status !== "any") request = request.eq("status", status)
        const term = query ? escapeLike(query) : ""
        if (term) {
          request = request.or(
            `name.ilike.%${term}%,business_name.ilike.%${term}%,email.ilike.%${term}%,market.ilike.%${term}%`
          )
        }
        const { data, error } = await request
        if (error) return { error: "Clients could not be read." }
        return {
          clients: (data ?? []).map((client) => ({
            id: client.id,
            name: client.name,
            businessName: client.business_name,
            status: client.status,
            market: client.market,
            pms: client.pms_name,
            onboardingDate: client.onboarding_date,
            endingDate: client.ending_date,
            churnRisk: client.churn_risk,
            listingCount: (client.listings as unknown as Array<{ count: number }> | null)?.[0]?.count ?? 0,
            hubLink: `/clients/${client.id}`,
          })),
        }
      },
    }),

    findListings: tool({
      description:
        "Find listings by name, alias, city, Airbnb ID, or PriceLabs listing ID. Returns current PriceLabs prices and forward occupancy vs market.",
      inputSchema: z.object({
        query: z.string().min(2).max(120),
        includeInactive: z.boolean().optional(),
      }),
      execute: async ({ query, includeInactive }) => {
        const term = escapeLike(query)
        let request = supabase
          .from("listings")
          .select(
            "id, name, status, city, state, airbnb_id, listing_id, client_id, managed_by, pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_push_enabled, pl_last_booked_date, pl_synced_at, clients(name)"
          )
          .or(`name.ilike.%${term}%,city.ilike.%${term}%,airbnb_id.eq.${term},listing_id.eq.${term}`)
          .order("name")
          .limit(20)
        if (!includeInactive) request = request.eq("status", "active")
        const { data, error } = await request
        if (error) return { error: "Listings could not be read." }
        return { listings: (data ?? []).map(shapeListing) }
      },
    }),

    getClientDetail: tool({
      description:
        "Everything the Hub knows about one client: profile, listings with PriceLabs settings and forward occupancy vs market, open adjustments, open support tickets, onboarding, latest listing reviews, and recent wins.",
      inputSchema: z.object({ clientId: z.string().uuid() }),
      execute: async ({ clientId }) => {
        const clientColumns = `id, name, business_name, email, status, market, pms_name, has_vrbo, onboarding_date, contract_term, ending_date, ending_reason_tags, ending_note, churn_risk, pricelabs_group, assembly_link, dashboard_url, support_hand_managed${
          isSuperAdmin ? ", billing_amount, autopayment_set_up" : ""
        }`
        const [client, listings, adjustments, tickets, onboarding, reviews, wins] = await Promise.all([
          supabase.from("clients").select(clientColumns).eq("id", clientId).maybeSingle(),
          supabase
            .from("listings")
            .select(
              "id, name, status, city, state, airbnb_id, listing_id, client_id, managed_by, pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_push_enabled, pl_last_booked_date, pl_synced_at"
            )
            .eq("client_id", clientId)
            .order("status")
            .order("name")
            .limit(60),
          supabase
            .from("adjustments")
            .select("id, type, status, scope, target_value, date_from, date_to, urgency, origin_message, created_at, resolved_at, controlled_at, listings(name)")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(15),
          supabase
            .from("support_tickets")
            .select("ticket_number, status, priority, category, request_type, summary, requested_at, answer_summary, answered_at")
            .eq("client_id", clientId)
            .order("requested_at", { ascending: false })
            .limit(12),
          supabase
            .from("onboarding_runs")
            .select("status, current_step, run_type, started_at, submitted_at, live_at, has_pms, pms_name, has_pricelabs, client_note")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(2),
          supabase
            .from("listing_optimization_reports")
            .select("listing_title, status, overall_score, summary, audited_at, published_at")
            .eq("client_id", clientId)
            .order("audited_at", { ascending: false })
            .limit(5),
          supabase
            .from("win_candidates")
            .select("listing_name_snapshot, category, confidence, reason_codes, created_at")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(5),
        ])

        if (client.error || !client.data) return { error: "Client not found or not visible to you." }
        const listingRows = (listings.data ?? []).map(shapeListing)
        const active = listingRows.filter((listing) => listing.status === "active")

        return {
          client: { ...(client.data as unknown as Record<string, unknown>), hubLink: `/clients/${clientId}` },
          listingSummary: {
            active: active.length,
            inactive: listingRows.length - active.length,
            avgOccupancyNext30: round(average(active.map((listing) => listing.occupancyNext30))),
            avgMarketOccupancyNext30: round(average(active.map((listing) => listing.marketOccupancyNext30))),
            listingsBehindMarketNext30: active.filter(
              (listing) => listing.gapNext30 !== null && listing.gapNext30 < -10
            ).length,
            pushDisabled: active.filter((listing) => listing.pushEnabled === false).length,
          },
          listings: listingRows,
          adjustments: (adjustments.data ?? []).map((adjustment) => ({
            ...adjustment,
            open: OPEN_ADJUSTMENT_STATUSES.includes(adjustment.status),
            origin_message: adjustment.origin_message?.slice(0, 400) ?? null,
          })),
          supportTickets: (tickets.data ?? []).map((ticket) => ({
            ...ticket,
            open: OPEN_TICKET_STATUSES.includes(ticket.status),
          })),
          onboarding: onboarding.data ?? [],
          listingReviews: reviews.data ?? [],
          recentWins: wins.data ?? [],
        }
      },
    }),

    getClientPerformance: tool({
      description:
        "Monthly PriceLabs Report Builder performance for one client: occupancy vs market, rental revenue, RevPAR and RevPAR index, with STLY and LY comparisons, plus the next 3 months per listing. Use for any revenue, pace, YoY, or 'revenue is down' question.",
      inputSchema: z.object({ clientId: z.string().uuid() }),
      execute: async ({ clientId }) => {
        const { data: listings } = await supabase
          .from("listings")
          .select("listing_id, name")
          .eq("client_id", clientId)
          .eq("status", "active")
        const report = await loadAgentStudioPriceLabsReport(
          supabase,
          clientId,
          (listings ?? []).map((listing) => ({ listingId: listing.listing_id, name: listing.name }))
        )
        if (!report) {
          return { error: "No Report Builder metrics are mapped to this client yet. Say so rather than estimating." }
        }
        return {
          ...report,
          portfolioMonthly: report.portfolioMonthly.map((month) => ({
            ...month,
            occupancyGapVsMarketPts: gap(month.occupancyPct, month.marketOccupancyPct),
            revenueVsStlyPct:
              month.rentalRevenue !== null && month.rentalRevenueStly
                ? round(((month.rentalRevenue - month.rentalRevenueStly) / month.rentalRevenueStly) * 100)
                : null,
            revenueVsLyPct:
              month.rentalRevenue !== null && month.rentalRevenueLy
                ? round(((month.rentalRevenue - month.rentalRevenueLy) / month.rentalRevenueLy) * 100)
                : null,
          })),
        }
      },
    }),

    getPortfolioSnapshot: tool({
      description:
        "RevFactor-wide counts computed from the Hub: clients and listings by status, open adjustments and support tickets by status and priority, forward 30-day occupancy vs market, and the listings furthest behind market.",
      inputSchema: z.object({}),
      execute: async () => {
        const [clients, listings, adjustments, tickets] = await Promise.all([
          supabase.from("clients").select("status, churn_risk").neq("status", "test"),
          supabase
            .from("listings")
            .select("id, name, status, client_id, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_push_enabled, pl_synced_at, clients(name)")
            .neq("status", "test"),
          supabase.from("adjustments").select("status, type, urgency").in("status", OPEN_ADJUSTMENT_STATUSES),
          supabase.from("support_tickets").select("status, priority").in("status", OPEN_TICKET_STATUSES),
        ])

        const countBy = <T,>(rows: T[] | null, key: (row: T) => string | null) => {
          const counts: Record<string, number> = {}
          for (const row of rows ?? []) {
            const value = key(row) ?? "unset"
            counts[value] = (counts[value] ?? 0) + 1
          }
          return counts
        }

        const active = (listings.data ?? []).filter((listing) => listing.status === "active")
        const withGap = active
          .map((listing) => ({
            id: listing.id,
            name: listing.name,
            client: (listing.clients as unknown as { name: string } | null)?.name ?? null,
            occupancyNext30: listing.pl_occupancy_next_30,
            marketOccupancyNext30: listing.pl_market_occupancy_next_30,
            gapNext30: gap(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30),
          }))
          .filter((listing) => listing.gapNext30 !== null)

        return {
          clientsByStatus: countBy(clients.data, (row) => row.status),
          activeClientsByChurnRisk: countBy(
            (clients.data ?? []).filter((row) => row.status === "active"),
            (row) => row.churn_risk
          ),
          listingsByStatus: countBy(listings.data, (row) => row.status),
          activeListingsPushDisabled: active.filter((listing) => listing.pl_push_enabled === false).length,
          activeListingsNeverSynced: active.filter((listing) => !listing.pl_synced_at).length,
          avgOccupancyNext30: round(average(active.map((listing) => listing.pl_occupancy_next_30))),
          avgMarketOccupancyNext30: round(average(active.map((listing) => listing.pl_market_occupancy_next_30))),
          listingsBehindMarketBy10PtsNext30: withGap.filter((listing) => (listing.gapNext30 ?? 0) < -10).length,
          furthestBehindMarketNext30: [...withGap].sort((a, b) => (a.gapNext30 ?? 0) - (b.gapNext30 ?? 0)).slice(0, 10),
          openAdjustmentsByStatus: countBy(adjustments.data, (row) => row.status),
          openAdjustmentsByType: countBy(adjustments.data, (row) => row.type),
          openTicketsByStatus: countBy(tickets.data, (row) => row.status),
          openTicketsByPriority: countBy(tickets.data, (row) => row.priority),
        }
      },
    }),

    listOpenWork: tool({
      description:
        "Open operational work across all clients: adjustments waiting to be resolved or controlled, open support tickets, and in-progress tasks, newest first.",
      inputSchema: z.object({
        kind: z.enum(["adjustments", "tickets", "tasks", "all"]).optional(),
        limit: z.number().int().min(1).max(40).optional(),
      }),
      execute: async ({ kind, limit }) => {
        const want = kind ?? "all"
        const take = limit ?? 15
        const [adjustments, tickets, tasks] = await Promise.all([
          want === "all" || want === "adjustments"
            ? supabase
                .from("adjustments")
                .select("type, status, urgency, target_value, date_from, date_to, created_at, clients_basic(name), listings(name)")
                .in("status", OPEN_ADJUSTMENT_STATUSES)
                .order("created_at", { ascending: false })
                .limit(take)
            : Promise.resolve({ data: null }),
          want === "all" || want === "tickets"
            ? supabase
                .from("support_tickets")
                .select("ticket_number, status, priority, category, summary, requested_at, clients(name)")
                .in("status", OPEN_TICKET_STATUSES)
                .order("requested_at", { ascending: false })
                .limit(take)
            : Promise.resolve({ data: null }),
          want === "all" || want === "tasks"
            ? supabase
                .from("tasks")
                .select("title, status, tags, updated_at, clients(name)")
                .neq("status", "done")
                .eq("is_archived", false)
                .order("updated_at", { ascending: false })
                .limit(take)
            : Promise.resolve({ data: null }),
        ])
        return {
          adjustments: adjustments.data ?? undefined,
          supportTickets: tickets.data ?? undefined,
          tasks: tasks.data ?? undefined,
        }
      },
    }),
  }
}

type ListingRow = {
  id: string
  name: string
  status: string
  city: string | null
  state: string | null
  airbnb_id: string | null
  listing_id: string | null
  client_id: string | null
  managed_by: string | null
  pl_base_price: number | null
  pl_min_price: number | null
  pl_max_price: number | null
  pl_recommended_base_price: number | null
  pl_occupancy_next_7: number | null
  pl_market_occupancy_next_7: number | null
  pl_occupancy_next_30: number | null
  pl_market_occupancy_next_30: number | null
  pl_mpi_next_30: number | null
  pl_push_enabled: boolean | null
  pl_last_booked_date: string | null
  pl_synced_at: string | null
  clients?: unknown
}

function shapeListing(listing: ListingRow) {
  return {
    id: listing.id,
    name: listing.name,
    client: (listing.clients as { name?: string } | null | undefined)?.name ?? undefined,
    clientId: listing.client_id,
    status: listing.status,
    location: [listing.city, listing.state].filter(Boolean).join(", ") || null,
    airbnbId: listing.airbnb_id,
    priceLabsId: listing.listing_id,
    managedBy: listing.managed_by,
    basePrice: listing.pl_base_price,
    minPrice: listing.pl_min_price,
    maxPrice: listing.pl_max_price,
    recommendedBasePrice: listing.pl_recommended_base_price,
    occupancyNext7: listing.pl_occupancy_next_7,
    marketOccupancyNext7: listing.pl_market_occupancy_next_7,
    occupancyNext30: listing.pl_occupancy_next_30,
    marketOccupancyNext30: listing.pl_market_occupancy_next_30,
    gapNext30: gap(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30),
    mpiNext30: listing.pl_mpi_next_30,
    pushEnabled: listing.pl_push_enabled,
    lastBookedDate: listing.pl_last_booked_date,
    priceLabsSyncedAt: listing.pl_synced_at,
    hubLink: `/listings/${listing.id}`,
  }
}
