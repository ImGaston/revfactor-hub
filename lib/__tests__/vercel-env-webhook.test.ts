import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  createEventDeduper,
  formatEnvChangeMessage,
  parseEnvChangeEvent,
  verifyVercelSignature,
} from "@/lib/vercel-env-webhook"

const SECRET = "test-webhook-secret"
const sign = (body: string, secret = SECRET) =>
  createHmac("sha1", secret).update(body, "utf8").digest("hex")

const body = JSON.stringify({
  id: "evt_1",
  type: "project.env-variable.created",
  createdAt: 1760500000000,
  region: null,
  payload: {
    team: { id: "team_1" },
    user: { id: "user_1" },
    projectId: "prj_1",
    envVarId: "env_1",
  },
})

describe("verifyVercelSignature", () => {
  it("accepts the HMAC-SHA1 hex of the raw body", () => {
    expect(verifyVercelSignature(body, sign(body), SECRET)).toBe(true)
  })

  it("rejects a wrong secret, a tampered body, and missing or malformed headers", () => {
    expect(verifyVercelSignature(body, sign(body, "other"), SECRET)).toBe(false)
    expect(verifyVercelSignature(`${body} `, sign(body), SECRET)).toBe(false)
    expect(verifyVercelSignature(body, null, SECRET)).toBe(false)
    expect(verifyVercelSignature(body, "not-hex", SECRET)).toBe(false)
    expect(verifyVercelSignature(body, sign(body).slice(0, 20), SECRET)).toBe(false)
    expect(verifyVercelSignature(body, sign(body), "")).toBe(false)
  })
})

describe("parseEnvChangeEvent", () => {
  it("reads ids from an env-variable event", () => {
    expect(parseEnvChangeEvent(JSON.parse(body))).toEqual({
      id: "evt_1",
      type: "project.env-variable.created",
      teamId: "team_1",
      userId: "user_1",
      projectId: "prj_1",
      envVarId: "env_1",
    })
  })

  it("ignores other event types and payloads without a project", () => {
    expect(parseEnvChangeEvent({ ...JSON.parse(body), type: "deployment.created" })).toBeNull()
    expect(parseEnvChangeEvent({ id: "evt_2", type: "project.env-variable.deleted", payload: {} })).toBeNull()
    expect(parseEnvChangeEvent(null)).toBeNull()
  })

  it("allows a null envVarId on deletes", () => {
    const event = parseEnvChangeEvent({
      id: "evt_3",
      type: "project.env-variable.deleted",
      payload: { team: null, user: null, projectId: "prj_1", envVarId: null },
    })
    expect(event).toMatchObject({ envVarId: null, teamId: null, userId: null })
  })
})

describe("formatEnvChangeMessage", () => {
  const event = { type: "project.env-variable.created" as const, projectId: "prj_1", envVarId: "env_1" }

  it("names project, targets, key and actor", () => {
    expect(
      formatEnvChangeMessage(event, {
        projectName: "revfactor-hub",
        key: "ASSEMBLY_LISTING_REVIEW_TAG_FIELD",
        targets: ["production"],
        actor: "Federico",
      }),
    ).toBe("Env var created on revfactor-hub (Production): ASSEMBLY_LISTING_REVIEW_TAG_FIELD, by Federico")
  })

  it("lists several targets", () => {
    expect(
      formatEnvChangeMessage(
        { ...event, type: "project.env-variable.updated" },
        { projectName: "revfactor-hub", key: "FOO", targets: ["production", "preview", "development"], actor: null },
      ),
    ).toBe("Env var updated on revfactor-hub (Production, Preview, Development): FOO")
  })

  it("falls back to ids when lookups fail, e.g. after a delete", () => {
    expect(
      formatEnvChangeMessage(
        { ...event, type: "project.env-variable.deleted" },
        { projectName: null, key: null, targets: [], actor: null },
      ),
    ).toBe("Env var deleted on prj_1: env var id env_1 (key unavailable)")
    expect(
      formatEnvChangeMessage(
        { ...event, type: "project.env-variable.deleted", envVarId: null },
        { projectName: "revfactor-hub", key: null, targets: [], actor: "Gaston" },
      ),
    ).toBe("Env var deleted on revfactor-hub: unknown env var, by Gaston")
  })
})

describe("createEventDeduper", () => {
  it("claims each event id once and lets a released id retry", () => {
    const dedupe = createEventDeduper(2)
    expect(dedupe.claim("a")).toBe(true)
    expect(dedupe.claim("a")).toBe(false)
    dedupe.release("a")
    expect(dedupe.claim("a")).toBe(true)
    dedupe.claim("b")
    dedupe.claim("c")
    // "a" was evicted as the oldest once the cap was passed.
    expect(dedupe.claim("a")).toBe(true)
  })
})
