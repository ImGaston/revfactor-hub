// Who operates a listing: the hostpricing (India) team or RevFactor itself.
// Source of truth is listings.managed_by (migration 20261009120000). Only
// /monthly-summary filters on it — it counts hostpricing listings only.
// Client + server safe.

export const MANAGED_BY = ["hostpricing", "revfactor"] as const
export type ManagedBy = (typeof MANAGED_BY)[number]

export const DEFAULT_MANAGED_BY: ManagedBy = "hostpricing"

export const MANAGED_BY_LABEL: Record<ManagedBy, string> = {
  hostpricing: "Hostpricing",
  revfactor: "RevFactor",
}

export function isManagedBy(value: unknown): value is ManagedBy {
  return MANAGED_BY.includes(value as ManagedBy)
}
