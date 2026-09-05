import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import { readDocument } from "@/lib/ghl-onboarding-v1/providers.server"

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("HIGHLEVEL_API_KEY", "test-key")
  vi.stubEnv("HIGHLEVEL_LOCATION_ID", "test-location")
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("authenticated GHL document lookup", () => {
  it("respects the live API's 21-record limit and locates the exact bound document on a later page", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input)
      const limit = Number(url.searchParams.get("limit"))
      if (limit > 21)
        return new Response("limit must not be greater than 21", {
          status: 422,
        })
      const skip = Number(url.searchParams.get("skip"))
      return Response.json({
        documents:
          skip === 0
            ? Array.from({ length: 21 }, (_, index) => ({
                documentId: `unrelated-${index}`,
              }))
            : [{ documentId: "bound-document", locationId: "test-location" }],
        total: 22,
      })
    })
    expect(await readDocument("bound-document")).toEqual({
      documentId: "bound-document",
      locationId: "test-location",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("skip")).toBe(
      "21"
    )
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-key"
    )
  })

  it("does not substitute another agreement when the bound document is absent", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ documents: [{ documentId: "other" }], total: 1 })
    )
    await expect(readDocument("bound-document")).rejects.toThrow(
      "bound_document_not_found"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("bounds the total scan time even when every page is full", async () => {
    let time = 1000
    vi.spyOn(Date, "now").mockImplementation(() => time)
    fetchMock.mockImplementation(async () => {
      time += 26000
      return Response.json({
        documents: Array.from({ length: 21 }, (_, i) => ({
          documentId: `other-${i}`,
        })),
      })
    })
    await expect(readDocument("bound-document")).rejects.toThrow(
      "document_lookup_deadline"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed provider results", async () => {
    fetchMock.mockResolvedValue(Response.json({ documents: null }))
    await expect(readDocument("bound-document")).rejects.toThrow(
      "invalid_document_list"
    )
  })
})
