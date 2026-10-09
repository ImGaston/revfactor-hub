import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const oidc = vi.hoisted(() => ({ token: vi.fn<() => Promise<string>>() }))
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidc.token }))

import {
  JEV_CONFIDENCE_GATES,
  JEV_ENDPOINT,
  JEV_GATEWAY_ENDPOINT,
  JEV_GATEWAY_MODEL,
  JEV_MODEL,
  gateChoice,
  gateNoul,
  normalizeJevAnswer,
  noulCertainty,
  toGatewayQuestions,
  type JevQuestions,
} from "@/lib/jev"
import { isJevConfigured, jevDecide, scrubSecrets, testJevConnection } from "@/lib/jev.server"

// Every network call here is a stub: nothing reaches AI Gateway or TypeSafe.

const ENV = ["TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL", "OPENROUTER_API_KEY"] as const
const saved: Record<string, string | undefined> = {}
const GATEWAY_KEY = "vck_gateway_test_key_0123456789"
const TS_KEY = "ts_test_key_0123456789abcdef"

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  oidc.token.mockReset()
  oidc.token.mockRejectedValue(new Error("no oidc"))
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const QUESTIONS: JevQuestions = {
  answers_ask: {
    type: "choice",
    instructions: "Does the reply answer the ask?",
    criteria: { fully: "all of it", partly: "some of it", no: "none of it", unknown: "unclear" },
  },
  promise_without_date: {
    type: "noul",
    instructions: "The reply promises work without a date.",
    criteria: { true: "an undated promise", false: "no undated promise" },
  },
}

describe("Jev contract", () => {
  it("uses AI Gateway's evaluate endpoint and model, with a pinned direct fallback", () => {
    expect(JEV_GATEWAY_ENDPOINT).toBe("https://ai-gateway.vercel.sh/v1/evaluate")
    expect(JEV_GATEWAY_MODEL).toBe("typesafe-ai/jev")
    expect(JEV_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone")
    expect(JEV_MODEL).toBe("jev-1.13.0")
  })

  it("keeps the team's high-confidence bars in one constant", () => {
    expect(JEV_CONFIDENCE_GATES).toEqual({
      choiceConfidenceMin: 0.7,
      choiceTopProbabilityMin: 0.8,
      noulFalseMax: 0.1,
      noulTrueMin: 0.9,
    })
  })

  it("never uses an SDK, OpenRouter, chat completions, or logs", () => {
    const code = readFileSync(join(process.cwd(), "lib/jev.server.ts"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(code.startsWith('import "server-only"')).toBe(true)
    expect(code).not.toMatch(/typesafe-sdk|openrouter\.ai|experimental_evaluate/i)
    expect(code).not.toMatch(/console\.(log|error|warn)/)
  })
})

describe("question mapping", () => {
  it("noul becomes boolean and both keep their criteria (the gateway requires a choice's)", () => {
    const mapped = toGatewayQuestions(QUESTIONS)
    expect(mapped.promise_without_date).toEqual({
      type: "boolean",
      instructions: "The reply promises work without a date.",
      criteria: { true: "an undated promise", false: "no undated promise" },
    })
    expect(mapped.answers_ask).toMatchObject({ type: "choice" })
    expect(mapped.answers_ask.criteria).toMatchObject({ partly: "some of it" })
    expect(Object.keys(mapped.answers_ask.criteria)).toEqual(["fully", "partly", "no", "unknown"])
    expect(mapped.answers_ask).not.toHaveProperty("options")
  })
})

describe("response normalization (gateway and direct shapes)", () => {
  it("reads booleans from probability (gateway) or noul (direct)", () => {
    expect(normalizeJevAnswer({ probability: 0.94 }, "noul")).toEqual({ noul: 0.94 })
    expect(normalizeJevAnswer({ type: "noul", noul: 0.03 }, "noul")).toEqual({ noul: 0.03 })
    expect(normalizeJevAnswer(0.5, "noul")).toEqual({ noul: 0.5 })
    expect(normalizeJevAnswer({ answer: "yes" }, "noul")).toEqual({})
  })

  it("reads choices from several shapes", () => {
    expect(normalizeJevAnswer({ choice: "fully", probabilities: { fully: 0.9, no: 0.1 }, confidence: 0.8 }, "choice")).toEqual({
      choice: "fully",
      probabilities: { fully: 0.9, no: 0.1 },
      confidence: 0.8,
    })
    expect(
      normalizeJevAnswer({ option: "partly", distribution: [{ option: "partly", probability: 0.85 }, { option: "no", probability: 0.15 }] }, "choice")
    ).toEqual({ choice: "partly", probabilities: { partly: 0.85, no: 0.15 } })
    expect(normalizeJevAnswer({ choice: "no", probability: 0.91 }, "choice")).toEqual({ choice: "no", probabilities: { no: 0.91 } })
    expect(normalizeJevAnswer(null, "choice")).toEqual({})
  })
})

describe("gateChoice", () => {
  const answer = (confidence: number | undefined, top: number, choice = "fully") => ({
    choice,
    probabilities: { fully: top, partly: (1 - top) / 2, no: (1 - top) / 2 },
    ...(confidence === undefined ? {} : { confidence }),
  })

  it("decides only when confidence and the top option both clear the bar", () => {
    expect(gateChoice(answer(0.7, 0.8))).toMatchObject({ decided: true, choice: "fully" })
    expect(gateChoice(answer(0.69, 0.95))).toMatchObject({ decided: false, reason: "mid_band" })
    expect(gateChoice(answer(0.9, 0.79))).toMatchObject({ decided: false, reason: "mid_band" })
  })

  it("uses the top probability when the gateway sends no separate confidence", () => {
    expect(gateChoice(answer(undefined, 0.85))).toMatchObject({ decided: true, confidence: 0.85 })
    expect(gateChoice(answer(undefined, 0.75))).toMatchObject({ decided: false, reason: "mid_band" })
  })

  it("a choice without probabilities, an unknown option, or nothing is never a decision", () => {
    expect(gateChoice({ choice: "fully" })).toMatchObject({ decided: false, reason: "missing" })
    expect(gateChoice(answer(0.9, 0.9, "maybe"), ["fully", "partly", "no"])).toMatchObject({ reason: "unexpected_option" })
    expect(gateChoice(undefined)).toMatchObject({ decided: false, reason: "missing" })
  })
})

describe("gateNoul", () => {
  it("only the extremes are decisions", () => {
    expect(gateNoul({ noul: 0.9 })).toEqual({ decided: true, value: true, noul: 0.9 })
    expect(gateNoul({ probability: 0.1 })).toEqual({ decided: true, value: false, noul: 0.1 })
    for (const noul of [0.11, 0.5, 0.89]) expect(gateNoul({ noul })).toEqual({ decided: false, reason: "mid_band", noul })
  })

  it("missing or out-of-range values need a human", () => {
    expect(gateNoul({})).toEqual({ decided: false, reason: "missing", noul: null })
    expect(gateNoul({ probability: 1.4 })).toEqual({ decided: false, reason: "missing", noul: null })
  })

  it("reports certainty for display", () => {
    expect(noulCertainty(0.04)).toBeCloseTo(0.96)
    expect(noulCertainty(null)).toBeNull()
  })
})

describe("jevDecide transports", () => {
  it("is not configured without AI Gateway or a TypeSafe key, and never calls the network", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-should-never-be-used"
    const fetchImpl = vi.fn()
    expect(isJevConfigured()).toBe(false)
    expect(await jevDecide({ reply: "x" }, QUESTIONS, { fetchImpl })).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("calls AI Gateway /v1/evaluate with the gateway key and the mapped questions", async () => {
    process.env.AI_GATEWAY_API_KEY = GATEWAY_KEY
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        model: "typesafe-ai/jev-1.14.2",
        answers: {
          answers_ask: { choice: "fully", probabilities: { fully: 0.9, partly: 0.1 } },
          promise_without_date: { probability: 0.04 },
        },
      })
    )
    const result = await jevDecide({ reply: "Done by Friday." }, QUESTIONS, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/evaluate")
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${GATEWAY_KEY}`, "ai-gateway-auth-method": "api-key" })
    const body = JSON.parse(init.body)
    expect(body.model).toBe("typesafe-ai/jev")
    expect(body.questions.promise_without_date.type).toBe("boolean")
    expect(Object.keys(body.questions.answers_ask.criteria)).toEqual(["fully", "partly", "no", "unknown"])
    expect(body.questions.answers_ask).not.toHaveProperty("options")
    expect(result).toMatchObject({
      ok: true,
      transport: "gateway",
      model: "typesafe-ai/jev",
      modelVersion: "typesafe-ai/jev-1.14.2",
      answers: { answers_ask: { choice: "fully" }, promise_without_date: { noul: 0.04 } },
    })
  })

  it("uses the Vercel OIDC token in deployments", async () => {
    process.env.VERCEL = "1"
    oidc.token.mockResolvedValue("oidc_token_abcdefghijkl")
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ answers: {} }))
    await jevDecide({}, QUESTIONS, { fetchImpl })
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer oidc_token_abcdefghijkl",
      "ai-gateway-auth-method": "oidc",
    })
  })

  it("falls back to TypeSafe directly (pinned, native questions) when the gateway fails and a key is set", async () => {
    process.env.AI_GATEWAY_API_KEY = GATEWAY_KEY
    process.env.TYPESAFE_API_KEY = TS_KEY
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(`model blocked for ${GATEWAY_KEY}`, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ answers: { promise_without_date: { type: "noul", noul: 0.97 } } }))
    const result = await jevDecide({}, QUESTIONS, { fetchImpl })
    expect(fetchImpl.mock.calls[1][0]).toBe("https://api.typesafe.ai/v1/systemone")
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(body.model).toBe("jev-1.13.0")
    expect(body.questions).toEqual(QUESTIONS)
    expect(result).toMatchObject({ ok: true, transport: "typesafe", answers: { promise_without_date: { noul: 0.97 } } })
  })

  it("uses TypeSafe directly when only its key is set", async () => {
    process.env.TYPESAFE_API_KEY = TS_KEY
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ answers: {} }))
    expect(isJevConfigured()).toBe(true)
    await jevDecide({}, QUESTIONS, { fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone")
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TS_KEY}`)
  })

  it("scrubs every token out of errors", async () => {
    process.env.AI_GATEWAY_API_KEY = GATEWAY_KEY
    const http = vi.fn().mockResolvedValue(new Response(`bad ${GATEWAY_KEY} (Bearer ${GATEWAY_KEY})`, { status: 401 }))
    const result = await jevDecide({}, QUESTIONS, { fetchImpl: http })
    expect(result).toMatchObject({ ok: false, reason: "http_error", status: 401 })
    if (!result.ok) expect(result.error).not.toContain(GATEWAY_KEY)

    const network = vi.fn().mockRejectedValue(new Error(`socket closed for ${GATEWAY_KEY}`))
    const net = await jevDecide({}, QUESTIONS, { fetchImpl: network })
    if (!net.ok) expect(net.error).not.toContain(GATEWAY_KEY)

    const shapeless = vi.fn().mockResolvedValue(Response.json({ result: "ok" }))
    expect(await jevDecide({}, QUESTIONS, { fetchImpl: shapeless })).toMatchObject({ ok: false, reason: "bad_response" })
  })

  it("scrubSecrets removes env keys, extra tokens, and bearer headers", () => {
    process.env.TYPESAFE_API_KEY = TS_KEY
    expect(scrubSecrets(`x ${TS_KEY} y`)).toBe("x [REDACTED] y")
    expect(scrubSecrets("token abcdefghij here", ["abcdefghij"])).toBe("token [REDACTED] here")
    expect(scrubSecrets("Authorization: Bearer abcdefghijkl")).toBe("Authorization: Bearer [REDACTED]")
  })
})

describe("testJevConnection", () => {
  it("reports transport, model, latency, and the live answer fields", async () => {
    process.env.AI_GATEWAY_API_KEY = GATEWAY_KEY
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ answers: { connection_check: { probability: 0.98, rationale: "x" }, connection_choice: { choice: "blue", probabilities: { blue: 0.99, other: 0.01 } } } }))
    const result = await testJevConnection({ fetchImpl })
    expect(result).toMatchObject({
      ok: true,
      transport: "gateway",
      model: "typesafe-ai/jev",
      probability: 0.98,
      decided: true,
      answerFields: ["probability", "rationale"],
    })
    expect(JSON.stringify(result)).not.toContain(GATEWAY_KEY)
  })

  it("explains a failure without secrets", async () => {
    const result = await testJevConnection({ fetchImpl: vi.fn() })
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
  })
})
