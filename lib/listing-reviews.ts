import { z } from "zod"

export const LISTING_REVIEW_BUCKET = "listing-review-financials"
export const LISTING_REVIEW_MAX_FILE_BYTES = 20 * 1024 * 1024
export const LISTING_REVIEW_MAX_FILES_PER_PROPERTY = 5

export const LISTING_REVIEW_FILE_TYPES = [
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const

export const LISTING_REVIEW_FILE_EXTENSIONS = ["pdf", "csv", "xlsx"] as const

export const PROPERTY_STAGE_OPTIONS = [
  { value: "live", label: "Live and accepting bookings" },
  { value: "pre_launch", label: "Preparing to launch" },
  { value: "paused", label: "Temporarily paused" },
  { value: "renovation", label: "Renovation or major refresh" },
  { value: "not_acquired", label: "Not yet acquired" },
  { value: "other", label: "Other" },
] as const

export const PERIOD_OPTIONS = [
  { value: "trailing_12_months", label: "Trailing 12 months" },
  { value: "calendar_year", label: "Calendar year" },
  { value: "year_to_date", label: "Year to date" },
  { value: "custom", label: "Custom period" },
] as const

export const REVENUE_BASIS_OPTIONS = [
  { value: "gross", label: "Gross" },
  { value: "net", label: "Net" },
  { value: "not_sure", label: "Not sure" },
] as const

export const REVENUE_INCLUDE_OPTIONS = [
  { value: "accommodation", label: "Accommodation / nightly revenue" },
  { value: "cleaning_fees", label: "Cleaning fees charged to guests" },
  { value: "other_guest_fees", label: "Pet or other guest fees" },
  { value: "taxes", label: "Taxes" },
  { value: "refundable_deposits", label: "Refundable deposits" },
] as const

export const REVENUE_DEDUCTION_OPTIONS = [
  {
    value: "platform_fees",
    label: "Airbnb, Vrbo, or other platform commissions",
  },
  { value: "payment_processing_fees", label: "Payment-processing fees" },
  { value: "management_fees", label: "Property-management fees" },
  { value: "cleaning_turnover_costs", label: "Cleaning or turnover costs" },
  { value: "operating_expenses", label: "Operating expenses" },
  { value: "other_deductions", label: "Other deductions" },
] as const

const PeriodKindSchema = z.enum([
  "trailing_12_months",
  "calendar_year",
  "year_to_date",
  "custom",
])

const RevenueBasisSchema = z.enum(["gross", "net", "not_sure"])

const MoneyStringSchema = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d{1,2})?$/,
    "Enter a positive amount with up to two decimals"
  )
  .refine((value) => Number(value) >= 0, "Amount must be zero or more")

export const ListingReviewPropertyDraftSchema = z.object({
  propertyName: z.string().trim().max(160).default(""),
  addressStatus: z
    .enum(["confirmed", "corrected", "not_sure"])
    .default("not_sure"),
  address: z.string().trim().max(500).default(""),
  stage: z
    .enum([
      "live",
      "pre_launch",
      "paused",
      "renovation",
      "not_acquired",
      "other",
    ])
    .default("live"),
  listingUrls: z.array(z.string().trim().max(2_000)).max(5).default([]),
  actualRevenue: z.string().trim().max(40).default(""),
  actualCurrency: z.string().trim().length(3).default("USD"),
  actualPeriodKind: PeriodKindSchema.default("trailing_12_months"),
  actualPeriodYear: z.string().trim().max(4).default(""),
  actualPeriodStart: z.string().trim().max(10).default(""),
  actualPeriodEnd: z.string().trim().max(10).default(""),
  actualBasis: RevenueBasisSchema.default("not_sure"),
  revenueIncludes: z
    .array(
      z.enum([
        "accommodation",
        "cleaning_fees",
        "other_guest_fees",
        "taxes",
        "refundable_deposits",
      ])
    )
    .max(5)
    .default(["accommodation"]),
  deductionsTaken: z
    .array(
      z.enum([
        "platform_fees",
        "payment_processing_fees",
        "management_fees",
        "cleaning_turnover_costs",
        "operating_expenses",
        "other_deductions",
      ])
    )
    .max(6)
    .default([]),
  revenueDefinitionNotes: z.string().trim().max(2_000).default(""),
  targetRevenue: z.string().trim().max(40).default(""),
  targetCurrency: z.string().trim().length(3).default("USD"),
  targetPeriodKind: PeriodKindSchema.default("calendar_year"),
  targetPeriodYear: z.string().trim().max(4).default(""),
  targetPeriodStart: z.string().trim().max(10).default(""),
  targetPeriodEnd: z.string().trim().max(10).default(""),
  targetBasis: RevenueBasisSchema.default("gross"),
  expectationNotes: z.string().trim().max(2_000).default(""),
  constraints: z.string().trim().max(4_000).default(""),
})

export const ListingReviewDraftSchema = z
  .object({
    propertyCount: z.number().int().min(1).max(3),
    properties: z.array(ListingReviewPropertyDraftSchema).min(1).max(3),
  })
  .superRefine((value, context) => {
    if (value.properties.length !== value.propertyCount) {
      context.addIssue({
        code: "custom",
        message: "Property sections must match the selected property count",
        path: ["properties"],
      })
    }
  })

export const ListingReviewFinalSchema = ListingReviewDraftSchema.superRefine(
  (value, context) => {
    value.properties.forEach((property, index) => {
      const root = ["properties", index] as (string | number)[]
      if (!property.propertyName) {
        context.addIssue({
          code: "custom",
          message: "Property name is required",
          path: [...root, "propertyName"],
        })
      }
      if (!property.address) {
        context.addIssue({
          code: "custom",
          message: "Address is required",
          path: [...root, "address"],
        })
      }
      if (property.addressStatus === "not_sure") {
        context.addIssue({
          code: "custom",
          message: "Confirm whether this is the correct address",
          path: [...root, "addressStatus"],
        })
      }
      if (!MoneyStringSchema.safeParse(property.actualRevenue).success) {
        context.addIssue({
          code: "custom",
          message: "Valid actual revenue is required",
          path: [...root, "actualRevenue"],
        })
      }
      if (!MoneyStringSchema.safeParse(property.targetRevenue).success) {
        context.addIssue({
          code: "custom",
          message: "Valid target revenue is required",
          path: [...root, "targetRevenue"],
        })
      }
      property.listingUrls.forEach((listingUrl, urlIndex) => {
        try {
          const url = new URL(listingUrl)
          if (url.protocol !== "https:" && url.protocol !== "http:") {
            throw new Error("Unsupported URL protocol")
          }
        } catch {
          context.addIssue({
            code: "custom",
            message: "Listing links must be valid HTTP or HTTPS URLs",
            path: [...root, "listingUrls", urlIndex],
          })
        }
      })
      validatePeriod(
        property.actualPeriodKind,
        property.actualPeriodYear,
        property.actualPeriodStart,
        property.actualPeriodEnd,
        context,
        [...root, "actualPeriodKind"]
      )
      validatePeriod(
        property.targetPeriodKind,
        property.targetPeriodYear,
        property.targetPeriodStart,
        property.targetPeriodEnd,
        context,
        [...root, "targetPeriodKind"]
      )
    })
  }
)

function validatePeriod(
  kind: z.infer<typeof PeriodKindSchema>,
  year: string,
  start: string,
  end: string,
  context: z.RefinementCtx,
  path: (string | number)[]
) {
  if (kind === "calendar_year" && !/^20\d{2}$/.test(year)) {
    context.addIssue({
      code: "custom",
      message: "Enter the four-digit calendar year",
      path,
    })
  }
  if (
    kind === "custom" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      start > end)
  ) {
    context.addIssue({
      code: "custom",
      message: "Enter a valid custom start and end date",
      path,
    })
  }
}

export type ListingReviewDraft = z.infer<typeof ListingReviewDraftSchema>
export type ListingReviewPropertyDraft = z.infer<
  typeof ListingReviewPropertyDraftSchema
>

export function emptyListingReviewProperty(): ListingReviewPropertyDraft {
  return ListingReviewPropertyDraftSchema.parse({})
}

export function emptyListingReviewDraft(propertyCount = 1): ListingReviewDraft {
  const safeCount = Math.min(3, Math.max(1, Math.trunc(propertyCount)))
  return {
    propertyCount: safeCount,
    properties: Array.from({ length: safeCount }, emptyListingReviewProperty),
  }
}

export function normalizeListingReviewDraft(
  input: unknown
): ListingReviewDraft {
  const parsed = ListingReviewDraftSchema.safeParse(input)
  return parsed.success ? parsed.data : emptyListingReviewDraft()
}

export function validateListingReviewFile(
  file: Pick<File, "name" | "size" | "type">
): string | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? ""
  if (
    !LISTING_REVIEW_FILE_EXTENSIONS.includes(
      extension as (typeof LISTING_REVIEW_FILE_EXTENSIONS)[number]
    )
  ) {
    return "Upload a PDF, CSV, or XLSX file"
  }
  if (file.size <= 0 || file.size > LISTING_REVIEW_MAX_FILE_BYTES) {
    return "Each file must be larger than 0 bytes and no more than 20 MB"
  }
  if (
    file.type &&
    !LISTING_REVIEW_FILE_TYPES.includes(
      file.type as (typeof LISTING_REVIEW_FILE_TYPES)[number]
    )
  ) {
    return "The selected file type is not supported"
  }
  return null
}

export function listingReviewSharePath(token: string) {
  return `/listing-review/${token}`
}
