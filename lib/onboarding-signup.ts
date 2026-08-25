import { z } from "zod"

export const STANDARD_PRIMARY_MONTHLY_RATE = 350
export const STANDARD_CHILD_MONTHLY_RATE = 50
export const STANDARD_ONBOARDING_FEE = 150

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export const standardOnboardingSignupSchema = z.object({
  legalName: z.string().trim().min(2).max(255),
  contactName: z.string().trim().min(2).max(255),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  phone: z.string().trim().max(40).optional(),
  primaryListingQuantity: z.coerce.number().int().min(1).max(5),
  childListingQuantity: z.coerce.number().int().min(0).max(5),
  serviceStartMode: z.enum(["immediate", "scheduled"]),
  serviceStartDate: z.string().trim().regex(datePattern).nullable().optional(),
})

export type StandardOnboardingSignup = z.infer<
  typeof standardOnboardingSignupSchema
>

function dateAtNoonUtc(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCHours(12, 0, 0, 0)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function validateStandardServiceStart(
  input: Pick<StandardOnboardingSignup, "serviceStartMode" | "serviceStartDate">,
  now = new Date(),
): string | null {
  if (input.serviceStartMode === "immediate") return null

  const date = input.serviceStartDate
  if (!date || !datePattern.test(date)) {
    throw new Error("A valid scheduled service-start date is required")
  }

  const minimum = dateInputValue(addUtcDays(now, 3))
  const maximum = dateInputValue(addUtcDays(now, 120))
  if (date < minimum || date > maximum) {
    throw new Error(
      `Scheduled service must begin between ${minimum} and ${maximum}`,
    )
  }

  return date
}

export function getStandardServiceTrialEnd(date: string): number {
  return Math.floor(dateAtNoonUtc(date).getTime() / 1000)
}

function formatServiceStart(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateAtNoonUtc(date))
}

export function buildStandardOnboardingValues(
  input: StandardOnboardingSignup,
  now = new Date(),
) {
  const serviceStartDate = validateStandardServiceStart(input, now)
  const primaryMonthlyAmount =
    input.primaryListingQuantity * STANDARD_PRIMARY_MONTHLY_RATE
  const childMonthlyAmount =
    input.childListingQuantity * STANDARD_CHILD_MONTHLY_RATE
  const monthlyServiceFee = primaryMonthlyAmount + childMonthlyAmount
  const initialCheckoutTotal =
    input.serviceStartMode === "scheduled"
      ? STANDARD_ONBOARDING_FEE
      : monthlyServiceFee + STANDARD_ONBOARDING_FEE
  const pricingProgram = serviceStartDate
    ? `Regular - Monthly service begins ${formatServiceStart(serviceStartDate)}`
    : "Regular"

  return {
    pricingProgram,
    primaryMonthlyAmount,
    childMonthlyAmount,
    monthlyServiceFee,
    onboardingFee: STANDARD_ONBOARDING_FEE,
    initialCheckoutTotal,
    serviceStartDate,
    trialEnd: serviceStartDate
      ? getStandardServiceTrialEnd(serviceStartDate)
      : undefined,
  }
}
