"use server"

import { z } from "zod"

import { isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import type { SupportAskDigest } from "@/lib/support-ask-plain"
import {
  generateSupportAskDigest,
  loadAskInputs,
  loadAskListings,
  loadAskThread,
  loadSupportAskPlain,
  saveSupportAskDigest,
  type AskTicket,
} from "@/lib/support-ask-plain.server"
import type { MergeCheckTicket, SupportMergeCheck } from "@/lib/support-merge-check"
import { generateMergeCheck } from "@/lib/support-merge-check.server"
import { supportPropertyScopeLabel } from "@/lib/support-tickets"

type Result = { ok: true; digest: SupportAskDigest } | { ok: false; error: string }

const ASK_TICKET_COLUMNS = "id, ticket_number, client_id, client_message, requested_at, summary, category, request_type"

/**
 * The client's ask, digested. Returns the saved digest while it matches the
 * thread and listings; otherwise writes a new one and saves it for people who
 * can edit tickets (viewers still see it, just not saved). `force` rewrites it.
 */
export async function plainAskAction(ticketId: string, force = false): Promise<Result> {
  if (!z.uuid().safeParse(ticketId).success) return { ok: false, error: "Ticket not found" }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await hasPermission("support", "view"))) return { ok: false, error: "Not allowed" }

  const { data, error } = await supabase.from("support_tickets").select(ASK_TICKET_COLUMNS).eq("id", ticketId).maybeSingle()
  if (error || !data) return { ok: false, error: "Ticket not found" }
  const ticket = data as AskTicket

  const { messages, listings, hash } = await loadAskInputs(supabase, ticket)
  if (!hash) return { ok: false, error: "No client message to digest" }

  const saved = await loadSupportAskPlain(supabase, ticketId, hash)
  if (!force && saved.digest && saved.fresh)
    return { ok: true, digest: { wants: saved.digest.wants, says: saved.digest.says, details: saved.digest.details } }
  if (!saved.schemaReady) return { ok: false, error: "Not set up yet" }
  if (!isAiGatewayConfigured()) return { ok: false, error: "AI Gateway is not configured" }

  try {
    const digest = await generateSupportAskDigest(ticket, messages, listings, user.id)
    if (await hasPermission("support", "edit")) await saveSupportAskDigest(supabase, ticketId, hash, digest, user.id)
    return { ok: true, digest }
  } catch (err) {
    console.error("ask digest generation failed", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't write the digest. Try again." }
  }
}

type MergeTicketRow = AskTicket & { property_scope: string; merged_into: string | null; status: string }

/**
 * "Check with AI" before a merge: same ask or not, what the closing ticket
 * adds, and a title that covers both. Reads only; the merge stays a separate click.
 */
export async function checkMergeAction(
  sourceId: string,
  targetId: string
): Promise<{ ok: true; check: SupportMergeCheck } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(sourceId).success || !z.uuid().safeParse(targetId).success || sourceId === targetId)
    return { ok: false, error: "Pick a ticket to merge into" }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await hasPermission("support", "edit"))) return { ok: false, error: "Not allowed" }
  if (!isAiGatewayConfigured()) return { ok: false, error: "AI Gateway is not configured" }

  const { data, error } = await supabase
    .from("support_tickets")
    .select(`${ASK_TICKET_COLUMNS}, property_scope, merged_into, status`)
    .in("id", [sourceId, targetId])
  if (error) return { ok: false, error: "Couldn't load the tickets" }
  const rows = (data ?? []) as MergeTicketRow[]
  const source = rows.find((r) => r.id === sourceId)
  const target = rows.find((r) => r.id === targetId)
  if (!source || !target) return { ok: false, error: "Ticket not found" }
  if (source.client_id !== target.client_id) return { ok: false, error: "Only tickets of the same client can be merged" }

  const [sourceThread, targetThread, listings, promises, properties] = await Promise.all([
    loadAskThread(supabase, source),
    loadAskThread(supabase, target),
    loadAskListings(supabase, source.client_id),
    supabase.from("support_ticket_commitments").select("ticket_id, description").in("ticket_id", [sourceId, targetId]).eq("status", "open"),
    supabase.from("support_ticket_listings").select("ticket_id, listings(name)").in("ticket_id", [sourceId, targetId]),
  ])
  const promiseRows = (promises.data ?? []) as { ticket_id: string; description: string }[]
  const propertyRows = (properties.data ?? []) as unknown as { ticket_id: string; listings: { name: string } | null }[]
  const describe = (row: MergeTicketRow, messages: typeof sourceThread): MergeCheckTicket => {
    const names = propertyRows.filter((p) => p.ticket_id === row.id && p.listings?.name).map((p) => p.listings!.name)
    return {
      ticketNumber: row.ticket_number,
      summary: row.summary,
      category: row.category,
      requestType: row.request_type,
      property: names.length ? names.join(", ") : supportPropertyScopeLabel(row.property_scope),
      openPromises: promiseRows.filter((p) => p.ticket_id === row.id).map((p) => p.description),
      messages,
    }
  }

  try {
    const check = await generateMergeCheck(
      { source: describe(source, sourceThread), target: describe(target, targetThread), listings },
      user.id
    )
    return { ok: true, check }
  } catch (err) {
    console.error("merge check failed", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't check the merge. Try again." }
  }
}
