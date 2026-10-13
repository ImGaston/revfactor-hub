import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { draftReportSchema } from "@/lib/listing-optimization-input"
import { createDraftReport } from "@/lib/listing-optimization.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * Agents (audit skill, Grok bot) submit a listing optimization report as a
 * DRAFT. Owners never see it until someone with listings:edit publishes it in
 * the Hub (/listing-optimization).
 */
export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "listing-optimization:write")
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400, headers: NO_STORE })
  }

  const parsed = draftReportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report", issues: parsed.error.issues.slice(0, 20) },
      { status: 422, headers: NO_STORE }
    )
  }

  const result = await createDraftReport(parsed.data)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE })
  }
  return NextResponse.json(
    { report_id: result.reportId, status: "draft" },
    { status: 201, headers: NO_STORE }
  )
}
