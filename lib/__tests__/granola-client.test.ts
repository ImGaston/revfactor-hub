import { describe, expect, it, vi } from "vitest"
import { GranolaApiClient, GranolaApiError } from "@/lib/granola/client.server"

describe("GranolaApiClient", () => {
  it("uses bounded cursor pagination and bearer authentication", async () => {
    const fetcher = vi.fn<typeof fetch>()
    fetcher.mockResolvedValue(
      Response.json({
        notes: [
          {
            id: "not_1d3tmYTlCICgjy",
            object: "note",
            title: "Sales call",
            owner: { name: "Rep", email: "rep@example.com" },
            created_at: "2026-09-01T14:00:00Z",
            updated_at: "2026-09-01T15:00:00Z",
          },
        ],
        hasMore: true,
        cursor: "next-page",
      })
    )
    const client = new GranolaApiClient({ token: "secret-token", fetcher })

    const page = await client.listNotes({
      updatedAfter: "2026-09-01T00:00:00Z",
      cursor: "current-page",
      pageSize: 30,
    })

    expect(page.cursor).toBe("next-page")
    const [url, init] = fetcher.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe("/v1/notes")
    expect(parsed.searchParams.get("updated_after")).toBe(
      "2026-09-01T00:00:00Z"
    )
    expect(parsed.searchParams.get("cursor")).toBe("current-page")
    expect(parsed.searchParams.get("page_size")).toBe("30")
    expect(init?.headers).toEqual({ Authorization: "Bearer secret-token" })
  })

  it("keeps transcripts and private notes out of the returned note", async () => {
    const fetcher = vi.fn<typeof fetch>()
    fetcher.mockResolvedValue(
      Response.json({
        id: "not_1d3tmYTlCICgjy",
        object: "note",
        title: "Sales call",
        owner: { name: "Rep", email: "rep@example.com" },
        created_at: "2026-09-01T14:00:00Z",
        updated_at: "2026-09-01T15:00:00Z",
        web_url: "https://notes.granola.ai/d/example",
        calendar_event: null,
        attendees: [],
        summary_text: "Safe summary",
        summary_markdown: "**Safe summary**",
        private_notes_text: "Do not retain",
        private_notes_markdown: "Do not retain",
        transcript: [{ text: "Do not retain" }],
      })
    )
    const client = new GranolaApiClient({ token: "secret-token", fetcher })

    const note = await client.getNote("not_1d3tmYTlCICgjy")

    expect(note.summaryText).toBe("Safe summary")
    expect(note).not.toHaveProperty("transcript")
    expect(note).not.toHaveProperty("privateNotesText")
    expect(note).not.toHaveProperty("private_notes_text")
    expect(
      new URL(String(fetcher.mock.calls[0][0])).searchParams.has("include")
    ).toBe(false)
  })

  it("rejects an out-of-range page without making a request", async () => {
    const fetcher = vi.fn()
    const client = new GranolaApiClient({ token: "secret-token", fetcher })

    await expect(
      client.listNotes({ updatedAfter: "2026-09-01", pageSize: 31 })
    ).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("returns a safe status-only error without reading the response payload", async () => {
    const text = vi.fn(async () => "payload containing secret-token")
    const fetcher = vi.fn(
      async () => ({ ok: false, status: 429, text }) as unknown as Response
    )
    const client = new GranolaApiClient({ token: "secret-token", fetcher })

    const error = await client
      .listNotes({ updatedAfter: "2026-09-01", pageSize: 10 })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GranolaApiError)
    expect(error).toMatchObject({ code: "http_error", status: 429 })
    expect(String(error)).not.toContain("secret-token")
    expect(text).not.toHaveBeenCalled()
  })
})
