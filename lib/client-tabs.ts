// Client page tabs (/clients/[id]?tab=…) — client+server-safe keys.
// Legacy is the default and is the only tab rendered with the page; the others
// load their data when first opened.

export const CLIENT_TABS = [
  { value: "legacy", label: "Legacy" },
  { value: "onboarding", label: "Onboarding" },
  { value: "journey", label: "Customer Journey" },
  { value: "profile", label: "Client Profile" },
  { value: "tickets", label: "Support Tickets" },
  { value: "adjustments", label: "Adjustment Requests" },
  { value: "connections", label: "Data Connections" },
] as const

export type ClientTab = (typeof CLIENT_TABS)[number]["value"]

export const DEFAULT_CLIENT_TAB: ClientTab = "legacy"

export function parseClientTab(value: string | string[] | undefined | null): ClientTab {
  const v = Array.isArray(value) ? value[0] : value
  return CLIENT_TABS.some((t) => t.value === v) ? (v as ClientTab) : DEFAULT_CLIENT_TAB
}
