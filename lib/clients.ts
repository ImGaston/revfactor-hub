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
