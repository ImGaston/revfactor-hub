export const PROFIT_FIRST = {
  partnerA: 30,
  partnerB: 30,
  tax: 15,
  opex: 25,
} as const

export type ProfitFirstAllocation = {
  partnerACents: number
  partnerBCents: number
  taxCents: number
  opexCents: number
}

export type ScenarioListingInput = {
  id: string
  name: string
  monthlyRevenueCents: number
  startMonth: string
  endMonth: string | null
}

export type ScenarioEventKind =
  | "fixed_expense"
  | "variable_expense"
  | "growth_investment"
  | "capital_contribution"

export type ScenarioEventInput = {
  id: string
  kind: ScenarioEventKind
  description: string
  amountCents: number
  recurrence: "one_time" | "monthly"
  startMonth: string
  endMonth: string | null
}

export type ForecastMonth = {
  month: string
  revenueCents: number
  partnerACents: number
  partnerBCents: number
  taxCents: number
  opexAllocatedCents: number
  fixedExpensesCents: number
  variableExpensesCents: number
  growthInvestmentCents: number
  capitalContributionCents: number
  operatingCashFlowCents: number
  endingCashCents: number
}

export function allocateProfitFirst(
  amountCents: number
): ProfitFirstAllocation {
  const safeAmount = Math.max(0, Math.round(amountCents))
  const partnerACents = Math.round(safeAmount * (PROFIT_FIRST.partnerA / 100))
  const partnerBCents = Math.round(safeAmount * (PROFIT_FIRST.partnerB / 100))
  const taxCents = Math.round(safeAmount * (PROFIT_FIRST.tax / 100))

  return {
    partnerACents,
    partnerBCents,
    taxCents,
    opexCents: safeAmount - partnerACents - partnerBCents - taxCents,
  }
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function addMonths(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number)
  return monthKey(new Date(year, monthNumber - 1 + offset, 1))
}

function activeInMonth(
  month: string,
  startMonth: string,
  endMonth: string | null
): boolean {
  return (
    month >= startMonth.slice(0, 7) &&
    (!endMonth || month <= endMonth.slice(0, 7))
  )
}

export function buildForecast(input: {
  startMonth: string
  horizonMonths: number
  openingCashCents: number
  listings: ScenarioListingInput[]
  events: ScenarioEventInput[]
}): ForecastMonth[] {
  let cash = Math.round(input.openingCashCents)
  const rows: ForecastMonth[] = []

  for (let index = 0; index < input.horizonMonths; index++) {
    const month = addMonths(input.startMonth.slice(0, 7), index)
    const revenueCents = input.listings
      .filter((listing) =>
        activeInMonth(month, listing.startMonth, listing.endMonth)
      )
      .reduce(
        (sum, listing) => sum + Math.round(listing.monthlyRevenueCents),
        0
      )
    const allocation = allocateProfitFirst(revenueCents)

    const monthEvents = input.events.filter((event) => {
      if (!activeInMonth(month, event.startMonth, event.endMonth)) return false
      return (
        event.recurrence === "monthly" || month === event.startMonth.slice(0, 7)
      )
    })

    const totalFor = (kind: ScenarioEventKind) =>
      monthEvents
        .filter((event) => event.kind === kind)
        .reduce((sum, event) => sum + Math.round(event.amountCents), 0)

    const fixedExpensesCents = totalFor("fixed_expense")
    const variableExpensesCents = totalFor("variable_expense")
    const growthInvestmentCents = totalFor("growth_investment")
    const capitalContributionCents = totalFor("capital_contribution")
    const operatingCashFlowCents =
      allocation.opexCents +
      capitalContributionCents -
      fixedExpensesCents -
      variableExpensesCents -
      growthInvestmentCents

    cash += operatingCashFlowCents
    rows.push({
      month,
      revenueCents,
      partnerACents: allocation.partnerACents,
      partnerBCents: allocation.partnerBCents,
      taxCents: allocation.taxCents,
      opexAllocatedCents: allocation.opexCents,
      fixedExpensesCents,
      variableExpensesCents,
      growthInvestmentCents,
      capitalContributionCents,
      operatingCashFlowCents,
      endingCashCents: cash,
    })
  }

  return rows
}

export function calculateRunwayMonths(
  forecast: ForecastMonth[]
): number | null {
  const negativeIndex = forecast.findIndex((row) => row.endingCashCents < 0)
  return negativeIndex === -1 ? null : negativeIndex
}

export function validateAllocations(
  totalCents: number,
  allocations: { amountCents: number }[]
): boolean {
  return (
    allocations.length > 0 &&
    allocations.every((allocation) => allocation.amountCents > 0) &&
    allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) ===
      Math.round(totalCents)
  )
}
