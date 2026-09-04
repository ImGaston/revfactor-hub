import { matchGranolaNoteToAppointment } from "@/lib/granola/match"
import { buildAppointmentLookup } from "@/lib/granola/normalize"
import type {
  GranolaApi,
  GranolaImportCheckpoint,
  GranolaImportResult,
  GranolaImportStore,
  GranolaSafeLogger,
  GranolaSummarySink,
} from "@/lib/granola/types"

const noopLogger: GranolaSafeLogger = {
  info: () => undefined,
  error: () => undefined,
}

export async function runGranolaImport(input: {
  sourceId: string
  initialUpdatedAfter: string
  api: GranolaApi
  store: GranolaImportStore
  sink: GranolaSummarySink
  logger?: GranolaSafeLogger
  overlapMs?: number
  pageSize?: number
  maxPages?: number
  maxNotes?: number
  now?: () => Date
}): Promise<GranolaImportResult> {
  const logger = input.logger ?? noopLogger
  const pageSize = input.pageSize ?? 30
  const maxPages = input.maxPages ?? 10
  const maxNotes = input.maxNotes ?? 300
  const overlapMs = input.overlapMs ?? 5 * 60_000
  validateOptions({ pageSize, maxPages, maxNotes, overlapMs })

  const existing = await input.store.getCheckpoint(input.sourceId)
  const continuing = Boolean(existing?.cursor)
  const updatedAfter = continuing
    ? existing!.updatedAfter
    : subtractMilliseconds(
        existing?.updatedAfter ?? input.initialUpdatedAfter,
        overlapMs
      )
  let pendingHighWatermark = continuing
    ? (existing?.pendingHighWatermark ?? existing!.updatedAfter)
    : laterInstant(
        existing?.updatedAfter ?? input.initialUpdatedAfter,
        (input.now ?? (() => new Date()))().toISOString()
      )
  let cursor = existing?.cursor ?? null
  let pages = 0
  const result: GranolaImportResult = {
    status: "completed",
    fetched: 0,
    imported: 0,
    deduplicated: 0,
    unmatched: 0,
    missingSummary: 0,
    failures: 0,
    checkpoint: existing,
  }

  logger.info({
    event: continuing ? "scan_continuing" : "scan_started",
    sourceId: input.sourceId,
  })

  while (pages < maxPages && result.fetched < maxNotes) {
    const remaining = maxNotes - result.fetched
    const requestedPageSize = Math.min(pageSize, remaining)
    let page
    try {
      page = await input.api.listNotes({
        updatedAfter,
        cursor,
        pageSize: requestedPageSize,
      })
    } catch (error) {
      return failedResult(result, logger, input.sourceId, undefined, error)
    }

    if (
      page.notes.length > requestedPageSize ||
      (page.hasMore && (!page.cursor || page.cursor === cursor))
    ) {
      return failedResult(result, logger, input.sourceId, undefined, {
        code: "invalid_response",
      })
    }

    pages += 1
    result.fetched += page.notes.length
    for (const listedNote of page.notes) {
      pendingHighWatermark = laterInstant(
        pendingHighWatermark,
        listedNote.updatedAt
      )
      try {
        const alreadyProcessed = await input.store.hasProcessedNote({
          noteId: listedNote.id,
          updatedAt: listedNote.updatedAt,
        })
        if (alreadyProcessed) {
          result.deduplicated += 1
          continue
        }

        const note = await input.api.getNote(listedNote.id)
        pendingHighWatermark = laterInstant(
          pendingHighWatermark,
          note.updatedAt
        )
        if (note.updatedAt !== listedNote.updatedAt) {
          const detailAlreadyProcessed = await input.store.hasProcessedNote({
            noteId: note.id,
            updatedAt: note.updatedAt,
          })
          if (detailAlreadyProcessed) {
            result.deduplicated += 1
            continue
          }
        }

        if (!hasSummary(note.summaryText, note.summaryMarkdown)) {
          await input.store.recordProcessedNote({
            sourceId: input.sourceId,
            noteId: note.id,
            updatedAt: note.updatedAt,
            outcome: "missing_summary",
          })
          result.missingSummary += 1
          continue
        }

        const lookup = buildAppointmentLookup(input.sourceId, note)
        const candidates =
          await input.store.findEligibleSalesAppointments(lookup)
        const match = matchGranolaNoteToAppointment(lookup, candidates)
        if (match.status === "unmatched") {
          await input.store.recordProcessedNote({
            sourceId: input.sourceId,
            noteId: note.id,
            updatedAt: note.updatedAt,
            outcome: "unmatched",
          })
          result.unmatched += 1
          continue
        }

        await input.sink.upsertInternalSummary({
          sourceId: input.sourceId,
          appointmentId: match.appointment.id,
          noteId: note.id,
          noteUpdatedAt: note.updatedAt,
          sourceUrl: note.webUrl,
          summaryText: note.summaryText,
          summaryMarkdown: note.summaryMarkdown,
        })
        await input.store.recordProcessedNote({
          sourceId: input.sourceId,
          noteId: note.id,
          updatedAt: note.updatedAt,
          outcome: "imported",
        })
        result.imported += 1
      } catch (error) {
        return failedResult(
          result,
          logger,
          input.sourceId,
          listedNote.id,
          error
        )
      }
    }

    cursor = page.cursor
    if (!page.hasMore) {
      const completedCheckpoint: GranolaImportCheckpoint = {
        updatedAfter: pendingHighWatermark,
        cursor: null,
        pendingHighWatermark: null,
      }
      try {
        await input.store.saveCheckpoint(input.sourceId, completedCheckpoint)
      } catch (error) {
        return failedResult(result, logger, input.sourceId, undefined, error)
      }
      result.checkpoint = completedCheckpoint
      logger.info({ event: "scan_completed", sourceId: input.sourceId })
      return result
    }
  }

  const deferredCheckpoint: GranolaImportCheckpoint = {
    updatedAfter,
    cursor,
    pendingHighWatermark,
  }
  try {
    await input.store.saveCheckpoint(input.sourceId, deferredCheckpoint)
  } catch (error) {
    return failedResult(result, logger, input.sourceId, undefined, error)
  }
  result.status = "deferred"
  result.checkpoint = deferredCheckpoint
  logger.info({ event: "scan_deferred", sourceId: input.sourceId })
  return result
}

function validateOptions(input: {
  pageSize: number
  maxPages: number
  maxNotes: number
  overlapMs: number
}) {
  if (
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 30
  ) {
    throw new RangeError("pageSize must be an integer from 1 through 30")
  }
  if (!Number.isInteger(input.maxPages) || input.maxPages < 1) {
    throw new RangeError("maxPages must be a positive integer")
  }
  if (!Number.isInteger(input.maxNotes) || input.maxNotes < 1) {
    throw new RangeError("maxNotes must be a positive integer")
  }
  if (!Number.isFinite(input.overlapMs) || input.overlapMs < 0) {
    throw new RangeError("overlapMs must be a non-negative number")
  }
}

function subtractMilliseconds(iso: string, milliseconds: number): string {
  const value = Date.parse(iso)
  if (!Number.isFinite(value))
    throw new RangeError("Invalid import checkpoint date")
  return new Date(value - milliseconds).toISOString()
}

function laterInstant(left: string, right: string): string {
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    throw new RangeError("Invalid Granola timestamp")
  }
  return rightMs > leftMs
    ? new Date(rightMs).toISOString()
    : new Date(leftMs).toISOString()
}

function hasSummary(text: string | null, markdown: string | null): boolean {
  return Boolean(text?.trim() || markdown?.trim())
}

function failedResult(
  result: GranolaImportResult,
  logger: GranolaSafeLogger,
  sourceId: string,
  noteId: string | undefined,
  error: unknown
): GranolaImportResult {
  const errorCode = safeErrorCode(error)
  logger.error({ event: "note_failed", sourceId, noteId, errorCode })
  return { ...result, status: "failed", failures: result.failures + 1 }
}

function safeErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return "unexpected"
  }
  return error.code === "network_error" ||
    error.code === "http_error" ||
    error.code === "invalid_response"
    ? error.code
    : "unexpected"
}
