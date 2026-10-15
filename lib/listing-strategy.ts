// Listing strategy plan (client & server safe): types for the stored plan and
// questions, plus pure helpers for the Strategy / Goals / Comps / Events tabs.
// Price math lives in lib/pricing-plan.ts.

import {
  DEFAULT_PLAN_CHANNELS,
  tightestChannel,
  type MonthTarget,
  type PlanChannel,
} from "@/lib/pricing-plan"

export type PlanSeason = { name: string; dates: string; plMin: number | null; minStay: string; rules: string }
export type PlanCompPoint = { source: string; nightly: string; origin: string; note: string }
export type PlanEvent = { name: string; dates: string; rule: string; status: "in_plan" | "watch" | "not_priced" | "open" }

export type PricingPlan = {
  id: string
  listing_id: string
  version: number
  status: "draft" | "approved"
  floor_payout: number | null
  base_price: number | null
  max_price: number | null
  booking_window: string | null
  channels: PlanChannel[]
  seasons: PlanSeason[]
  targets: MonthTarget[]
  anchors: { breakEvenMonthly?: number | null; ownerGoalAnnual?: number | null; marketNote?: string | null }
  comps: { rule?: string; points?: PlanCompPoint[] }
  events: PlanEvent[]
  rules: string[]
  approved_at: string | null
  updated_at: string
}

export type PlanQuestion = {
  id: string
  listing_id: string
  sort_order: number
  who: "owner" | "fede" | "ops"
  question: string
  why: string | null
  kind: "choice" | "number" | "text"
  options: string[]
  decisions: Record<string, string>
  feeds: string | null
  required_for_approval: boolean
  answer: string | null
  answered_at: string | null
}

export type LivePricing = { min: number | null; base: number | null; max: number | null }

export const WHO_LABEL: Record<PlanQuestion["who"], string> = { owner: "Ask the owner", fede: "Fede", ops: "Ops" }

export const PLAN_EVENT_STATUS: Record<PlanEvent["status"], string> = {
  in_plan: "In plan",
  watch: "Watch",
  not_priced: "Not priced",
  open: "Open question",
}

export const isAnswered = (q: PlanQuestion) => q.answer != null && q.answer.trim() !== ""

/** Decisions recorded by answers (only choice answers that map to a decision line). */
export const answeredDecisions = (qs: PlanQuestion[]) =>
  qs.filter((q) => isAnswered(q) && q.decisions[q.answer as string]).map((q) => ({ question: q.question, decision: q.decisions[q.answer as string] }))

export const missingForApproval = (qs: PlanQuestion[]) => qs.filter((q) => q.required_for_approval && !isAnswered(q))

export const planChannels = (plan: Pick<PricingPlan, "channels"> | null): PlanChannel[] =>
  plan && plan.channels.length ? plan.channels : structuredClone(DEFAULT_PLAN_CHANNELS)

/** PriceLabs minimum that protects the payout floor on every channel (null without a floor). */
export function planMinimum(plan: Pick<PricingPlan, "channels" | "floor_payout"> | null) {
  const floor = Number(plan?.floor_payout ?? 0)
  if (!floor) return null
  return tightestChannel(planChannels(plan as PricingPlan), floor)
}

const usd = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"))

/** Plan vs what is live in PriceLabs today; each changed row becomes setup work on approval. */
export function planVsLive(plan: PricingPlan | null, live: LivePricing) {
  if (!plan) return []
  const min = planMinimum(plan)
  const rows: { setting: string; live: string; plan: string; why: string; changed: boolean }[] = [
    {
      setting: "PriceLabs minimum",
      live: usd(live.min),
      plan: usd(min?.min ?? null),
      why: min ? `Protects a ${usd(plan.floor_payout)} payout on ${min.ch.label}` : "Needs the owner's payout floor",
      changed: min != null && min.min !== live.min,
    },
    { setting: "Base price", live: usd(live.base), plan: usd(plan.base_price), why: "", changed: plan.base_price != null && plan.base_price !== live.base },
    { setting: "Max price", live: usd(live.max), plan: usd(plan.max_price), why: "", changed: plan.max_price != null && plan.max_price !== live.max },
  ]
  if (plan.booking_window) rows.push({ setting: "Booking window", live: "Check in PriceLabs", plan: plan.booking_window, why: "", changed: true })
  rows.push({
    setting: "Channel markups",
    live: "Check in the PMS",
    plan: planChannels(plan).map((c) => `${c.label} ${Math.round(c.markup * 100)}%`).join(" · "),
    why: "Owner payout share per channel",
    changed: true,
  })
  for (const s of plan.seasons) {
    rows.push({ setting: `Season: ${s.name} (${s.dates})`, live: "—", plan: [s.plMin != null ? `min ${usd(s.plMin)}` : null, s.minStay ? `${s.minStay} nights` : null].filter(Boolean).join(" · "), why: s.rules, changed: true })
  }
  return rows
}

/** Plain-text summary used for the setup adjustment created on approval. */
export function approvalSummary(plan: PricingPlan, live: LivePricing, questions: PlanQuestion[]) {
  const lines = [`Pricing plan v${plan.version} approved. Apply in PriceLabs and the channel manager:`]
  for (const r of planVsLive(plan, live).filter((r) => r.changed)) lines.push(`- ${r.setting}: ${r.live} → ${r.plan}${r.why ? ` (${r.why})` : ""}`)
  const decided = answeredDecisions(questions)
  if (decided.length) {
    lines.push("", "Decisions:")
    for (const d of decided) lines.push(`- ${d.decision}`)
  }
  return lines.join("\n")
}

/** A fresh draft plan for a listing with no plan yet: current PriceLabs values and policy channels. */
export function emptyPlanInput(live: LivePricing) {
  return {
    status: "draft" as const,
    floor_payout: null,
    base_price: live.base,
    max_price: live.max,
    booking_window: null,
    channels: structuredClone(DEFAULT_PLAN_CHANNELS),
    seasons: [] as PlanSeason[],
    targets: [] as MonthTarget[],
    anchors: {},
    comps: { rule: "", points: [] },
    events: [] as PlanEvent[],
    rules: [] as string[],
  }
}
