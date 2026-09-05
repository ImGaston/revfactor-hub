import { NextResponse } from "next/server"
import { GranolaApiClient } from "@/lib/granola/client.server"
import { parseGranolaSources } from "@/lib/granola/config.server"
import { runGranolaImport } from "@/lib/granola/importer"
import { createGranolaPersistence } from "@/lib/granola/store.server"

export const runtime = "nodejs"
export const maxDuration = 300

const NOTES_PER_SOURCE = 10

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (process.env.GRANOLA_IMPORT_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, status: "disabled" })
  }

  let sources
  try {
    sources = parseGranolaSources(process.env.GRANOLA_IMPORT_SOURCES_JSON)
  } catch {
    return NextResponse.json(
      { error: "Granola import configuration is invalid" },
      { status: 500 }
    )
  }

  const persistence = createGranolaPersistence()
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const result = await runGranolaImport({
          sourceId: source.id,
          initialUpdatedAfter: source.initialUpdatedAfter,
          api: new GranolaApiClient({
            token: source.token,
            timeoutMs: 10_000,
          }),
          store: persistence,
          sink: persistence,
          pageSize: NOTES_PER_SOURCE,
          maxPages: 1,
          maxNotes: NOTES_PER_SOURCE,
        })
        return {
          sourceId: source.id,
          scope: source.scope,
          status: result.status,
          fetched: result.fetched,
          imported: result.imported,
          deduplicated: result.deduplicated,
          unmatched: result.unmatched,
          missingSummary: result.missingSummary,
          failures: result.failures,
        }
      } catch {
        return {
          sourceId: source.id,
          scope: source.scope,
          status: "failed" as const,
          fetched: 0,
          imported: 0,
          deduplicated: 0,
          unmatched: 0,
          missingSummary: 0,
          failures: 1,
        }
      }
    })
  )

  const failed = results.some((result) => result.status === "failed")
  return NextResponse.json(
    { enabled: true, sources: results },
    { status: failed ? 500 : 200 }
  )
}
