import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { buildAssemblyDeepLink, type WinCategory, type WinConfidence, type WinReviewState } from "@/lib/wins"
import {
  getClientChatTargets,
  getLatestWinsRun,
  getWinClientOptions,
  getWinsPage,
  getWinsSummary,
} from "@/lib/wins-queries"

import { WinsView } from "./wins-view"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CATEGORIES: WinCategory[] = [
  "double_win",
  "yoy_positive_steady",
  "market_compass_candidate",
  "conflicting_signal",
  "insufficient_data",
  "no_win",
]
const CONFIDENCES: WinConfidence[] = ["high", "medium", "low", "none"]
const STATES: WinReviewState[] = ["new", "in_review", "shared_manually", "dismissed", "snoozed"]

export default async function WinsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const canView = await hasPermission("wins", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()
  const sp = await searchParams

  // Allowlist every parameter. A URL parameter must never be able to widen the
  // query beyond what the RLS policy would have allowed anyway.
  const category = CATEGORIES.includes(sp.category as WinCategory)
    ? (sp.category as WinCategory)
    : null
  const confidence = CONFIDENCES.includes(sp.confidence as WinConfidence)
    ? (sp.confidence as WinConfidence)
    : null
  const state = STATES.includes(sp.state as WinReviewState) ? (sp.state as WinReviewState) : null
  const clientId = sp.client && UUID_RE.test(sp.client) ? sp.client : null
  const hasChat = sp.chat === "yes" || sp.chat === "no" ? sp.chat : null
  const search = sp.q?.trim() || null
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  // The default view is the "ready to communicate" queue: conflicting signals
  // and blocked candidates are reachable by filter, never by default.
  const readyOnly = !category && sp.view !== "all"

  const [run, canEdit, canControl] = await Promise.all([
    getLatestWinsRun(supabase),
    hasPermission("wins", "edit"),
    hasPermission("wins", "control"),
  ])

  if (!run) {
    return (
      <WinsView
        run={null}
        summary={null}
        candidates={[]}
        count={0}
        page={1}
        clients={[]}
        filters={{ category, confidence, clientId, state, hasChat, search, readyOnly }}
        canEdit={canEdit}
        canControl={canControl}
      />
    )
  }

  const [pageResult, summary, clients] = await Promise.all([
    getWinsPage(supabase, run.id, {
      category,
      confidence,
      clientId,
      state,
      search,
      readyOnly,
      page,
    }),
    getWinsSummary(supabase, run.id),
    getWinClientOptions(supabase, run.id),
  ])

  // The Assembly deep link is resolved server-side and only ever attached for
  // wins:control. Without that permission the prop is null and the client
  // component has nothing to open.
  let candidates = pageResult.candidates
  if (canControl) {
    const clientIds = [...new Set(candidates.map((c) => c.client_id).filter((id): id is string => Boolean(id)))]
    const chatTargets = await getClientChatTargets(supabase, clientIds)
    candidates = candidates.map((c) => ({
      ...c,
      assembly_deep_link: c.client_id
        ? buildAssemblyDeepLink(chatTargets.get(c.client_id) ?? {})
        : null,
    }))
  } else {
    candidates = candidates.map((c) => ({ ...c, assembly_deep_link: null }))
  }

  if (hasChat) {
    const want = hasChat === "yes"
    candidates = candidates.filter((c) => Boolean(c.assembly_deep_link) === want)
  }

  return (
    <WinsView
      run={run}
      summary={summary}
      candidates={candidates}
      count={pageResult.count}
      page={pageResult.page}
      clients={clients}
      filters={{ category, confidence, clientId, state, hasChat, search, readyOnly }}
      canEdit={canEdit}
      canControl={canControl}
    />
  )
}
