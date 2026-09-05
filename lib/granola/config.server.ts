const MAX_SOURCES = 5

export type GranolaSourceConfig = {
  id: string
  scope: "rep" | "workspace"
  token: string
  initialUpdatedAfter: string
}

export function parseGranolaSources(
  value: string | undefined
): GranolaSourceConfig[] {
  if (!value) throw new Error("Missing Granola source configuration")
  const parsed = JSON.parse(value) as unknown
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > MAX_SOURCES
  ) {
    throw new Error("Invalid Granola source count")
  }

  const ids = new Set<string>()
  return parsed.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid Granola source")
    }
    const source = entry as Record<string, unknown>
    const id = typeof source.id === "string" ? source.id.trim() : ""
    const scope = source.scope
    const token = typeof source.token === "string" ? source.token.trim() : ""
    const initialUpdatedAfter =
      typeof source.initialUpdatedAfter === "string"
        ? source.initialUpdatedAfter
        : ""
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ||
      ids.has(id) ||
      (scope !== "rep" && scope !== "workspace") ||
      !token ||
      token.length > 1_024 ||
      !Number.isFinite(Date.parse(initialUpdatedAfter))
    ) {
      throw new Error("Invalid Granola source")
    }
    ids.add(id)
    return { id, scope, token, initialUpdatedAfter }
  })
}
