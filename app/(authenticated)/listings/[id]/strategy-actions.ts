"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  approvalSummary,
  emptyPlanInput,
  missingForApproval,
  type LivePricing,
  type PlanQuestion,
  type PricingPlan,
} from "@/lib/listing-strategy"

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }

const PLAN_FIELDS =
  "id, listing_id, version, status, floor_payout, base_price, max_price, booking_window, channels, seasons, targets, anchors, comps, events, rules, approved_at, updated_at"
const QUESTION_FIELDS =
  "id, listing_id, sort_order, who, question, why, kind, options, decisions, feeds, required_for_approval, answer, answered_at"

const num = (v: unknown) => (v == null || v === "" ? null : Number(v))

function normalizePlan(p: Record<string, unknown>): PricingPlan {
  return {
    ...(p as unknown as PricingPlan),
    floor_payout: num(p.floor_payout),
    base_price: num(p.base_price),
    max_price: num(p.max_price),
  }
}

async function actor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

async function logEvent(listingId: string, planId: string | null, action: string, actorId: string | null, details: Record<string, unknown> = {}) {
  const { supabase } = await actor()
  const { error } = await supabase.from("listing_plan_events").insert({ listing_id: listingId, plan_id: planId, action, actor_id: actorId, details })
  if (error) console.error("listing strategy: event insert failed", error)
}

/** Plan, questions and live PriceLabs values for the strategy tabs (loaded when a tab opens). */
export async function getStrategyDataAction(
  listingId: string
): Promise<Ok<{ plan: PricingPlan | null; questions: PlanQuestion[]; live: LivePricing; clientId: string | null }> | Err> {
  if (!(await hasPermission("listings", "view"))) return { ok: false, error: "You don't have permission to view listings." }
  const { supabase } = await actor()
  const [planRes, qRes, listingRes] = await Promise.all([
    supabase.from("listing_pricing_plans").select(PLAN_FIELDS).eq("listing_id", listingId).maybeSingle(),
    supabase.from("listing_plan_questions").select(QUESTION_FIELDS).eq("listing_id", listingId).order("sort_order"),
    supabase.from("listings").select("client_id, pl_min_price, pl_base_price, pl_max_price").eq("id", listingId).maybeSingle(),
  ])
  if (planRes.error) return { ok: false, error: planRes.error.message }
  if (qRes.error) return { ok: false, error: qRes.error.message }
  const l = listingRes.data
  return {
    ok: true,
    plan: planRes.data ? normalizePlan(planRes.data as Record<string, unknown>) : null,
    questions: (qRes.data ?? []) as PlanQuestion[],
    live: { min: num(l?.pl_min_price), base: num(l?.pl_base_price), max: num(l?.pl_max_price) },
    clientId: (l?.client_id as string | null) ?? null,
  }
}

type PlanPatch = Partial<Pick<PricingPlan, "floor_payout" | "base_price" | "max_price" | "booking_window" | "channels" | "seasons" | "targets" | "anchors" | "comps" | "events" | "rules">>

/**
 * Save part of the plan. Creates a draft on first save. Editing an approved
 * plan reopens it as a new draft version, so approval always matches the
 * numbers that were approved.
 */
export async function savePlanAction(listingId: string, patch: PlanPatch): Promise<Ok<{ plan: PricingPlan }> | Err> {
  if (!(await hasPermission("listings", "edit"))) return { ok: false, error: "You don't have permission to edit listings." }
  const { supabase, userId } = await actor()
  const { data: existing } = await supabase.from("listing_pricing_plans").select(PLAN_FIELDS).eq("listing_id", listingId).maybeSingle()
  const now = new Date().toISOString()
  if (!existing) {
    const { data: l } = await supabase.from("listings").select("pl_min_price, pl_base_price, pl_max_price").eq("id", listingId).maybeSingle()
    const base = emptyPlanInput({ min: num(l?.pl_min_price), base: num(l?.pl_base_price), max: num(l?.pl_max_price) })
    const { data, error } = await supabase
      .from("listing_pricing_plans")
      .insert({ listing_id: listingId, ...base, ...patch, created_by: userId, updated_by: userId })
      .select(PLAN_FIELDS)
      .single()
    if (error || !data) return { ok: false, error: error?.message ?? "Couldn't create the plan." }
    await logEvent(listingId, data.id as string, "ProposePricingPlan", userId, { fields: Object.keys(patch) })
    revalidatePath(`/listings/${listingId}`)
    return { ok: true, plan: normalizePlan(data as Record<string, unknown>) }
  }
  const reopen = existing.status === "approved"
  const { data, error } = await supabase
    .from("listing_pricing_plans")
    .update({
      ...patch,
      ...(reopen ? { status: "draft", version: (existing.version as number) + 1, approved_at: null, approved_by: null } : {}),
      updated_by: userId,
      updated_at: now,
    })
    .eq("id", existing.id)
    .select(PLAN_FIELDS)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the plan." }
  await logEvent(listingId, data.id as string, reopen ? "ReopenPricingPlan" : "UpdatePricingPlan", userId, { fields: Object.keys(patch) })
  revalidatePath(`/listings/${listingId}`)
  return { ok: true, plan: normalizePlan(data as Record<string, unknown>) }
}

/** Answer (or clear) an open question. A question that feeds the payout floor also updates the plan. */
export async function answerQuestionAction(questionId: string, answer: string): Promise<Ok<{ question: PlanQuestion }> | Err> {
  if (!(await hasPermission("listings", "edit"))) return { ok: false, error: "You don't have permission to edit listings." }
  const { supabase, userId } = await actor()
  const value = answer.trim()
  const { data, error } = await supabase
    .from("listing_plan_questions")
    .update({ answer: value || null, answered_by: value ? userId : null, answered_at: value ? new Date().toISOString() : null })
    .eq("id", questionId)
    .select(QUESTION_FIELDS)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the answer." }
  const q = data as PlanQuestion
  if (q.feeds === "floor_payout" && value && Number.isFinite(Number(value))) {
    const saved = await savePlanAction(q.listing_id, { floor_payout: Number(value) })
    if (!saved.ok) return saved
  }
  await logEvent(q.listing_id, null, "AnswerPlanQuestion", userId, { question_id: q.id, answer: value })
  return { ok: true, question: q }
}

export async function addQuestionAction(
  listingId: string,
  input: { question: string; why?: string; who: PlanQuestion["who"]; kind: PlanQuestion["kind"]; options?: string[] }
): Promise<Ok<{ question: PlanQuestion }> | Err> {
  if (!(await hasPermission("listings", "edit"))) return { ok: false, error: "You don't have permission to edit listings." }
  const text = input.question.trim()
  if (!text) return { ok: false, error: "Write the question first." }
  const { supabase, userId } = await actor()
  const { data: last } = await supabase.from("listing_plan_questions").select("sort_order").eq("listing_id", listingId).order("sort_order", { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await supabase
    .from("listing_plan_questions")
    .insert({
      listing_id: listingId,
      sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10,
      who: input.who,
      question: text,
      why: input.why?.trim() || null,
      kind: input.kind,
      options: (input.options ?? []).map((o) => o.trim()).filter(Boolean),
    })
    .select(QUESTION_FIELDS)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't add the question." }
  await logEvent(listingId, null, "AddPlanQuestion", userId, { question_id: data.id })
  return { ok: true, question: data as PlanQuestion }
}

/** Approve the plan: requires the blocking questions answered; creates a setup adjustment for the team. */
export async function approvePlanAction(listingId: string): Promise<Ok<{ plan: PricingPlan; adjustmentId: string | null }> | Err> {
  if (!(await hasPermission("listings", "edit"))) return { ok: false, error: "You don't have permission to approve plans." }
  const data = await getStrategyDataAction(listingId)
  if (!data.ok) return data
  if (!data.plan) return { ok: false, error: "There's no plan to approve yet." }
  const missing = missingForApproval(data.questions)
  if (missing.length) return { ok: false, error: `Answer first: ${missing.map((q) => q.question).join(" · ")}` }
  const { supabase, userId } = await actor()
  const now = new Date().toISOString()
  const { data: approved, error } = await supabase
    .from("listing_pricing_plans")
    .update({ status: "approved", approved_by: userId, approved_at: now, updated_by: userId, updated_at: now })
    .eq("id", data.plan.id)
    .select(PLAN_FIELDS)
    .single()
  if (error || !approved) return { ok: false, error: error?.message ?? "Couldn't approve the plan." }
  const plan = normalizePlan(approved as Record<string, unknown>)

  let adjustmentId: string | null = null
  if (data.clientId) {
    const { data: profile } = userId ? await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle() : { data: null }
    const { data: adj, error: adjError } = await supabase
      .from("adjustments")
      .insert({
        scope: "single_listing",
        client_id: data.clientId,
        listing_id: listingId,
        type: "setup",
        target_value: `Pricing plan v${plan.version}`,
        origin: "internal",
        urgency: "high",
        status: "open",
        requested_by: (profile?.full_name as string | undefined) ?? "RevFactor",
        origin_message: approvalSummary(plan, data.live, data.questions),
      })
      .select("id")
      .single()
    if (adjError) console.error("listing strategy: setup adjustment insert failed", adjError)
    adjustmentId = (adj?.id as string | undefined) ?? null
  }
  await logEvent(listingId, plan.id, "ApprovePricingPlan", userId, { version: plan.version, adjustment_id: adjustmentId })
  revalidatePath(`/listings/${listingId}`)
  return { ok: true, plan, adjustmentId }
}

/** Latest listing review for the Listing Audit tab. */
export async function getListingAuditAction(listingId: string): Promise<
  | Ok<{
      report: {
        id: string
        status: string
        overall_score: number | null
        section_grades: Record<string, string> | null
        score_breakdown: Record<string, number> | null
        published_at: string | null
        owner_message_sent_at: string | null
        channel_manager: string | null
        listing_title: string | null
      } | null
      items: { section: string; kind: string; priority: string; headline: string; client_status: string; apply_status: string }[]
    }>
  | Err
> {
  if (!(await hasPermission("listings", "view"))) return { ok: false, error: "You don't have permission to view listings." }
  const { supabase } = await actor()
  const { data: report, error } = await supabase
    .from("listing_optimization_reports")
    .select("id, status, overall_score, section_grades, score_breakdown, published_at, owner_message_sent_at, channel_manager, listing_title")
    .eq("listing_id", listingId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!report) return { ok: true, report: null, items: [] }
  const { data: items } = await supabase
    .from("listing_optimization_items")
    .select("section, kind, priority, headline, client_status, apply_status, sort_order")
    .eq("report_id", report.id)
    .order("sort_order")
  return {
    ok: true,
    report: report as never,
    items: (items ?? []).map((i) => ({
      section: i.section as string,
      kind: i.kind as string,
      priority: i.priority as string,
      headline: i.headline as string,
      client_status: i.client_status as string,
      apply_status: i.apply_status as string,
    })),
  }
}
