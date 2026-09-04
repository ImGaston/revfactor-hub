import { describe, expect, it, vi } from "vitest"
import { runGranolaImport } from "@/lib/granola/importer"
import type {
  GranolaApi,
  GranolaImportCheckpoint,
  GranolaImportStore,
  GranolaInternalSummary,
  GranolaNote,
  GranolaNoteListItem,
  GranolaNotesPage,
  GranolaProcessedNote,
  GranolaSalesAppointment,
  GranolaSummarySink,
} from "@/lib/granola/types"

function note(
  id: string,
  updatedAt: string,
  overrides: Partial<GranolaNote> = {}
): GranolaNote {
  return {
    id,
    title: "RevFactor sales call",
    owner: { name: "Rep", email: "rep@example.com" },
    createdAt: "2026-09-01T14:00:00Z",
    updatedAt,
    webUrl: `https://notes.granola.ai/d/${id}`,
    calendarEvent: {
      title: "RevFactor sales call",
      inviteeEmails: ["lead@example.com"],
      organiserEmail: "rep@example.com",
      calendarEventId: `event-${id}`,
      scheduledStartAt: "2026-09-01T14:00:00Z",
      scheduledEndAt: "2026-09-01T14:30:00Z",
    },
    attendees: [{ name: "Lead", email: "lead@example.com" }],
    summaryText: `Summary for ${id}`,
    summaryMarkdown: null,
    ...overrides,
  }
}

function listed(value: GranolaNote): GranolaNoteListItem {
  const { id, title, owner, createdAt, updatedAt } = value
  return { id, title, owner, createdAt, updatedAt }
}

const salesAppointment: GranolaSalesAppointment = {
  id: "appointment-1",
  kind: "revfactor_sales",
  calendarEventId: "event-note-1",
  repEmail: "rep@example.com",
  scheduledStartAt: "2026-09-01T14:00:00Z",
  attendeeEmails: ["lead@example.com"],
}

class MemoryStore implements GranolaImportStore {
  checkpoint: GranolaImportCheckpoint | null = null
  processed = new Map<string, GranolaProcessedNote>()
  checkpointWrites: GranolaImportCheckpoint[] = []
  candidates: GranolaSalesAppointment[] = [salesAppointment]

  async getCheckpoint() {
    return this.checkpoint
  }

  async saveCheckpoint(_sourceId: string, checkpoint: GranolaImportCheckpoint) {
    this.checkpoint = checkpoint
    this.checkpointWrites.push(checkpoint)
  }

  async hasProcessedNote(input: { noteId: string; updatedAt: string }) {
    return this.processed.has(`${input.noteId}:${input.updatedAt}`)
  }

  async findEligibleSalesAppointments() {
    return this.candidates
  }

  async recordProcessedNote(input: GranolaProcessedNote) {
    this.processed.set(`${input.noteId}:${input.updatedAt}`, input)
  }
}

class MemorySink implements GranolaSummarySink {
  summaries: GranolaInternalSummary[] = []

  async upsertInternalSummary(summary: GranolaInternalSummary) {
    const index = this.summaries.findIndex(
      (existing) =>
        existing.sourceId === summary.sourceId &&
        existing.noteId === summary.noteId &&
        existing.noteUpdatedAt === summary.noteUpdatedAt
    )
    if (index >= 0) this.summaries[index] = summary
    else this.summaries.push(summary)
  }
}

function fakeApi(input: {
  pages: Record<string, GranolaNotesPage>
  notes: Record<string, GranolaNote>
}): GranolaApi & {
  listNotes: ReturnType<typeof vi.fn<GranolaApi["listNotes"]>>
  getNote: ReturnType<typeof vi.fn<GranolaApi["getNote"]>>
} {
  return {
    listNotes: vi.fn(async ({ cursor }) => input.pages[cursor ?? "first"]),
    getNote: vi.fn(async (noteId) => input.notes[noteId]),
  }
}

describe("runGranolaImport", () => {
  it("persists a continuation cursor at the bound and completes it next run", async () => {
    const first = note("note-1", "2026-09-01T15:00:00Z")
    const second = note("note-2", "2026-09-01T16:00:00Z", {
      calendarEvent: {
        ...first.calendarEvent!,
        calendarEventId: "event-note-2",
      },
    })
    const api = fakeApi({
      pages: {
        first: { notes: [listed(first)], hasMore: true, cursor: "page-2" },
        "page-2": { notes: [listed(second)], hasMore: false, cursor: null },
      },
      notes: { "note-1": first, "note-2": second },
    })
    const store = new MemoryStore()
    store.candidates = [
      salesAppointment,
      {
        ...salesAppointment,
        id: "appointment-2",
        calendarEventId: "event-note-2",
      },
    ]
    const sink = new MemorySink()

    const firstRun = await runGranolaImport({
      sourceId: "rep-one",
      initialUpdatedAfter: "2026-09-01T00:00:00Z",
      api,
      store,
      sink,
      maxPages: 1,
      now: () => new Date("2026-09-02T00:00:00Z"),
    })
    expect(firstRun.status).toBe("deferred")
    expect(firstRun.checkpoint).toMatchObject({ cursor: "page-2" })

    const secondRun = await runGranolaImport({
      sourceId: "rep-one",
      initialUpdatedAfter: "2026-09-01T00:00:00Z",
      api,
      store,
      sink,
      maxPages: 1,
      now: () => new Date("2026-09-03T00:00:00Z"),
    })
    expect(secondRun.status).toBe("completed")
    expect(secondRun.checkpoint).toEqual({
      updatedAfter: "2026-09-02T00:00:00.000Z",
      cursor: null,
      pendingHighWatermark: null,
    })
    expect(sink.summaries.map((summary) => summary.noteId)).toEqual([
      "note-1",
      "note-2",
    ])
    expect(api.listNotes.mock.calls[1][0].cursor).toBe("page-2")
  })

  it("uses overlap to recover a late note and deduplicates a replayed version", async () => {
    const replay = note("note-1", "2026-09-01T11:59:00Z")
    const late = note("note-late", "2026-09-01T11:58:00Z", {
      calendarEvent: {
        ...replay.calendarEvent!,
        calendarEventId: "event-late",
      },
    })
    const api = fakeApi({
      pages: {
        first: {
          notes: [listed(replay), listed(late)],
          hasMore: false,
          cursor: null,
        },
      },
      notes: { "note-1": replay, "note-late": late },
    })
    const store = new MemoryStore()
    store.checkpoint = {
      updatedAfter: "2026-09-01T12:00:00Z",
      cursor: null,
      pendingHighWatermark: null,
    }
    await store.recordProcessedNote({
      sourceId: "workspace-shared",
      noteId: replay.id,
      updatedAt: replay.updatedAt,
      outcome: "imported",
    })
    store.candidates = [
      salesAppointment,
      {
        ...salesAppointment,
        id: "appointment-late",
        calendarEventId: "event-late",
      },
    ]
    const sink = new MemorySink()

    const result = await runGranolaImport({
      sourceId: "rep-one",
      initialUpdatedAfter: "2026-08-01T00:00:00Z",
      api,
      store,
      sink,
      overlapMs: 5 * 60_000,
      now: () => new Date("2026-09-01T12:05:00Z"),
    })

    expect(api.listNotes.mock.calls[0][0].updatedAfter).toBe(
      "2026-09-01T11:55:00.000Z"
    )
    expect(result).toMatchObject({
      status: "completed",
      deduplicated: 1,
      imported: 1,
    })
    expect(api.getNote).toHaveBeenCalledTimes(1)
    expect(sink.summaries[0]).toMatchObject({
      appointmentId: "appointment-late",
      noteId: "note-late",
    })
  })

  it("does not advance the checkpoint when a note fails", async () => {
    const current = note("note-1", "2026-09-01T15:00:00Z")
    const api = fakeApi({
      pages: {
        first: { notes: [listed(current)], hasMore: false, cursor: null },
      },
      notes: { "note-1": current },
    })
    api.getNote.mockRejectedValueOnce(
      new Error("payload details must stay private")
    )
    const store = new MemoryStore()
    store.checkpoint = {
      updatedAfter: "2026-09-01T12:00:00Z",
      cursor: null,
      pendingHighWatermark: null,
    }
    const logger = { info: vi.fn(), error: vi.fn() }

    const result = await runGranolaImport({
      sourceId: "rep-one",
      initialUpdatedAfter: "2026-08-01T00:00:00Z",
      api,
      store,
      sink: new MemorySink(),
      logger,
    })

    expect(result.status).toBe("failed")
    expect(store.checkpointWrites).toEqual([])
    expect(logger.error).toHaveBeenCalledWith({
      event: "note_failed",
      sourceId: "rep-one",
      noteId: "note-1",
      errorCode: "unexpected",
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "payload details"
    )
  })

  it("records mismatches without sending any summary", async () => {
    const current = note("note-1", "2026-09-01T15:00:00Z")
    const api = fakeApi({
      pages: {
        first: { notes: [listed(current)], hasMore: false, cursor: null },
      },
      notes: { "note-1": current },
    })
    const store = new MemoryStore()
    store.candidates = []
    const sink = new MemorySink()

    const result = await runGranolaImport({
      sourceId: "rep-one",
      initialUpdatedAfter: "2026-09-01T00:00:00Z",
      api,
      store,
      sink,
    })

    expect(result).toMatchObject({
      status: "completed",
      unmatched: 1,
      imported: 0,
    })
    expect(sink.summaries).toEqual([])
    expect([...store.processed.values()][0].outcome).toBe("unmatched")
  })
})
