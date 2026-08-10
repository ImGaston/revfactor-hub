import { z } from "zod"

const requiredText = (label: string, max: number) =>
  z.string().trim().min(2, `${label} is required`).max(max)

const requiredValue = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max)

const conciseText = (label: string, max: number) =>
  z.string().trim().min(10, `${label} needs a little more detail`).max(max)

export const DemandDriverSchema = z.object({
  name: requiredText("Demand driver", 80),
  distance: requiredText("Distance", 30),
  why: conciseText("Demand rationale", 180),
})

export const RevenueLeverSchema = z.object({
  name: requiredText("Revenue lever", 80),
  review: conciseText("Review approach", 220),
  benefit: conciseText("Owner benefit", 180),
})

export const FirstMonthStepSchema = z.object({
  label: requiredText("Step label", 40),
  focus: conciseText("Step focus", 220),
})

export const BenchmarkSchema = z.object({
  profile: requiredText("Comparable profile", 120),
  managedMonths: requiredText("Managed months", 16),
  managedRevenue: requiredText("Managed revenue", 24),
  marketRevenue: requiredText("Market revenue", 24),
  lift: requiredText("Lift", 24),
  monthlyLift: requiredText("Monthly lift", 24),
})

export const ProjectionScenarioSchema = z.object({
  revenue: z.number().nonnegative(),
  adr: z.number().nonnegative(),
  occupancy: z.number().min(0).max(1),
})

export const NewPropertyProjectionSchema = z.object({
  provider: z.literal("AirROI"),
  retrievedAt: z.iso.datetime(),
  currency: requiredText("Projection currency", 8),
  radiusMiles: z.number().min(1).max(10),
  comparableCount: z.number().int().nonnegative(),
  conservative: ProjectionScenarioSchema,
  base: ProjectionScenarioSchema,
  strong: ProjectionScenarioSchema,
  monthlyRevenueShares: z.array(z.number().min(0).max(1)).length(12),
  comparables: z
    .array(
      z.object({
        listingId: requiredValue("Comparable listing ID", 32),
        name: requiredText("Comparable name", 160),
        location: requiredText("Comparable location", 120),
        bedrooms: z.number().nonnegative().nullable(),
        revenue: z.number().nonnegative().nullable(),
        adr: z.number().nonnegative().nullable(),
        occupancy: z.number().min(0).max(1).nullable(),
      })
    )
    .max(5),
})

export const RevenueBriefSchema = z
  .object({
    brandProfileId: z.union([z.literal(""), z.uuid()]).default(""),
    preparedFor: requiredText("Prepared for", 100),
    propertyName: requiredText("Property name", 120),
    propertyAddress: requiredText("Property address", 180),
    locationLabel: requiredText("Location", 100),
    listingUrl: z.union([z.literal(""), z.url().max(500)]),
    listingStage: z.enum(["existing", "new"]),
    photoDataUrl: z
      .string()
      .max(2_800_000, "Cover image must be smaller than 2 MB")
      .refine(
        (value) =>
          value === "" || /^data:image\/(jpeg|png);base64,/.test(value),
        "Cover image must be a JPG or PNG"
      ),
    metrics: z.object({
      rating: requiredValue("Rating", 16),
      reviews: requiredValue("Review count", 16),
      layout: requiredText("Layout", 32),
      guests: requiredValue("Guest capacity", 16),
    }),
    listingDetails: conciseText("Listing details", 240),
    hostSignals: conciseText("Host signals", 240),
    currentPositioning: conciseText("Current positioning", 360),
    strengths: conciseText("Strengths", 420),
    visibleConstraints: conciseText("Visible constraints", 320),
    executiveSummary: conciseText("Executive summary", 520),
    bottomLine: conciseText("Revenue opportunity", 420),
    ownerTakeaway: conciseText("Owner takeaway", 520),
    demandDrivers: z.array(DemandDriverSchema).min(1).max(6),
    distanceNote: conciseText("Distance note", 240),
    revenueLevers: z.array(RevenueLeverSchema).min(1).max(5),
    firstMonth: z.array(FirstMonthStepSchema).min(1).max(4),
    benchmarks: z.array(BenchmarkSchema).min(1).max(5),
    benchmarkSummary: conciseText("Benchmark summary", 420),
    finalDataRequest: conciseText("Final data request", 420),
    projection: NewPropertyProjectionSchema.nullable().default(null),
  })
  .superRefine((brief, context) => {
    if (brief.listingStage === "new" && !brief.projection) {
      context.addIssue({
        code: "custom",
        path: ["projection"],
        message:
          "Build the AirROI pre-launch projection before generating the PDF",
      })
    }
  })

export type RevenueBriefInput = z.infer<typeof RevenueBriefSchema>

const STANDARD_REVENUE_LEVERS: RevenueBriefInput["revenueLevers"] = [
  {
    name: "Peak-event protection",
    review:
      "University dates, graduations, sports, concerts, and local compression windows.",
    benefit: "Avoid selling scarce high-demand dates too cheaply.",
  },
  {
    name: "Length-of-stay rules",
    review:
      "Weekend and event minimums, midweek flexibility, and orphan-gap logic.",
    benefit:
      "Improve revenue per booking and reduce inefficient calendar holes.",
  },
  {
    name: "Far-out pricing",
    review: "Advance-purchase anchors for dates six to twelve months ahead.",
    benefit: "Protect future peak nights before demand fully materializes.",
  },
  {
    name: "Gap-fill strategy",
    review: "Targeted incentives for weak gaps instead of blanket discounting.",
    benefit: "Fill softer dates without weakening premium weekends.",
  },
  {
    name: "Market pacing",
    review: "Forward occupancy, ADR, booking pace, and market occupancy trend.",
    benefit: "Know when to hold price and when to stimulate demand.",
  },
]

const STANDARD_FIRST_MONTH: RevenueBriefInput["firstMonth"] = [
  {
    label: "Week 1",
    focus:
      "Audit the current calendar, rates, stay rules, discounts, and future pacing.",
  },
  {
    label: "Week 2",
    focus:
      "Build the local event and demand calendar and protect compression windows.",
  },
  {
    label: "Week 3",
    focus:
      "Tune weekday and weekend strategy, orphan gaps, and far-out anchors.",
  },
  {
    label: "Week 4",
    focus: "Review booking movement and adjust the hold-versus-fill strategy.",
  },
]

const STANDARD_BENCHMARKS: RevenueBriefInput["benchmarks"] = [
  {
    profile: "4BR urban / group home near downtown events",
    managedMonths: "12",
    managedRevenue: "~$82k",
    marketRevenue: "~$31k",
    lift: "~+$51k",
    monthlyLift: "~+$4.3k/mo",
  },
  {
    profile: "4BR university / event-style group home",
    managedMonths: "10",
    managedRevenue: "~$84k",
    marketRevenue: "~$43k",
    lift: "~+$41k",
    monthlyLift: "~+$4.1k/mo",
  },
  {
    profile: "4BR urban / family group home",
    managedMonths: "11",
    managedRevenue: "~$71k",
    marketRevenue: "~$37k",
    lift: "~+$34k",
    monthlyLift: "~+$3.1k/mo",
  },
  {
    profile: "4BR suburban family / group home",
    managedMonths: "12",
    managedRevenue: "~$54k",
    marketRevenue: "~$40k",
    lift: "~+$14k",
    monthlyLift: "~+$1.1k/mo",
  },
]

export function createBlankRevenueBrief(): RevenueBriefInput {
  return {
    brandProfileId: "",
    preparedFor: "",
    propertyName: "",
    propertyAddress: "",
    locationLabel: "",
    listingUrl: "",
    listingStage: "existing",
    photoDataUrl: "",
    metrics: {
      rating: "",
      reviews: "",
      layout: "",
      guests: "",
    },
    listingDetails: "Entire home · bedrooms · beds · baths",
    hostSignals:
      "Summarize rating, reviews, hosting tenure, and visible trust signals.",
    currentPositioning:
      "Describe the guest segments and occasions the listing currently serves.",
    strengths:
      "Summarize the strongest conversion, amenity, location, and capacity advantages.",
    visibleConstraints:
      "Note only verified operational or listing constraints that affect positioning.",
    executiveSummary:
      "This listing is already a strong product. The opportunity is to make the pricing calendar more precise across its most important demand windows.",
    bottomLine:
      "The clearest revenue opportunity is to protect high-value dates and booking windows while using targeted pricing and stay controls to convert softer demand.",
    ownerTakeaway:
      "RevFactor's role is to make the calendar more strategic: protect high-demand dates, avoid underpricing far-out stays, and fill softer gaps without weakening premium nights.",
    demandDrivers: [{ name: "", distance: "", why: "" }],
    distanceNote:
      "Distances are public estimates and should be verified with drive times before final underwriting.",
    revenueLevers: STANDARD_REVENUE_LEVERS.map((item) => ({ ...item })),
    firstMonth: STANDARD_FIRST_MONTH.map((item) => ({ ...item })),
    benchmarks: STANDARD_BENCHMARKS.map((item) => ({ ...item })),
    benchmarkSummary:
      "Comparable RevFactor-managed homes created a measurable revenue premium versus their markets during the managed months analyzed. This supports a fit assessment, not a guaranteed property-level projection.",
    finalDataRequest:
      "A final recommendation requires the last 12 months of revenue, ADR, occupancy, booking lead time, current pricing calendar, stay rules, and the owner's goals and operating constraints.",
    projection: null,
  }
}

export const SYNTHETIC_REVENUE_BRIEF: RevenueBriefInput = {
  ...createBlankRevenueBrief(),
  preparedFor: "Taylor / Harbor House",
  propertyName: "Harbor House",
  propertyAddress: "18 Seaport Lane, Newport, RI 02840",
  locationLabel: "Newport, Rhode Island",
  listingUrl: "https://www.airbnb.com/rooms/123456789",
  metrics: {
    rating: "4.96",
    reviews: "41",
    layout: "4BR / 3BA",
    guests: "10",
  },
  listingDetails: "Entire home · 10 guests · 4 bedrooms · 6 beds · 3 baths",
  hostSignals:
    "Superhost · 5 years hosting · 4.96 rating · 41 reviews · guest-favorite badge",
  currentPositioning:
    "Families and groups visiting Newport for sailing, weddings, university weekends, and regional leisure travel.",
  strengths:
    "Strong reviews, group capacity, walkable dining, off-street parking, workspace, updated kitchen, and outdoor gathering space.",
  visibleConstraints:
    "No parties, exterior cameras, seasonal outdoor amenities, and a two-car parking limit.",
  executiveSummary:
    "Harbor House is already a high-converting group property. The clearest opportunity is more precise calendar control across sailing events, university weekends, weddings, and peak summer leisure demand.",
  bottomLine:
    "Harbor House's clearest revenue opportunity is stronger calendar control across peak summer, sailing events, weddings, and university weekends. The goal is to protect premium dates while filling softer gaps deliberately.",
  ownerTakeaway:
    "You already have a well-reviewed home that converts. RevFactor's role is to make the calendar more strategic: protect high-demand dates, avoid underpricing far-out stays, and fill softer gaps without weakening premium weekends.",
  demandDrivers: [
    {
      name: "Newport Harbor",
      distance: "~0.8 mi",
      why: "Sailing events, waterfront leisure demand, and peak-summer compression.",
    },
    {
      name: "Thames Street",
      distance: "~1.1 mi",
      why: "Walkable dining, nightlife, shopping, and year-round leisure demand.",
    },
    {
      name: "Salve Regina University",
      distance: "~2.4 mi",
      why: "Family weekends, move-in, graduation, and university events.",
    },
    {
      name: "Newport Mansions",
      distance: "~2.8 mi",
      why: "Tourism, weddings, and group travel demand across shoulder seasons.",
    },
  ],
}

export function revenueBriefFilename(input: RevenueBriefInput): string {
  const slug = input.propertyName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
  return `RevFactor-${slug || "Property"}-Revenue-Brief.pdf`
}
