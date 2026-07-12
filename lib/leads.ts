// Shared lead constants — client + server safe (no "use server", no next/headers).

export const LEAD_LOST_REASONS = [
  { value: "price", label: "Price" },
  { value: "timing", label: "Bad timing" },
  { value: "no_response", label: "No response" },
  { value: "not_qualified", label: "Not qualified" },
  { value: "competitor", label: "Went with competitor" },
  { value: "other", label: "Other" },
] as const

export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number]["value"]

export function leadLostReasonLabel(value: string | null): string | null {
  if (!value) return null
  return LEAD_LOST_REASONS.find((r) => r.value === value)?.label ?? value
}

/** won takes precedence, then lost, else open — mirrors the API's `outcome`. */
export type LeadOutcome = "won" | "lost" | "open"

export function leadOutcome(lead: {
  assembly_client_id: string | null
  lost_at: string | null
}): LeadOutcome {
  if (lead.assembly_client_id !== null) return "won"
  if (lead.lost_at !== null) return "lost"
  return "open"
}
