// Billing entity split: RevFactor clients vs Blackbird Hospitality, which the
// India team bills separately. Source of truth is clients.billing_entity
// (migration 20260928120000); a listing without a client is also Blackbird
// (migration 091 rule). Client + server safe.

export const BILLING_ENTITIES = ["revfactor", "blackbird"] as const
export type BillingEntity = (typeof BILLING_ENTITIES)[number]

export const BILLING_ENTITY_LABEL: Record<BillingEntity, string> = {
  revfactor: "RevFactor",
  blackbird: "Blackbird",
}

export function isBillingEntity(value: unknown): value is BillingEntity {
  return BILLING_ENTITIES.includes(value as BillingEntity)
}

/** Entity of a listing given its (possibly missing) client's billing_entity. */
export function listingBillingEntity(
  client: { billing_entity?: string | null } | null | undefined
): BillingEntity {
  if (!client) return "blackbird"
  return client.billing_entity === "blackbird" ? "blackbird" : "revfactor"
}
