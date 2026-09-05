import { z } from "zod"

export const VERSION = "rf.onboarding.v1" as const
export const AddressSchema = z
  .object({
    street: z.string().trim().min(1).max(250),
    unit: z.string().trim().max(80).default(""),
    city: z.string().trim().min(1).max(120),
    region: z.string().trim().max(120),
    postalCode: z.string().trim().max(30),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase()),
  })
  .strict()

const MoneyPreferenceSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("specified"),
      value: z.number().finite().min(0).max(1000000),
    })
    .strict(),
  z.object({ mode: z.literal("guidance") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
])
const StayPreferenceSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("specified"),
      nights: z.number().int().min(1).max(365),
    })
    .strict(),
  z.object({ mode: z.literal("guidance") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
])
export const PreferencesSchema = z
  .object({
    goal: z.enum(["revenue", "occupancy", "balanced", "guidance"]),
    minimumNightly: MoneyPreferenceSchema,
    cleaningFee: MoneyPreferenceSchema.refine(
      (v) => v.mode !== "none",
      "Choose an amount or request guidance"
    ),
    minimumStay: StayPreferenceSchema,
    operatingConstraints: z.string().trim().max(2000).default(""),
  })
  .strict()
export const PropertySchema = z
  .object({
    id: z.uuid(),
    billingAccountId: z.uuid(),
    ghlRecordId: z.string().trim().min(1).max(160).nullable().default(null),
    name: z.string().trim().min(1).max(160),
    address: AddressSchema,
    listingUrl: z
      .url()
      .max(2000)
      .refine((v) => ["https:", "http:"].includes(new URL(v).protocol))
      .nullable()
      .default(null),
    status: z.enum(["live", "pre_launch"]).nullable().default(null),
    targetLaunchDate: z.iso.date().nullable().default(null),
    identityConfirmed: z.boolean().default(false),
    preferences: PreferencesSchema.nullable().default(null),
  })
  .strict()
export const SoftwareSchema = z
  .object({
    pmsName: z.string().trim().max(160).nullable(),
    pms: z.enum(["done", "need_help", "not_applicable"]),
    airbnb: z.enum(["done", "need_help"]),
    pricelabs: z.enum(["done", "need_help"]),
  })
  .strict()
  .refine(
    (v) => v.pms !== "done" || !!v.pmsName,
    "Name the PMS when confirming it is connected"
  )

export const BillingAccountSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().trim().min(2).max(255),
    ghlContactId: z.string().trim().min(1).max(160),
    propertyIds: z.array(z.uuid()).min(1).max(5),
    monthlyRateCents: z.union([z.literal(35000), z.literal(32000)]),
    onboardingFeeCents: z.union([z.literal(15000), z.literal(0)]),
    // Provider IDs are bound before verification; never infer the latest invoice.
    documentId: z.string().min(1).nullable().default(null),
    invoiceId: z.string().min(1).nullable().default(null),
    stripePaymentIntentId: z
      .string()
      .startsWith("pi_")
      .nullable()
      .default(null),
    verifiedAt: z.iso.datetime().nullable().default(null),
  })
  .strict()
export const JourneySchema = z
  .object({
    version: z.literal(VERSION),
    id: z.uuid(),
    contactId: z.string().trim().min(1).max(160),
    opportunityId: z.string().trim().min(1).max(160),
    appointmentId: z.string().trim().min(1).max(160),
    ownerId: z.string().trim().min(1).max(160),
    email: z.email().transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(160),
    billingMode: z.enum(["single", "assisted"]),
    stage: z.enum([
      "signup",
      "awaiting_payment",
      "onboarding",
      "submitted",
      "portal_invited",
      "portal_active",
      "exception",
    ]),
    properties: z.array(PropertySchema).min(1).max(5),
    accounts: z.array(BillingAccountSchema).min(1).max(5),
    software: SoftwareSchema.nullable().default(null),
    expectationsAcknowledged: z.boolean().default(false),
    manualTakeover: z.boolean().default(false),
    signedPropertySnapshot: z
      .array(
        z
          .object({
            id: z.uuid(),
            billingAccountId: z.uuid(),
            address: AddressSchema,
          })
          .strict()
      )
      .nullable()
      .default(null),
    submittedAt: z.iso.datetime().nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message })
    const propertyIds = v.properties.map((p) => p.id)
    const accountIds = v.accounts.map((a) => a.id)
    if (
      new Set(propertyIds).size !== propertyIds.length ||
      new Set(accountIds).size !== accountIds.length
    )
      issue("Duplicate property or account identity")
    if (v.billingMode === "single" && v.accounts.length !== 1)
      issue("Single billing requires one account")
    if (v.accounts.reduce((sum, a) => sum + a.onboardingFeeCents, 0) !== 15000)
      issue("Exactly one setup fee is required")
    const assigned = v.accounts.flatMap((a) => a.propertyIds)
    if (
      assigned.length !== propertyIds.length ||
      new Set(assigned).size !== assigned.length ||
      assigned.some((id) => !propertyIds.includes(id))
    )
      issue("Billing must cover each property exactly once")
    for (const p of v.properties)
      if (
        !v.accounts.some(
          (a) => a.id === p.billingAccountId && a.propertyIds.includes(p.id)
        )
      )
        issue("Property billing association mismatch")
    for (const field of [
      "documentId",
      "invoiceId",
      "stripePaymentIntentId",
    ] as const) {
      const ids = v.accounts.map((a) => a[field]).filter(Boolean)
      if (new Set(ids).size !== ids.length)
        issue(`Repeated ${field} across billing accounts`)
    }
  })
export type Journey = z.infer<typeof JourneySchema>
export type Property = z.infer<typeof PropertySchema>
export type BillingAccount = z.infer<typeof BillingAccountSchema>

export function propertySnapshot(journey: Journey) {
  return journey.properties.map(({ id, billingAccountId, address }) => ({
    id,
    billingAccountId,
    address: structuredClone(address),
  }))
}
export function assertSignedIdentityUnchanged(
  previous: Journey,
  next: Journey
) {
  if (!previous.signedPropertySnapshot) return
  const expected = new Map(
    previous.signedPropertySnapshot.map((p) => [p.id, p])
  )
  if (
    expected.size !== next.properties.length ||
    next.properties.some((p) => {
      const old = expected.get(p.id)
      return (
        !old ||
        old.billingAccountId !== p.billingAccountId ||
        JSON.stringify(old.address) !== JSON.stringify(p.address)
      )
    })
  )
    throw new Error("signed_property_correction_requires_review")
}
export function missingRequirements(journey: Journey): string[] {
  const missing: string[] = []
  for (const a of journey.accounts)
    if (
      !a.verifiedAt ||
      !a.documentId ||
      !a.invoiceId ||
      !a.stripePaymentIntentId
    )
      missing.push(`billing:${a.id}`)
  if (!journey.signedPropertySnapshot) missing.push("billing:signed_scope")
  else assertSignedIdentityUnchanged(journey, journey)
  for (const p of journey.properties) {
    if (!p.identityConfirmed) missing.push(`property:${p.id}:confirm`)
    if (!p.status) missing.push(`property:${p.id}:status`)
    if (p.status === "live" && !p.listingUrl)
      missing.push(`property:${p.id}:listing_url`)
    if (p.status === "pre_launch" && !p.targetLaunchDate)
      missing.push(`property:${p.id}:launch_date`)
    if (!p.preferences) missing.push(`property:${p.id}:preferences`)
  }
  if (!journey.software) missing.push("software")
  if (!journey.expectationsAcknowledged) missing.push("expectations")
  return missing
}
export function submitJourney(journey: Journey, now: string): Journey {
  if (journey.stage !== "onboarding" || journey.manualTakeover)
    throw new Error("journey_not_accepting_submission")
  if (missingRequirements(journey).length)
    throw new Error("onboarding_incomplete")
  return JourneySchema.parse({
    ...journey,
    stage: "submitted",
    submittedAt: now,
  })
}
export function applySharedPreferences(
  journey: Journey,
  propertyIds: string[],
  preferences: unknown
): Journey {
  const parsed = PreferencesSchema.parse(preferences)
  if (
    !propertyIds.length ||
    new Set(propertyIds).size !== propertyIds.length ||
    propertyIds.some((id) => !journey.properties.some((p) => p.id === id))
  )
    throw new Error("invalid_property_selection")
  return JourneySchema.parse({
    ...journey,
    properties: journey.properties.map((p) =>
      propertyIds.includes(p.id) ? { ...p, preferences: parsed } : p
    ),
  })
}

// Explicit projection: internal sales notes, billing references and provider truth
// never become native-form context. The signer/payment screens own pricing.
export function clientContext(journey: Journey) {
  return {
    version: journey.version,
    journeyId: journey.id,
    name: journey.name,
    email: journey.email,
    stage: journey.stage,
    properties: journey.properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      listingUrl: p.listingUrl,
      status: p.status,
      targetLaunchDate: p.targetLaunchDate,
      identityConfirmed: p.identityConfirmed,
      preferences: p.preferences,
    })),
    software: journey.software,
    expectationsAcknowledged: journey.expectationsAcknowledged,
    missing: missingRequirements(journey).filter(
      (s) => !s.startsWith("billing:")
    ),
  }
}
