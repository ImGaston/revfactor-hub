import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { JEV_CONFIDENCE_GATES, JEV_ENDPOINT, JEV_MODEL, gateChoice, gateNoul, noulCertainty } from "@/lib/jev"
import { isJevConfigured, jevDecide, scrubSecrets } from "@/lib/jev.server"

const KEY = "ts_test_key_0123456789abcdef"
const original = process.env.TYPESAFE_API_KEY
const originalOpenRouter = process.env.OPENROUTER_API_KEY

afterEach(() => {
  if (original === undefined) delete process.env.TYPESAFE_API_KEY
  else process.env.TYPESAFE_API_KEY = original
  if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalOpenRouter
})

const QUESTIONS = {
  answers_ask: {
    type: "choice" as const,
    instructions: "Does the reply answer the ask?",
    criteria: { fully: "yes", partly: "some", no: "no", unknown: "unclear" },
  },
}

describe("Jev contract", () => {
  it("pins the model and the official endpoint", () => {
    expect(JEV_MODEL).toBe("jev-1.13.0")
    expect(JEV_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone")
  })

  it("keeps the team's high-confidence bars in one constant", () => {
    expect(JEV_CONFIDENCE_GATES).toEqual({
      choiceConfidenceMin: 0.7,
      choiceTopProbabilityMin: 0.8,
      noulFalseMax: 0.1,
      noulTrueMin: 0.9,
    })
  })

  it("never uses an SDK, OpenRouter, or chat completions", () => {
    const source = readFileSync(join(process.cwd(), "lib/jev.server.ts"), "utf8")
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(source.startsWith('import "server-only"')).toBe(true)
    expect(code).not.toMatch(/typesafe-sdk|openrouter\.ai/i)
    expect(code).toContain("process.env[TYPESAFE_ENV_KEY]")
    expect(code).not.toMatch(/console\.(log|error|warn)/)
  })
})

describe("gateChoice", () => {
  const answer = (confidence: number, top: number, choice = "fully") => ({
    type: "choice",
    choice,
    probabilities: { fully: top, partly: (1 - top) / 2, no: (1 - top) / 2 },
    confidence,
  })

  it("decides only when confidence and the top option both clear the bar", () => {
    expect(gateChoice(answer(0.7, 0.8))).toMatchObject({ decided: true, choice: "fully" })
    expect(gateChoice(answer(0.84, 0.91))).toMatchObject({ decided: true, confidence: 0.84, topProbability: 0.91 })
  })

  it("treats anything under either bar as mid-band, not a decision", () => {
    expect(gateChoice(answer(0.69, 0.95))).toMatchObject({ decided: false, reason: "mid_band", choice: "fully" })
    expect(gateChoice(answer(0.9, 0.79))).toMatchObject({ decided: false, reason: "mid_band" })
  })

  it("rejects options outside the question and missing answers", () => {
    expect(gateChoice(answer(0.9, 0.9, "maybe"), ["fully", "partly", "no"])).toMatchObject({
      decided: false,
      reason: "unexpected_option",
    })
    expect(gateChoice(undefined)).toMatchObject({ decided: false, reason: "missing" })
    expect(gateChoice({ choice: "fully" })).toMatchObject({ decided: false, reason: "missing" })
  })

  it("falls back to the most probable option when choice is absent", () => {
    expect(gateChoice({ probabilities: { no: 0.85, fully: 0.15 }, confidence: 0.8 })).toMatchObject({
      decided: true,
      choice: "no",
    })
  })
})

describe("gateNoul", () => {
  it("only the extremes are decisions", () => {
    expect(gateNoul({ type: "noul", noul: 0.9 })).toEqual({ decided: true, value: true, noul: 0.9 })
    expect(gateNoul({ noul: 0.96 })).toMatchObject({ decided: true, value: true })
    expect(gateNoul({ noul: 0.1 })).toEqual({ decided: true, value: false, noul: 0.1 })
    expect(gateNoul({ noul: 0.02 })).toMatchObject({ decided: true, value: false })
  })

  it("leaves the middle to a person", () => {
    for (const noul of [0.11, 0.5, 0.89]) {
      expect(gateNoul({ noul })).toEqual({ decided: false, reason: "mid_band", noul })
    }
    expect(gateNoul({})).toEqual({ decided: false, reason: "missing", noul: null })
  })

  it("reports certainty for display", () => {
    expect(noulCertainty(0.96)).toBe(0.96)
    expect(noulCertainty(0.04)).toBeCloseTo(0.96)
    expect(noulCertainty(null)).toBeNull()
  })
})

describe("jevDecide", () => {
  it("degrades without a key and never calls the network", async () => {
    delete process.env.TYPESAFE_API_KEY
    process.env.OPENROUTER_API_KEY = "sk-or-should-never-be-used"
    const fetchImpl = vi.fn()
    expect(isJevConfigured()).toBe(false)
    const result = await jevDecide({ reply: "x" }, QUESTIONS, { fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts the pinned model, state, and questions with a bearer key", async () => {
    process.env.TYPESAFE_API_KEY = KEY
    const answers = { answers_ask: { type: "choice", choice: "fully", probabilities: { fully: 0.9 }, confidence: 0.85 } }
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ answers, id: "dec_1" }))

    const result = await jevDecide({ reply: "Done by Friday." }, QUESTIONS, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" })
    expect(JSON.parse(init.body)).toEqual({ model: "jev-1.13.0", state: { reply: "Done by Friday." }, questions: QUESTIONS })
    expect(result).toMatchObject({ ok: true, model: "jev-1.13.0", answers })
    if (result.ok) expect(result.raw).toEqual({ answers, id: "dec_1" })
  })

  it("scrubs the key out of HTTP errors", async () => {
    process.env.TYPESAFE_API_KEY = KEY
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`bad key ${KEY} (Bearer ${KEY})`, { status: 401 }))
    const result = await jevDecide({}, QUESTIONS, { fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: "http_error", status: 401 })
    if (!result.ok) {
      expect(result.error).not.toContain(KEY)
      expect(result.error).toContain("[REDACTED]")
    }
  })

  it("scrubs network errors and rejects a response without answers", async () => {
    process.env.TYPESAFE_API_KEY = KEY
    const failing = vi.fn().mockRejectedValue(new Error(`socket closed for ${KEY}`))
    const network = await jevDecide({}, QUESTIONS, { fetchImpl: failing })
    expect(network).toMatchObject({ ok: false, reason: "network_error" })
    if (!network.ok) expect(network.error).not.toContain(KEY)

    const shapeless = vi.fn().mockResolvedValue(Response.json({ result: "ok" }))
    expect(await jevDecide({}, QUESTIONS, { fetchImpl: shapeless })).toMatchObject({
      ok: false,
      reason: "bad_response",
    })
  })

  it("scrubSecrets removes env keys and bearer tokens", () => {
    process.env.TYPESAFE_API_KEY = KEY
    expect(scrubSecrets(`x ${KEY} y`)).toBe("x [REDACTED] y")
    expect(scrubSecrets("Authorization: Bearer abcdefghijkl")).toBe("Authorization: Bearer [REDACTED]")
  })
})
