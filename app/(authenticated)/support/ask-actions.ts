"use server"

import { z } from "zod"

import { isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import type { SupportAskPlain } from "@/lib/support-ask-plain"
import {
  generateSupportAskPlain,
  loadSupportAskPlain,
  saveSupportAskPlain,
} from "@/lib/support-ask-plain.server"

type Result = { ok: true; plain: SupportAskPlain } | { ok: false; error: string }

/**
 * The client's ask in plain English. Returns the saved version while it
 * matches the message; otherwise writes a new one and saves it for people
 * who can edit tickets (viewers still see it, just not saved).
 */
export async function plainAskAction(ticketId: string): Promise<Result> {
  if (!z.uuid().safeParse(ticketId).success) return { ok: false, error: "Ticket not found" }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await hasPermission("support", "view"))) return { ok: false, error: "Not allowed" }

  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .select("id, client_message")
    .eq("id", ticketId)
    .maybeSingle()
  if (error || !ticket) return { ok: false, error: "Ticket not found" }
  const message = ticket.client_message as string | null
  if (!message) return { ok: false, error: "No client message to rewrite" }

  const saved = await loadSupportAskPlain(supabase, ticketId, message)
  if (saved.plain && saved.fresh) return { ok: true, plain: { wants: saved.plain.wants, says: saved.plain.says } }
  if (!saved.schemaReady) return { ok: false, error: "Not set up yet" }
  if (!isAiGatewayConfigured()) return { ok: false, error: "AI Gateway is not configured" }

  try {
    const plain = await generateSupportAskPlain(message, user.id)
    if (await hasPermission("support", "edit")) await saveSupportAskPlain(supabase, ticketId, message, plain, user.id)
    return { ok: true, plain }
  } catch (err) {
    console.error("plain ask generation failed", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't write the plain version. Try again." }
  }
}
