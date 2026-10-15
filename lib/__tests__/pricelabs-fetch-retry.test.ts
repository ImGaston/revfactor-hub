import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPriceLabsListings } from "@/lib/pricelabs"

const fetchMock = vi.fn()

const timeoutError = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError")
const ok = (listings: unknown[]) =>
  new Response(JSON.stringify({ listings }), { status: 200 })
const status = (code: number) =>
  new Response("upstream says no", { status: code })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("PRICELABS_API_KEY", "test-key")
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  fetchMock.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Runs the request while advancing fake timers through the retry delay.
async function run(promise: Promise<unknown>) {
  const settled = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )
  await vi.runAllTimersAsync()
  return settled
}

describe("fetchPriceLabsListings timeout and retry", () => {
  it("asks for every listing with a 20s per-attempt timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    fetchMock.mockResolvedValueOnce(ok([{ id: "a" }]))
    const result = await run(fetchPriceLabsListings(false))
    expect(result).toEqual({ value: [{ id: "a" }] })
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "only_syncing_listings=false"
    )
    expect(timeoutSpy).toHaveBeenCalledWith(20_000)
  })

  it("retries once after a timeout", async () => {
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(ok([{ id: "a" }]))
    const result = await run(fetchPriceLabsListings(false))
    expect(result).toEqual({ value: [{ id: "a" }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries once after a 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(ok([{ id: "a" }]))
    const result = await run(fetchPriceLabsListings(false))
    expect(result).toEqual({ value: [{ id: "a" }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry a 4xx", async () => {
    fetchMock.mockResolvedValueOnce(status(401))
    const result = await run(fetchPriceLabsListings(false))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((result as { error: Error }).error.message).toBe(
      "PriceLabs API error 401: upstream says no"
    )
  })

  it("gives up after two timeouts with a readable error", async () => {
    fetchMock
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
    const result = await run(fetchPriceLabsListings(false))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((result as { error: Error }).error.message).toBe(
      "PriceLabs /listings timed out (2 attempts: 20s, 20s)"
    )
  })

  it("fits attempts inside the deadline and skips a retry that would not fit", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    // 12s left: the first attempt is cut to 12s; afterwards no retry window.
    const deadline = Date.now() + 12_000
    fetchMock.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(12_000)
      throw timeoutError()
    })
    const result = await run(fetchPriceLabsListings(false, { deadline }))
    expect(timeoutSpy).toHaveBeenCalledWith(12_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((result as { error: Error }).error.message).toBe(
      "PriceLabs /listings timed out (1 attempt: 12s)"
    )
  })

  it("gives the retry only what is left of the deadline", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const deadline = Date.now() + 35_000
    fetchMock
      .mockImplementationOnce(async () => {
        vi.advanceTimersByTime(20_000)
        throw timeoutError()
      })
      .mockResolvedValueOnce(ok([]))
    const result = await run(fetchPriceLabsListings(false, { deadline }))
    expect(result).toEqual({ value: [] })
    // 35s - 20s first attempt - 1s retry delay = 14s for the retry.
    expect(timeoutSpy.mock.calls.map(([ms]) => ms)).toEqual([20_000, 14_000])
  })
})
