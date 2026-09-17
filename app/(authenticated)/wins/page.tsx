import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { buildAssemblyDeepLink, type WinCategory, type WinConfidence, type WinReviewState } from "@/lib/wins"
import {
  BEDROOM_BUCKETS,
  PORTFOLIO_SIZE_BUCKETS,
  parseAllowedList,
} from "@/lib/wins-filters"
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
const PORTFOLIO_SIZES = PORTFOLIO_SIZE_BUCKETS.map((b) => b.value)
const BEDROOMS = BEDROOM_BUCKETS.map((b) => b.value)

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
  // Multi-value filters travel as comma-separated lists.
  const confidences = parseAllowedList(sp.confidence, CONFIDENCES)
  const states = parseAllowedList(sp.state, STATES)
  const clientIds = [...new Set((sp.client ?? "").split(","))].filter((v) => UUID_RE.test(v))
  const portfolioSizes = parseAllowedList(sp.size, PORTFOLIO_SIZES)
  const bedrooms = parseAllowedList(sp.beds, BEDROOMS)
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
        filters={{
          category,
          confidences,
          clientIds,
          states,
          portfolioSizes,
          bedrooms,
          hasChat,
          search,
          readyOnly,
        }}
        canEdit={canEdit}
        canControl={canControl}
      />
    )
  }

  const [pageResult, summary, clients] = await Promise.all([
    getWinsPage(supabase, run.id, {
      category,
      confidences,
      clientIds,
      states,
      portfolioSizes,
      bedrooms,
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
      filters={{
          category,
          confidences,
          clientIds,
          states,
          portfolioSizes,
          bedrooms,
          hasChat,
          search,
          readyOnly,
        }}
      canEdit={canEdit}
      canControl={canControl}
    />
  )
}
