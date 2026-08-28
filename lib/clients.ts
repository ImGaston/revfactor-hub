// Shared client constants — client + server safe (no "use server", no next/headers).

export const CLIENT_CHURN_REASONS = [
  { value: "price", label: "Price / cost" },
  { value: "results", label: "Results / performance" },
  { value: "sold_property", label: "Sold property" },
  { value: "exited_str", label: "Exited short-term rentals" },
  { value: "self_management", label: "Self-managing pricing" },
  { value: "competitor", label: "Switched to competitor" },
  { value: "contract_ended", label: "Contract ended (not renewed)" },
  { value: "service_issue", label: "Service / communication issue" },
  { value: "non_payment", label: "Non-payment" },
  { value: "other", label: "Other" },
] as const

export type ClientChurnReason = (typeof CLIENT_CHURN_REASONS)[number]["value"]

export function churnReasonLabel(value: string): string {
  return CLIENT_CHURN_REASONS.find((r) => r.value === value)?.label ?? value
}

/**
 * Churn-field patch for a client status change, shared by the Settings clients
 * action and the onboarding board action so their behavior can't drift.
 *
 * - Going inactive: ending_date falls back to today when none is provided.
 * - Leaving inactive: clears ending_date and churn reasons — ending_date doubles
 *   as the planned contract end for active clients, so it's only cleared on the
 *   actual inactive → active/onboarding transition.
 */
export function clientStatusPatch(
  currentStatus: string | null,
  nextStatus: string,
  proposedEndingDate: string | null
): Partial<{
  ending_date: string | null
  ending_reason_tags: string[]
  ending_note: string | null
}> {
  if (nextStatus === "inactive") {
    return {
      ending_date:
        proposedEndingDate ?? new Date().toISOString().split("T")[0],
    }
  }
  if (currentStatus === "inactive") {
    return { ending_date: null, ending_reason_tags: [], ending_note: null }
  }
  return {}
}
