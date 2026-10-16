import { createHmac, timingSafeEqual } from "node:crypto"

// Vercel team webhook → Slack note whenever an env var changes on any
// project in the team. Pure helpers live here so they can be unit-tested;
// the route does the network calls. Never read, log or forward env values:
// the webhook payload carries only ids, and lookups pick key + targets only.

export const ENV_CHANGE_EVENTS = [
  "project.env-variable.created",
  "project.env-variable.updated",
  "project.env-variable.deleted",
] as const

export type EnvChangeEventType = (typeof ENV_CHANGE_EVENTS)[number]

// Gaston asked to hear about every env var change (Oct 15, 2026).
export const ENV_CHANGE_SLACK_TARGET_DEFAULT = "U08L2F8LNP6"

export type EnvChangeEvent = {
  id: string
  type: EnvChangeEventType
  teamId: string | null
  userId: string | null
  projectId: string
  envVarId: string | null
}

export type EnvChangeDetails = {
  projectName: string | null
  key: string | null
  targets: string[]
  actor: string | null
}

/**
 * Vercel signs the raw request body with HMAC-SHA1 using the webhook secret
 * and sends the hex digest in `x-vercel-signature`.
 */
export function verifyVercelSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest()
  const received = Buffer.from(signature.trim(), "hex")
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

export function isEnvChangeEventType(type: unknown): type is EnvChangeEventType {
  return typeof type === "string" && (ENV_CHANGE_EVENTS as readonly string[]).includes(type)
}

/** Returns null for other event types or a payload without the ids we need. */
export function parseEnvChangeEvent(body: unknown): EnvChangeEvent | null {
  if (!body || typeof body !== "object") return null
  const event = body as {
    id?: unknown
    type?: unknown
    payload?: {
      team?: { id?: unknown } | null
      user?: { id?: unknown } | null
      projectId?: unknown
      envVarId?: unknown
    }
  }
  if (!isEnvChangeEventType(event.type)) return null
  if (typeof event.id !== "string" || !event.id) return null
  const payload = event.payload
  if (!payload || typeof payload.projectId !== "string" || !payload.projectId) return null
  const str = (value: unknown) => (typeof value === "string" && value ? value : null)
  return {
    id: event.id,
    type: event.type,
    teamId: str(payload.team?.id),
    userId: str(payload.user?.id),
    projectId: payload.projectId,
    envVarId: str(payload.envVarId),
  }
}

const TARGET_LABELS: Record<string, string> = {
  production: "Production",
  preview: "Preview",
  development: "Development",
}

export function formatTargets(targets: string[]): string {
  return targets.map((target) => TARGET_LABELS[target] ?? target).join(", ")
}

/**
 * One-line Slack text, e.g.
 * "Env var created on revfactor-hub (Production): ASSEMBLY_API_KEY, by Federico".
 * Values are never part of the input, so they can never be part of the text.
 */
export function formatEnvChangeMessage(
  event: Pick<EnvChangeEvent, "type" | "projectId" | "envVarId">,
  details: EnvChangeDetails,
): string {
  const verb = event.type.split(".").pop() ?? "changed"
  const project = details.projectName ?? event.projectId
  const targets = details.targets.length ? ` (${formatTargets(details.targets)})` : ""
  const name =
    details.key ??
    (event.envVarId ? `env var id ${event.envVarId} (key unavailable)` : "unknown env var")
  const actor = details.actor ? `, by ${details.actor}` : ""
  return `Env var ${verb} on ${project}${targets}: ${name}${actor}`
}

/**
 * Best-effort retry dedupe per warm instance; Vercel reuses the delivery id
 * on retries. `claim` returns false for an id already handled; `release`
 * lets a retry through again after a failed Slack post.
 */
export function createEventDeduper(max = 500) {
  const seen = new Set<string>()
  return {
    claim(eventId: string): boolean {
      if (seen.has(eventId)) return false
      seen.add(eventId)
      if (seen.size > max) {
        const oldest = seen.values().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      return true
    },
    release(eventId: string): void {
      seen.delete(eventId)
    },
  }
}
