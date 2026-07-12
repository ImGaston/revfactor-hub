// Shared attribution parsing for the inbound lead webhooks — pure, no I/O.

export const ATTRIBUTION_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "msclkid",
  "fbclid",
  "referrer",
  "landing_page",
] as const

export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number]

export type AttributionColumns = Record<AttributionField, string | null> & {
  attribution_extra: Record<string, unknown>
}

type RawSource = Record<string, unknown> | null | undefined

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Accepts attribution both nested under `attribution` and at the top level of
 * the payload; top-level wins. Keys outside the canonical nine are preserved in
 * `attribution_extra` so marketing can add a tracking param without a migration.
 */
export function parseAttribution(body: Record<string, unknown>): AttributionColumns {
  const nested = (
    typeof body.attribution === "object" ? body.attribution : null
  ) as RawSource

  const columns = {} as AttributionColumns
  for (const field of ATTRIBUTION_FIELDS) {
    columns[field] = clean(body[field]) ?? clean(nested?.[field])
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(nested ?? {})) {
    if (!ATTRIBUTION_FIELDS.includes(key as AttributionField) && value != null) {
      extra[key] = value
    }
  }
  columns.attribution_extra = extra

  return columns
}

/** True when the payload carried any attribution at all. */
export function hasAttribution(columns: AttributionColumns): boolean {
  return (
    ATTRIBUTION_FIELDS.some((field) => columns[field] !== null) ||
    Object.keys(columns.attribution_extra).length > 0
  )
}
