// Draft listing optimization report payload (from the audit skill / agents).
// Shared by the v1 API route and internal tooling. Creating a report always
// produces a draft; publishing is a separate, human action in the Hub.

import { z } from "zod"

import { CHECK_STATUSES, getCheck } from "@/lib/listing-optimization-checks"

import {
  AIRBNB_HOST_PROFILE_EDIT_URL,
  OPTIMIZATION_SECTIONS,
  type OptimizationSection,
} from "@/lib/listing-optimization"

const sectionKeys = OPTIMIZATION_SECTIONS.map((s) => s.key) as [
  OptimizationSection,
  ...OptimizationSection[],
]
const score = z.number().int().min(0).max(100)
const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))
const url = z
  .string()
  .trim()
  .url()
  .refine((v) => v.startsWith("https://"), "Must be an https URL")
  .nullish()
  .transform((v) => v ?? null)

export const draftReportSchema = z.object({
  client_id: z.string().uuid(),
  listing_id: z.string().uuid().nullish().transform((v) => v ?? null),
  report: z.object({
    listing_title: text(300),
    listing_url: url,
    airbnb_room_id: z
      .string()
      .regex(/^\d{3,25}$/)
      .nullish()
      .transform((v) => v ?? null),
    cover_photo_url: url,
    overall_score: score.nullish().transform((v) => v ?? null),
    score_breakdown: z
      .object({
        completion: score.optional(),
        structure: score.optional(),
        ota_style: score.optional(),
        seo: score.optional(),
      })
      .default({}),
    section_grades: z
      .record(z.string(), z.string().trim().max(3))
      .default({})
      .transform((grades) =>
        Object.fromEntries(Object.entries(grades).filter(([k]) => (sectionKeys as string[]).includes(k)))
      ),
    // PMS that syncs content to Airbnb (e.g. "Guesty"); null = edited in Airbnb.
    channel_manager: optionalText(80),
    owner_line: optionalText(500),
    summary: optionalText(1500),
    audited_at: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null),
  }),
  // One result per standard check (lib/listing-optimization-checks.ts). Score,
  // grades and coverage are computed from these; any submitted score is ignored.
  checks: z
    .array(
      z.object({
        id: z.string().refine((id) => Boolean(getCheck(id)), "Unknown check id"),
        status: z.enum(CHECK_STATUSES as [string, ...string[]]).transform(
          (v) => v as (typeof CHECK_STATUSES)[number]
        ),
        note: optionalText(500),
      })
    )
    .max(200)
    .default([])
    .refine((list) => new Set(list.map((c) => c.id)).size === list.length, "Duplicate check id"),
  // Listing optimization is content only; pricing findings from the audit are
  // dropped here rather than shown to owners.
  items: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter(
            (item) => !(item && typeof item === "object" && (item as { section?: unknown }).section === "pricing")
          )
        : value,
    z
    .array(
      z.object({
        section: z.enum(sectionKeys),
        kind: z.enum(["change", "owner_choice", "owner_task", "info"]).default("change"),
        priority: z.enum(["high", "medium", "low"]).default("medium"),
        sort_order: z.number().int().min(0).max(10_000).default(0),
        headline: text(300),
        rationale: optionalText(2000),
        current_value: optionalText(10_000),
        proposed_value: optionalText(10_000),
        options: z.array(text(2000)).max(6).default([]),
        photo_url: url,
        check_id: z
          .string()
          .refine((id) => Boolean(getCheck(id)), "Unknown check id")
          .nullish()
          .transform((v) => v ?? null),
        // Owner-task links must point at Airbnb.
        action_url: url.refine(
          (v) => v === null || /^https:\/\/([a-z0-9-]+\.)*airbnb\.com\//.test(v),
          "action_url must be an airbnb.com link"
        ),
      })
      .transform((item) =>
        item.kind === "owner_task" && !item.action_url && item.section === "host_profile"
          ? { ...item, action_url: AIRBNB_HOST_PROFILE_EDIT_URL }
          : item
      )
    )
    .min(1)
    .max(120)
  ),
  source: z.enum(["agent", "grok", "claude", "manual"]).default("agent"),
})

export type DraftReportInput = z.infer<typeof draftReportSchema>
