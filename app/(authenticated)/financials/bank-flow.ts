import type { BankFlowClass } from "@/lib/types"

export const FLOW_LABELS: Record<BankFlowClass, string> = {
  external_income: "Income",
  external_expense: "Expense",
  internal_transfer: "Transfer",
  profit_first: "Profit First",
  unknown: "Unknown",
}

export function flowBadgeVariant(
  flow: BankFlowClass
): "default" | "secondary" | "outline" | "destructive" {
  switch (flow) {
    case "external_income":
      return "default"
    case "external_expense":
      return "destructive"
    case "internal_transfer":
    case "profit_first":
      return "secondary"
    default:
      return "outline"
  }
}
