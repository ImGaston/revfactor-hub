export const ONBOARDING_STUDY_RUN_ID = "study-initial-001"
export const ONBOARDING_STUDY_SKIPPED = "__skipped__"

export const ONBOARDING_STUDY_SECTIONS = [
  "property",
  "software",
  "preferences",
  "knowledge",
  "review",
] as const

export type OnboardingStudySection = (typeof ONBOARDING_STUDY_SECTIONS)[number]

export type OnboardingStudyQuestionId =
  | "property_name"
  | "listing_url"
  | "is_live"
  | "launch_month"
  | "launch_year"
  | "target_launch_month"
  | "target_launch_year"
  | "has_pms"
  | "pms_name"
  | "has_pricelabs"
  | "airbnb_access"
  | "pms_access"
  | "pricelabs_access"
  | "listing_access"
  | "revenue_target"
  | "minimum_nightly_price"
  | "cleaning_cost"
  | "min_stay_midweek"
  | "min_stay_weekend"
  | "has_event"
  | "event_name"
  | "event_month"
  | "event_recurrence"
  | "event_year"
  | "event_demand"
  | "has_comp"
  | "comp_url"
  | "pricing_priority"
  | "notes"

export type OnboardingStudyAnswers = Partial<
  Record<OnboardingStudyQuestionId, string>
>

export type OnboardingStudyOption = {
  label: string
  value: string
}

export type OnboardingStudyQuestion = {
  id: OnboardingStudyQuestionId
  section: OnboardingStudySection
  prompt: string
  explanation: string
  kind: "choice" | "text" | "textarea"
  options?: OnboardingStudyOption[]
  placeholder?: string
  optional?: boolean
  inputMode?: "text" | "url" | "numeric"
}

type OnboardingTaskStatus = "not-started" | "in-progress" | "submitted"

export type OnboardingStudyPayload = {
  runId: string
  listingCount: 1
  childListingCount: 0
  listings: Array<{
    id: 1
    name: string
    url: string
    isLive: "yes" | "no"
    launchMonth: string
    launchYear: string
    targetLaunchMonth: string
    targetLaunchYear: string
  }>
  childListings: []
  hasPms: "yes" | "no"
  pms: string
  hasPricelabs: "yes" | "no"
  tasks: Array<{
    id: "airbnb" | "pms" | "pricelabs" | "listing"
    clientStatus: OnboardingTaskStatus
  }>
  pricingPreferences: {
    "primary-1": {
      revenueTarget: string
      minimumNightlyPrice: string
      cleaningCost: string
      minStayMidweek: string
      minStayWeekend: string
    }
  }
  pricingEvents: Array<{
    name: string
    month: string
    year: string
    recurrence: "one-off" | "recurrent"
    demand: "meaningful" | "significant" | "huge" | "blackout"
    appliesTo: ["primary-1"]
  }>
  pricingComps: Array<{
    url: string
    appliesTo: ["primary-1"]
  }>
  readinessChecks: Record<string, boolean>
  knowledgeAnswers: {
    pricing_priority: string
  }
  knowledgeNotes: Record<string, string>
  notes: string
}

export type OnboardingListingUrlAnalysis =
  | {
      kind: "airbnb_hosting"
      originalUrl: string
      normalizedUrl: string
      listingId: string
    }
  | {
      kind: "airbnb_public"
      originalUrl: string
      normalizedUrl: string
      listingId: string
    }
  | {
      kind: "other_public"
      originalUrl: string
      normalizedUrl: string
      listingId: null
    }
  | {
      kind: "invalid"
      originalUrl: string
      normalizedUrl: null
      listingId: null
    }

export type OnboardingPmsNameAnalysis =
  | {
      kind: "known"
      originalName: string
      canonicalName: string
    }
  | {
      kind: "suggestion"
      originalName: string
      suggestedName: string
    }
  | {
      kind: "unknown"
      originalName: string
    }

const YES_NO: OnboardingStudyOption[] = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
]

const ACCESS_STATUSES: OnboardingStudyOption[] = [
  { label: "Access granted", value: "submitted" },
  { label: "In progress", value: "in-progress" },
  { label: "Not started", value: "not-started" },
]

const MONTH_OPTIONS: OnboardingStudyOption[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((month) => ({ label: month, value: month }))

function question(
  definition: OnboardingStudyQuestion
): OnboardingStudyQuestion {
  return definition
}

export function getOnboardingStudyQuestions(
  answers: OnboardingStudyAnswers
): OnboardingStudyQuestion[] {
  const questions: OnboardingStudyQuestion[] = [
    question({
      id: "property_name",
      section: "property",
      prompt: "What name should we use for the property?",
      explanation:
        "This identifies the primary listing throughout the onboarding run.",
      kind: "text",
      placeholder: "Example: Ashwood",
    }),
    question({
      id: "listing_url",
      section: "property",
      prompt: "What is the primary listing URL?",
      explanation:
        "A public Airbnb, Vrbo, or direct-booking link helps the team verify the correct listing. You can skip this if it is not live yet.",
      kind: "text",
      inputMode: "url",
      placeholder: "https://…",
      optional: true,
    }),
    question({
      id: "is_live",
      section: "property",
      prompt: "Is the listing currently live?",
      explanation:
        "The existing onboarding contract records either the original launch date or the planned launch date.",
      kind: "choice",
      options: YES_NO,
    }),
  ]

  if (answers.is_live === "yes") {
    questions.push(
      question({
        id: "launch_year",
        section: "property",
        prompt: "Which year did the listing launch?",
        explanation:
          "This helps distinguish a new listing from an established one.",
        kind: "text",
        inputMode: "numeric",
        placeholder: "2025",
      }),
      question({
        id: "launch_month",
        section: "property",
        prompt: "Which month did the listing launch?",
        explanation:
          "An approximate launch month is enough for the onboarding record.",
        kind: "choice",
        options: MONTH_OPTIONS,
      })
    )
  }

  if (answers.is_live === "no") {
    questions.push(
      question({
        id: "target_launch_year",
        section: "property",
        prompt: "Which year are you targeting for launch?",
        explanation: "The target year anchors the planned launch window.",
        kind: "text",
        inputMode: "numeric",
        placeholder: "2026",
      }),
      question({
        id: "target_launch_month",
        section: "property",
        prompt: "Which month are you targeting for launch?",
        explanation:
          "This gives the team a working launch window without treating it as a guarantee.",
        kind: "choice",
        options: MONTH_OPTIONS,
      })
    )
  }

  questions.push(
    question({
      id: "has_pms",
      section: "software",
      prompt: "Do you currently use a property management system (PMS)?",
      explanation:
        "We use this to decide whether there is an existing system to connect or a setup task to discuss.",
      kind: "choice",
      options: YES_NO,
    })
  )

  if (answers.has_pms === "yes") {
    questions.push(
      question({
        id: "pms_name",
        section: "software",
        prompt: "Which PMS do you use?",
        explanation:
          "Share only the software name—never paste a password, API key, or verification code here.",
        kind: "text",
        placeholder: "Example: Hospitable",
      })
    )
  }

  questions.push(
    question({
      id: "has_pricelabs",
      section: "software",
      prompt: "Do you already have a PriceLabs account for this listing?",
      explanation:
        "This determines whether the access step is a connection or a new setup. Do not share credentials in chat.",
      kind: "choice",
      options: YES_NO,
    }),
    question({
      id: "airbnb_access",
      section: "software",
      prompt: "What is the status of Airbnb access for the RevFactor team?",
      explanation:
        "Grant access through Airbnb's authorized team or co-host workflow. Never paste login credentials here.",
      kind: "choice",
      options: ACCESS_STATUSES,
    })
  )

  if (answers.has_pms === "yes") {
    questions.push(
      question({
        id: "pms_access",
        section: "software",
        prompt: "What is the status of PMS access for the RevFactor team?",
        explanation:
          "Use the PMS's user invitation or partner-access workflow. The chat records status only.",
        kind: "choice",
        options: ACCESS_STATUSES,
      })
    )
  }

  if (answers.has_pricelabs === "yes") {
    questions.push(
      question({
        id: "pricelabs_access",
        section: "software",
        prompt:
          "What is the status of PriceLabs access for the RevFactor team?",
        explanation:
          "Use PriceLabs team access or its approved sharing workflow. The chat never collects API keys.",
        kind: "choice",
        options: ACCESS_STATUSES,
      })
    )
  }

  questions.push(
    question({
      id: "listing_access",
      section: "software",
      prompt: "Are the listing details ready for team review?",
      explanation:
        "This is the existing listing-information task status, separate from account access.",
      kind: "choice",
      options: ACCESS_STATUSES,
    }),
    question({
      id: "revenue_target",
      section: "preferences",
      prompt: "What annual gross revenue target should we record?",
      explanation:
        "This is a planning target, not a promised result. Enter a whole-dollar amount or skip it.",
      kind: "text",
      inputMode: "numeric",
      placeholder: "95000",
      optional: true,
    }),
    question({
      id: "minimum_nightly_price",
      section: "preferences",
      prompt: "Is there a hard minimum nightly price?",
      explanation:
        "A hard floor can protect owner economics, but it can also leave nights unsold. Enter the amount or skip it.",
      kind: "text",
      inputMode: "numeric",
      placeholder: "125",
      optional: true,
    }),
    question({
      id: "cleaning_cost",
      section: "preferences",
      prompt: "What does one turnover cost?",
      explanation:
        "Turnover cost helps explain when short stays may be unattractive. Enter the amount or skip it.",
      kind: "text",
      inputMode: "numeric",
      placeholder: "175",
      optional: true,
    }),
    question({
      id: "min_stay_midweek",
      section: "preferences",
      prompt: "What minimum stay do you prefer midweek?",
      explanation:
        "The existing onboarding contract accepts one to seven nights. This is a starting preference, not a live PriceLabs change.",
      kind: "choice",
      options: [1, 2, 3, 4, 5, 6, 7].map((nights) => ({
        label: `${nights} ${nights === 1 ? "night" : "nights"}`,
        value: String(nights),
      })),
    }),
    question({
      id: "min_stay_weekend",
      section: "preferences",
      prompt: "What minimum stay do you prefer on weekends?",
      explanation:
        "This is captured separately because weekend demand and turnover economics often differ.",
      kind: "choice",
      options: [1, 2, 3, 4, 5, 6, 7].map((nights) => ({
        label: `${nights} ${nights === 1 ? "night" : "nights"}`,
        value: String(nights),
      })),
    }),
    question({
      id: "has_event",
      section: "preferences",
      prompt:
        "Is there a major local event the pricing team should know about?",
      explanation:
        "The existing onboarding contract can attach shared demand events to the listing. We will capture one in this study.",
      kind: "choice",
      options: YES_NO,
    })
  )

  if (answers.has_event === "yes") {
    questions.push(
      question({
        id: "event_name",
        section: "preferences",
        prompt: "What is the event called?",
        explanation: "Use the public event name rather than private notes.",
        kind: "text",
        placeholder: "Example: Annual music festival",
      }),
      question({
        id: "event_recurrence",
        section: "preferences",
        prompt: "Is it a one-off event or does it recur every year?",
        explanation: "Recurring events do not store a year; one-off events do.",
        kind: "choice",
        options: [
          { label: "One-off", value: "one-off" },
          { label: "Recurring", value: "recurrent" },
        ],
      })
    )

    if (answers.event_recurrence === "one-off") {
      questions.push(
        question({
          id: "event_year",
          section: "preferences",
          prompt: "Which year will it occur?",
          explanation: "A one-off event requires a specific year.",
          kind: "text",
          inputMode: "numeric",
          placeholder: "2026",
        })
      )
    }

    questions.push(
      question({
        id: "event_month",
        section: "preferences",
        prompt: "Which month does it affect?",
        explanation: "The onboarding record stores the event by month.",
        kind: "choice",
        options: MONTH_OPTIONS,
      }),
      question({
        id: "event_demand",
        section: "preferences",
        prompt: "How strong is the expected demand impact?",
        explanation:
          "This records the client's expectation for team review; it does not automatically change prices.",
        kind: "choice",
        options: [
          { label: "Meaningful", value: "meaningful" },
          { label: "Significant", value: "significant" },
          { label: "Huge", value: "huge" },
          { label: "Blackout / unavailable", value: "blackout" },
        ],
      })
    )
  }

  questions.push(
    question({
      id: "has_comp",
      section: "preferences",
      prompt: "Do you have a comparable listing you want the team to review?",
      explanation:
        "A client-suggested comp is a hypothesis for review, not an automatically approved benchmark.",
      kind: "choice",
      options: YES_NO,
    })
  )

  if (answers.has_comp === "yes") {
    questions.push(
      question({
        id: "comp_url",
        section: "preferences",
        prompt: "What is the comparable listing URL?",
        explanation:
          "The URL is attached to this listing for later human review.",
        kind: "text",
        inputMode: "url",
        placeholder: "https://…",
      })
    )
  }

  questions.push(
    question({
      id: "pricing_priority",
      section: "knowledge",
      prompt: "Which pricing priority best matches your goals?",
      explanation:
        "This helps the team understand the trade-off you prefer. It does not authorize live rate changes.",
      kind: "choice",
      options: [
        { label: "Maximize revenue", value: "maximize_revenue" },
        { label: "Maximize occupancy", value: "maximize_occupancy" },
        { label: "Balanced", value: "balanced" },
        { label: "Fewer stays / protect property", value: "protect_property" },
      ],
    }),
    question({
      id: "notes",
      section: "knowledge",
      prompt: "Anything else the onboarding team should know?",
      explanation:
        "Add operational context only. Do not include passwords, API keys, payment details, or verification codes.",
      kind: "textarea",
      placeholder: "Optional context for the onboarding team…",
      optional: true,
    })
  )

  return questions
}

export function applyOnboardingStudyAnswer(
  answers: OnboardingStudyAnswers,
  questionId: OnboardingStudyQuestionId,
  value: string
): OnboardingStudyAnswers {
  const next = { ...answers, [questionId]: value }

  if (questionId === "is_live") {
    delete next.launch_month
    delete next.launch_year
    delete next.target_launch_month
    delete next.target_launch_year
  }
  if (questionId === "has_pms") {
    delete next.pms_name
    delete next.pms_access
  }
  if (questionId === "has_pricelabs") {
    delete next.pricelabs_access
  }
  if (questionId === "has_event") {
    delete next.event_name
    delete next.event_month
    delete next.event_recurrence
    delete next.event_year
    delete next.event_demand
  }
  if (questionId === "event_recurrence") {
    delete next.event_year
  }
  if (questionId === "has_comp") {
    delete next.comp_url
  }

  return next
}

function cleanAnswer(
  answers: OnboardingStudyAnswers,
  key: OnboardingStudyQuestionId
): string {
  const value = answers[key]
  return value === ONBOARDING_STUDY_SKIPPED ? "" : (value?.trim() ?? "")
}

function taskStatus(
  answers: OnboardingStudyAnswers,
  key: "airbnb_access" | "pms_access" | "pricelabs_access" | "listing_access"
): OnboardingTaskStatus {
  const value = cleanAnswer(answers, key)
  if (value === "submitted" || value === "in-progress") return value
  return "not-started"
}

export function buildOnboardingStudyPayload(
  answers: OnboardingStudyAnswers
): OnboardingStudyPayload {
  const isLive = cleanAnswer(answers, "is_live") === "yes" ? "yes" : "no"
  const hasPms = cleanAnswer(answers, "has_pms") === "yes" ? "yes" : "no"
  const hasPricelabs =
    cleanAnswer(answers, "has_pricelabs") === "yes" ? "yes" : "no"

  const tasks: OnboardingStudyPayload["tasks"] = [
    { id: "airbnb", clientStatus: taskStatus(answers, "airbnb_access") },
    { id: "listing", clientStatus: taskStatus(answers, "listing_access") },
  ]

  if (hasPms === "yes") {
    tasks.splice(1, 0, {
      id: "pms",
      clientStatus: taskStatus(answers, "pms_access"),
    })
  }
  if (hasPricelabs === "yes") {
    tasks.splice(tasks.length - 1, 0, {
      id: "pricelabs",
      clientStatus: taskStatus(answers, "pricelabs_access"),
    })
  }

  const pricingEvents: OnboardingStudyPayload["pricingEvents"] = []
  if (cleanAnswer(answers, "has_event") === "yes") {
    const recurrence =
      cleanAnswer(answers, "event_recurrence") === "recurrent"
        ? "recurrent"
        : "one-off"
    const demand = cleanAnswer(answers, "event_demand")
    const allowedDemand = [
      "meaningful",
      "significant",
      "huge",
      "blackout",
    ].includes(demand)
      ? (demand as "meaningful" | "significant" | "huge" | "blackout")
      : "meaningful"

    pricingEvents.push({
      name: cleanAnswer(answers, "event_name"),
      month: cleanAnswer(answers, "event_month"),
      year: recurrence === "one-off" ? cleanAnswer(answers, "event_year") : "",
      recurrence,
      demand: allowedDemand,
      appliesTo: ["primary-1"],
    })
  }

  const pricingComps: OnboardingStudyPayload["pricingComps"] = []
  if (cleanAnswer(answers, "has_comp") === "yes") {
    pricingComps.push({
      url: cleanAnswer(answers, "comp_url"),
      appliesTo: ["primary-1"],
    })
  }

  const readinessChecks: Record<string, boolean> = {
    airbnb_access: taskStatus(answers, "airbnb_access") === "submitted",
    listing_details: taskStatus(answers, "listing_access") === "submitted",
  }
  if (hasPms === "yes") {
    readinessChecks.pms_access =
      taskStatus(answers, "pms_access") === "submitted"
  }
  if (hasPricelabs === "yes") {
    readinessChecks.pricelabs_access =
      taskStatus(answers, "pricelabs_access") === "submitted"
  }

  return {
    runId: ONBOARDING_STUDY_RUN_ID,
    listingCount: 1,
    childListingCount: 0,
    listings: [
      {
        id: 1,
        name: cleanAnswer(answers, "property_name"),
        url: cleanAnswer(answers, "listing_url"),
        isLive,
        launchMonth:
          isLive === "yes" ? cleanAnswer(answers, "launch_month") : "",
        launchYear: isLive === "yes" ? cleanAnswer(answers, "launch_year") : "",
        targetLaunchMonth:
          isLive === "no" ? cleanAnswer(answers, "target_launch_month") : "",
        targetLaunchYear:
          isLive === "no" ? cleanAnswer(answers, "target_launch_year") : "",
      },
    ],
    childListings: [],
    hasPms,
    pms: hasPms === "yes" ? cleanAnswer(answers, "pms_name") : "",
    hasPricelabs,
    tasks,
    pricingPreferences: {
      "primary-1": {
        revenueTarget: cleanAnswer(answers, "revenue_target"),
        minimumNightlyPrice: cleanAnswer(answers, "minimum_nightly_price"),
        cleaningCost: cleanAnswer(answers, "cleaning_cost"),
        minStayMidweek: cleanAnswer(answers, "min_stay_midweek"),
        minStayWeekend: cleanAnswer(answers, "min_stay_weekend"),
      },
    },
    pricingEvents,
    pricingComps,
    readinessChecks,
    knowledgeAnswers: {
      pricing_priority: cleanAnswer(answers, "pricing_priority"),
    },
    knowledgeNotes: {},
    notes: cleanAnswer(answers, "notes"),
  }
}

function looksLikeCredential(value: string): boolean {
  return (
    /(?:password|passcode|api[-_ ]?key|client[-_ ]?secret|recovery code|verification code|2fa)\s*[:=]\s*\S+/i.test(
      value
    ) ||
    /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/.test(value) ||
    /\brvf_live_[a-f0-9]{32,}\b/i.test(value)
  )
}

function parseHttpUrl(value: string): URL | null {
  const trimmed = value.trim()
  const candidate = /^(?:www\.)?(?:[a-z0-9-]+\.)?airbnb\.com\//i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed

  try {
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function validHttpUrl(value: string): boolean {
  return parseHttpUrl(value) !== null
}

export function analyzeOnboardingListingUrl(
  rawValue: string
): OnboardingListingUrlAnalysis {
  const originalUrl = rawValue.trim()
  const url = parseHttpUrl(originalUrl)
  if (!url) {
    return {
      kind: "invalid",
      originalUrl,
      normalizedUrl: null,
      listingId: null,
    }
  }

  const hostname = url.hostname.toLowerCase()
  const isAirbnb = hostname === "airbnb.com" || hostname.endsWith(".airbnb.com")
  if (!isAirbnb) {
    return {
      kind: "other_public",
      originalUrl,
      normalizedUrl: url.toString(),
      listingId: null,
    }
  }

  const publicMatch = url.pathname.match(/^\/rooms\/(\d+)(?:\/|$)/)
  if (publicMatch) {
    const listingId = publicMatch[1]
    return {
      kind: "airbnb_public",
      originalUrl,
      normalizedUrl: `https://www.airbnb.com/rooms/${listingId}`,
      listingId,
    }
  }

  const hostingMatch = url.pathname.match(
    /^\/hosting\/listings\/(?:editor\/)?(\d+)(?:\/|$)/
  )
  if (hostingMatch) {
    const listingId = hostingMatch[1]
    return {
      kind: "airbnb_hosting",
      originalUrl,
      normalizedUrl: `https://www.airbnb.com/rooms/${listingId}`,
      listingId,
    }
  }

  return {
    kind: "other_public",
    originalUrl,
    normalizedUrl: url.toString(),
    listingId: null,
  }
}

const KNOWN_PMS_NAMES = [
  "Avantio",
  "Beds24",
  "Escapia",
  "Guesty",
  "Hospitable",
  "Hostaway",
  "Hostfully",
  "Hostify",
  "iGMS",
  "Lodgify",
  "Lodgix",
  "OwnerRez",
  "Smoobu",
  "Streamline",
  "Tokeet",
  "Track",
  "Uplisting",
] as const

function comparablePmsName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function transpositionAwareDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  )

  for (let index = 0; index <= left.length; index += 1) rows[index][0] = index
  for (let index = 0; index <= right.length; index += 1) rows[0][index] = index

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      rows[leftIndex][rightIndex] = Math.min(
        rows[leftIndex - 1][rightIndex] + 1,
        rows[leftIndex][rightIndex - 1] + 1,
        rows[leftIndex - 1][rightIndex - 1] + substitutionCost
      )

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        rows[leftIndex][rightIndex] = Math.min(
          rows[leftIndex][rightIndex],
          rows[leftIndex - 2][rightIndex - 2] + 1
        )
      }
    }
  }

  return rows[left.length][right.length]
}

export function analyzeOnboardingPmsName(
  rawValue: string
): OnboardingPmsNameAnalysis {
  const originalName = rawValue.trim()
  const comparableName = comparablePmsName(originalName)
  const exact = KNOWN_PMS_NAMES.find(
    (name) => comparablePmsName(name) === comparableName
  )

  if (exact) {
    return { kind: "known", originalName, canonicalName: exact }
  }

  const ranked = KNOWN_PMS_NAMES.map((name) => ({
    name,
    distance: transpositionAwareDistance(
      comparableName,
      comparablePmsName(name)
    ),
  })).sort((left, right) => left.distance - right.distance)
  const [best, secondBest] = ranked
  const maximumDistance = comparableName.length >= 7 ? 2 : 1

  if (
    best &&
    best.distance <= maximumDistance &&
    (!secondBest || secondBest.distance > best.distance)
  ) {
    return {
      kind: "suggestion",
      originalName,
      suggestedName: best.name,
    }
  }

  return { kind: "unknown", originalName }
}

export function suggestPropertyNameCorrection(
  rawValue: string,
  currentPropertyName: string | undefined,
  activeQuestionId: OnboardingStudyQuestionId
): string | null {
  const value = rawValue.trim()
  if (!currentPropertyName || !value || value.length > 120) return null

  const explicitCorrection = value.match(
    /^(?:(?:actually|correction)[:,]?\s*)?(?:change|update)?\s*(?:the\s+)?(?:property\s+)?name\s*(?:is|to|:|=)\s*(.+)$/i
  )
  if (explicitCorrection?.[1]?.trim()) return explicitCorrection[1].trim()

  if (
    activeQuestionId === "listing_url" &&
    analyzeOnboardingListingUrl(value).kind === "invalid"
  ) {
    return value
  }

  return null
}

export function validateOnboardingStudyAnswer(
  questionDefinition: OnboardingStudyQuestion,
  rawValue: string
): string | null {
  if (rawValue === ONBOARDING_STUDY_SKIPPED) {
    return questionDefinition.optional ? null : "Please answer this question."
  }

  const value = rawValue.trim()
  if (!value) {
    return questionDefinition.optional ? null : "Please answer this question."
  }

  if (looksLikeCredential(value)) {
    return "Do not paste passwords, API keys, verification codes, or recovery codes. Use the provider's authorized access workflow instead."
  }

  if (questionDefinition.inputMode === "url" && !validHttpUrl(value)) {
    return "Enter a complete http:// or https:// URL."
  }

  if (questionDefinition.inputMode === "numeric") {
    const number = Number(value.replace(/[$,]/g, ""))
    if (!Number.isFinite(number) || number < 0) {
      return "Enter a valid non-negative number."
    }

    if (
      ["launch_year", "target_launch_year", "event_year"].includes(
        questionDefinition.id
      ) &&
      (!Number.isInteger(number) || number < 2000 || number > 2100)
    ) {
      return "Enter a year from 2000 through 2100."
    }
  }

  return null
}

export function onboardingStudyAnswerLabel(
  questionDefinition: OnboardingStudyQuestion,
  value: string
): string {
  if (value === ONBOARDING_STUDY_SKIPPED) return "Skipped"
  return (
    questionDefinition.options?.find((option) => option.value === value)
      ?.label ?? value
  )
}

export function buildOnboardingStudyTranscript(
  answers: OnboardingStudyAnswers
): string {
  const lines = [
    "RevFactor onboarding study transcript",
    "",
    "Guide: Welcome to RevFactor onboarding. This study records the existing onboarding contract and does not collect credentials.",
  ]

  for (const questionDefinition of getOnboardingStudyQuestions(answers)) {
    const answer = answers[questionDefinition.id]
    if (answer === undefined) continue
    lines.push(
      "",
      `Guide: ${questionDefinition.prompt}`,
      `Client: ${onboardingStudyAnswerLabel(questionDefinition, answer)}`
    )
  }

  lines.push(
    "",
    "Guide: The onboarding draft is ready for review. No external submission occurred."
  )
  return lines.join("\n")
}
