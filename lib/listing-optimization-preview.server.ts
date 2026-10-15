import "server-only"

import { readFile } from "node:fs/promises"

import { draftReportSchema } from "@/lib/listing-optimization-input"
import type { OptimizationReport } from "@/lib/listing-optimization"
import { PREVIEW_REPORTS } from "@/lib/listing-optimization-fixture"
import { gradeSections, scoreChecks } from "@/lib/listing-optimization-checks"

/**
 * Local preview data for /portal/optimization?preview=1. Outside production,
 * PORTAL_PREVIEW_JSON may point to a draft report JSON file (the audit skill's
 * output) so a real review can be checked before it is imported. Client data
 * stays in that local file; it is never committed or written to the database.
 */
export async function loadPreviewReports(multi = false): Promise<OptimizationReport[]> {
  const path = process.env.PORTAL_PREVIEW_JSON
  if (process.env.NODE_ENV === "production" || !path) return PREVIEW_REPORTS

  try {
    const raw = JSON.parse(await readFile(path, "utf8"))
    const parsed = draftReportSchema.safeParse({
      client_id: "00000000-0000-4000-8000-000000000000",
      ...raw,
    })
    if (!parsed.success) {
      console.warn("portal preview: invalid PORTAL_PREVIEW_JSON", parsed.error.issues.slice(0, 5))
      return PREVIEW_REPORTS
    }
    const { report, items, checks } = parsed.data
    const extra = multi ? PREVIEW_REPORTS : []
    const scored = checks.length > 0 ? scoreChecks(checks) : null
    return [
      ...extra,
      {
        id: "preview-file",
        listing_title: report.listing_title,
        listing_url: report.listing_url,
        cover_photo_url: report.cover_photo_url,
        overall_score: scored ? scored.overall : report.overall_score,
        score_breakdown: scored ? scored.breakdown : report.score_breakdown,
        section_grades: scored ? gradeSections(checks) : report.section_grades,
        owner_line: report.owner_line,
        summary: report.summary,
        published_at: new Date().toISOString(),
        checks,
        items: items.map((item, index) => ({
          ...item,
          id: `preview-${index}`,
          client_status: "pending",
          client_choice: null,
          client_note: null,
          decided_at: null,
          apply_status: "not_started",
        })),
      },
    ]
  } catch (error) {
    console.warn("portal preview: could not read PORTAL_PREVIEW_JSON", error)
    return PREVIEW_REPORTS
  }
}
