import { hasPermission } from "@/lib/permissions.server"
import type { RevAiMention } from "@/lib/revai/mentions"
import { createClient } from "@/lib/supabase/server"

// Composer @-mention search across clients, listings, tickets and adjustments.
// Runs on the user's RLS client; returns only names and ids.

function clean(value: string): string {
  return value.replace(/[\\%_,()]/g, " ").trim().slice(0, 60)
}

export async function GET(request: Request) {
  if (!(await hasPermission("agent_studio", "view"))) {
    return Response.json({ results: [] }, { status: 403 })
  }
  const query = clean(new URL(request.url).searchParams.get("q") ?? "")
  const supabase = await createClient()
  const like = `%${query}%`
  const ticketNumber = /^#?\d+$/.test(query) ? Number(query.replace("#", "")) : null

  const [clients, listings, tickets, adjustments] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, status")
      .neq("status", "test")
      .ilike("name", like)
      .order("name")
      .limit(5),
    supabase
      .from("listings")
      .select("id, name, status, city, airbnb_id, clients(name)")
      .neq("status", "test")
      .or(`name.ilike.${like}${/^\d+$/.test(query) ? `,airbnb_id.eq.${query}` : ""}`)
      .order("status")
      .order("name")
      .limit(6),
    ticketNumber !== null
      ? supabase
          .from("support_tickets")
          .select("id, ticket_number, status, summary, clients(name)")
          .eq("ticket_number", ticketNumber)
          .limit(3)
      : supabase
          .from("support_tickets")
          .select("id, ticket_number, status, summary, clients(name)")
          .ilike("summary", like)
          .order("requested_at", { ascending: false })
          .limit(4),
    supabase
      .from("adjustments")
      .select("id, type, status, date_from, listings!inner(name)")
      .ilike("listings.name", like)
      .order("created_at", { ascending: false })
      .limit(4),
  ])

  const name = (value: unknown) => (value as { name?: string } | null)?.name ?? null
  const results: RevAiMention[] = [
    ...(clients.data ?? []).map((client) => ({
      kind: "client" as const,
      id: client.id,
      label: client.name,
      detail: client.status,
      href: `/clients/${client.id}`,
    })),
    ...(listings.data ?? []).map((listing) => ({
      kind: "listing" as const,
      id: listing.id,
      label: listing.name,
      detail: [name(listing.clients), listing.city, listing.status === "active" ? null : listing.status]
        .filter(Boolean)
        .join(" · ") || null,
      href: `/listings/${listing.id}`,
    })),
    ...(tickets.data ?? []).map((ticket) => ({
      kind: "ticket" as const,
      id: ticket.id,
      label: `#${ticket.ticket_number}`,
      detail: [name(ticket.clients), ticket.summary?.slice(0, 60), ticket.status].filter(Boolean).join(" · ") || null,
      href: `/support/${ticket.id}`,
    })),
    ...(adjustments.data ?? []).map((adjustment) => ({
      kind: "adjustment" as const,
      id: adjustment.id,
      label: `${adjustment.type.replace(/_/g, " ")} · ${name(adjustment.listings) ?? "listing"}`,
      detail: [adjustment.status, adjustment.date_from].filter(Boolean).join(" · ") || null,
      href: `/adjustments/${adjustment.id}`,
    })),
  ]

  return Response.json({ results })
}
