import "server-only"

// Reads, writes, and generates the client's-ask digest. Session client only:
// RLS (support:view to read, support:edit to save; listings under their own
// RLS) is the gate.

import type { SupabaseClient } from "@supabase/supabase-js"
import { isStepCount, Output, ToolLoopAgent } from "ai"

import {
  SUPPORT_ASK_DIGEST_VERSION,
  SUPPORT_ASK_PLAIN_INSTRUCTIONS,
  SUPPORT_ASK_PLAIN_MODEL_ID,
  askDigestHash,
  askPlainViolations,
  buildAskPlainPrompt,
  orderAskThread,
  prepareAskThread,
  supportAskPlainSchema,
  toAskDigest,
  type AskListing,
  type AskThreadMessage,
  type SupportAskDigest,
  type SupportAskDigestDetails,
  type SupportAskPlainOutput,
} from "@/lib/support-ask-plain"
import { isMissingRelation } from "@/lib/support-answers.server"

const TIMEOUT_MS = 45_000

export type AskTicket = {
  id: string
  ticket_number: number
  client_id: string
  client_message: string | null
  requested_at: string
  summary: string
  category: string
  request_type: string
}

/**
 * Every client message on the ticket, oldest first: its own ask, later client
 * messages, and the asks and messages of tickets merged into it.
 */
export async function loadAskThread(supabase: SupabaseClient, ticket: AskTicket): Promise<AskThreadMessage[]> {
  const { data: merged, error: mergedError } = await supabase
    .from("support_tickets")
    .select("id, ticket_number, client_message, requested_at")
    .eq("merged_into", ticket.id)
  if (mergedError) throw new Error(`merged asks load failed: ${mergedError.message}`)
  const mergedRows = (merged ?? []) as { id: string; ticket_number: number; client_message: string | null; requested_at: string }[]
  const numberById = new Map([[ticket.id, ticket.ticket_number], ...mergedRows.map((m) => [m.id, m.ticket_number] as const)])

  const { data: events, error } = await supabase
    .from("support_ticket_events")
    .select("ticket_id, body, occurred_at")
    .in("ticket_id", [...numberById.keys()])
    .eq("event_type", "client_message")
    .not("body", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(60)
  if (error) throw new Error(`client messages load failed: ${error.message}`)

  const messages: AskThreadMessage[] = []
  if (ticket.client_message)
    messages.push({ at: ticket.requested_at, text: ticket.client_message, ticketNumber: ticket.ticket_number, merged: false })
  for (const m of mergedRows)
    if (m.client_message) messages.push({ at: m.requested_at, text: m.client_message, ticketNumber: m.ticket_number, merged: true })
  for (const e of (events ?? []) as { ticket_id: string; body: string; occurred_at: string }[])
    messages.push({
      at: e.occurred_at,
      text: e.body,
      ticketNumber: numberById.get(e.ticket_id) ?? ticket.ticket_number,
      merged: e.ticket_id !== ticket.id,
    })
  return orderAskThread(messages)
}

/** The client's listings for property matching; empty when RLS hides them. */
export async function loadAskListings(supabase: SupabaseClient, clientId: string): Promise<AskListing[]> {
  const { data, error } = await supabase
    .from("listings")
    .select("id, name, city, state, pl_no_of_bedrooms, status")
    .eq("client_id", clientId)
    .order("name")
  if (error) return []
  return ((data ?? []) as { id: string; name: string; city: string | null; state: string | null; pl_no_of_bedrooms: number | null; status: string | null }[])
    .filter((l) => l.status !== "inactive")
    .map((l) => ({ id: l.id, name: l.name, city: l.city, state: l.state, bedrooms: l.pl_no_of_bedrooms, status: l.status }))
}

export type SupportAskPlainState = {
  /** False until the digest migrations are applied: the section hides */
  schemaReady: boolean
  digest: (SupportAskDigest & { generatedAt: string }) | null
  /** The saved digest was written from the current thread and listings */
  fresh: boolean
}

export async function loadSupportAskPlain(
  supabase: SupabaseClient,
  ticketId: string,
  hash: string | null
): Promise<SupportAskPlainState> {
  const { data, error } = await supabase
    .from("support_ticket_ask_plain")
    .select("wants, says, details, source_hash, generated_at")
    .eq("ticket_id", ticketId)
    .maybeSingle()
  if (error) {
    // The details column (20261009170000) not applied yet reads as missing too
    if (isMissingRelation(error) || /details/.test(error.message)) return { schemaReady: false, digest: null, fresh: false }
    throw new Error(`ask digest load failed: ${error.message}`)
  }
  if (!data) return { schemaReady: true, digest: null, fresh: false }
  const details = (data.details ?? {}) as SupportAskDigestDetails
  return {
    schemaReady: true,
    digest: { wants: data.wants, says: data.says ?? [], details, generatedAt: data.generated_at },
    fresh: !!hash && data.source_hash === hash && details.version === SUPPORT_ASK_DIGEST_VERSION,
  }
}

/** One model call, plus one retry when a sentence breaks the length cap. */
export async function generateSupportAskDigest(
  ticket: AskTicket,
  messages: AskThreadMessage[],
  listings: AskListing[],
  userLabel: string
): Promise<SupportAskDigest> {
  const agent = new ToolLoopAgent({
    id: "revfactor-support-ask-digest",
    model: SUPPORT_ASK_PLAIN_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_ASK_PLAIN_INSTRUCTIONS,
    providerOptions: {
      gateway: {
        user: userLabel,
        tags: ["feature:support-ask-plain", `environment:${process.env.VERCEL_ENV ?? "development"}`],
      },
    },
    output: Output.object({ schema: supportAskPlainSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 1400,
  })
  const { lines, links } = prepareAskThread(messages)
  const input = {
    ticketNumber: ticket.ticket_number,
    summary: ticket.summary,
    category: ticket.category,
    requestType: ticket.request_type,
    listings,
    lines,
    links,
  }
  let violations: string[] = []
  let output: SupportAskPlainOutput | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await agent.generate({
      prompt: buildAskPlainPrompt(input, violations),
      timeout: { totalMs: TIMEOUT_MS, stepMs: TIMEOUT_MS },
    })
    output = result.output
    violations = askPlainViolations(output)
    if (violations.length === 0) break
  }
  // Two tries: a long sentence still beats no digest
  return toAskDigest(output as SupportAskPlainOutput, listings, links)
}

export async function saveSupportAskDigest(
  supabase: SupabaseClient,
  ticketId: string,
  hash: string,
  digest: SupportAskDigest,
  userId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("support_ticket_ask_plain").upsert(
    {
      ticket_id: ticketId,
      wants: digest.wants,
      says: digest.says,
      details: digest.details,
      source_hash: hash,
      model: SUPPORT_ASK_PLAIN_MODEL_ID,
      generated_by: userId,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "ticket_id" }
  )
  if (error) console.error("ask digest save failed", error.message)
  return { ok: !error }
}

/** Thread, listings, and the hash the saved digest must match. */
export async function loadAskInputs(supabase: SupabaseClient, ticket: AskTicket) {
  const [messages, listings] = await Promise.all([loadAskThread(supabase, ticket), loadAskListings(supabase, ticket.client_id)])
  return { messages, listings, hash: messages.length ? askDigestHash(messages, listings) : null }
}
