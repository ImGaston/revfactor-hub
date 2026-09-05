import "server-only"
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { z } from "zod"
import { assertRolloutContact } from "./rollout"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  AddressSchema,
  JourneySchema,
  PreferencesSchema,
  PropertySchema,
  SoftwareSchema,
  VERSION,
  assertSignedIdentityUnchanged,
  clientContext,
  propertySnapshot,
  submitJourney,
  type Journey,
} from "./domain"
import {
  requiredEnv,
  verifyAccount,
  readJourneyIdentity,
} from "./providers.server"

const id = z.string().trim().min(1).max(160)
export const BeginSchema = z
  .object({
    action: z.literal("begin"),
    eventId: id,
    contactId: id,
    opportunityId: id,
    appointmentId: id,
    ownerId: id,
    email: z.email(),
    name: z.string().trim().min(1).max(160),
    legalName: z.string().trim().min(2).max(255),
    referralCode: z.string().trim().max(80).default(""),
    properties: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(160),
            address: AddressSchema,
            listingUrl: z.url().nullable().default(null),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict()
const base = {
  eventId: id,
  journeyId: z.uuid(),
  expectedRevision: z.number().int().min(1),
}
export const CommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("property"),
      ...base,
      propertyId: z.uuid(),
      patch: PropertySchema.omit({
        id: true,
        billingAccountId: true,
        ghlRecordId: true,
      }).partial(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preferences"),
      ...base,
      propertyIds: z.array(z.uuid()).min(1).max(5),
      preferences: PreferencesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("account"),
      ...base,
      software: SoftwareSchema,
      expectationsAcknowledged: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("assisted_billing"),
      ...base,
      accounts: z
        .array(
          z
            .object({
              legalName: z.string().trim().min(2).max(255),
              ghlContactId: id,
              propertyIds: z.array(z.uuid()).min(1).max(5),
              feeBearing: z.boolean(),
            })
            .strict()
        )
        .min(2)
        .max(5),
    })
    .strict(),
  z
    .object({
      action: z.literal("bind"),
      ...base,
      accountId: z.uuid(),
      documentId: id,
      invoiceId: id,
      stripePaymentIntentId: z.string().startsWith("pi_"),
    })
    .strict(),
  z
    .object({
      action: z.literal("verify_payment"),
      ...base,
      accountId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal("submit"), ...base }).strict(),
])
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex")
export function checkBearer(request: Request, envName: string) {
  const secret = process.env[envName]
  const supplied = request.headers.get("authorization")
  return (
    !!secret &&
    !!supplied &&
    timingSafeEqual(
      Buffer.from(hash(supplied)),
      Buffer.from(hash(`Bearer ${secret}`))
    )
  )
}
export async function loadJourney(journeyId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from("ghl_onboarding_journeys")
    .select(
      "id,payload,revision,submitted_snapshot,context_expires_at,assembly_client_id,assembly_company_id,hub_client_id,onboarding_run_id"
    )
    .eq("id", journeyId)
    .maybeSingle()
  if (error) throw new Error("journey_storage_unavailable")
  if (!data) throw new Error("journey_not_found")
  const payload = JourneySchema.parse(data.payload)
  assertRolloutContact(payload.contactId)
  return { ...data, payload }
}

export async function beginJourney(input: z.infer<typeof BeginSchema>) {
  assertRolloutContact(input.contactId)
  const db = createAdminClient()
  const runKey = `ghl-v1:${input.contactId}:${input.appointmentId}`
  const { data: existing, error: lookupError } = await db
    .from("ghl_onboarding_journeys")
    .select("id,revision,opportunity_id")
    .eq("run_key", runKey)
    .maybeSingle()
  if (lookupError) throw new Error("journey_storage_unavailable")
  if (existing) {
    if (existing.opportunity_id !== input.opportunityId)
      throw new Error("journey_identity_conflict")
    return {
      journeyId: existing.id,
      revision: existing.revision,
      replayed: true,
    }
  }
  const identity = await readJourneyIdentity(input)
  const approvedCodes = requiredEnv("GHL_V1_REFERRAL_CODES")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (
    input.referralCode &&
    !approvedCodes.includes(input.referralCode.toLowerCase())
  )
    throw new Error("referral_requires_review")
  const accountId = randomUUID()
  const properties = input.properties.map((p) =>
    PropertySchema.parse({
      ...p,
      id: randomUUID(),
      billingAccountId: accountId,
    })
  )
  const journey = JourneySchema.parse({
    version: VERSION,
    id: randomUUID(),
    contactId: input.contactId,
    opportunityId: input.opportunityId,
    appointmentId: input.appointmentId,
    ownerId: input.ownerId,
    email: identity.email,
    name: identity.name,
    billingMode: "single",
    stage: "signup",
    properties,
    accounts: [
      {
        id: accountId,
        legalName: input.legalName,
        ghlContactId: input.contactId,
        propertyIds: properties.map((p) => p.id),
        monthlyRateCents: input.referralCode ? 32000 : 35000,
        onboardingFeeCents: 15000,
      },
    ],
  })
  const token = randomBytes(32).toString("base64url")
  const { error } = await db.from("ghl_onboarding_journeys").insert({
    id: journey.id,
    run_key: runKey,
    contact_id: journey.contactId,
    opportunity_id: journey.opportunityId,
    appointment_id: journey.appointmentId,
    owner_id: journey.ownerId,
    team_profile_id: z.uuid().parse(requiredEnv("GHL_V1_TEAM_PROFILE_ID")),
    stage: journey.stage,
    payload: journey,
    context_token_hash: hash(token),
    context_expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
  })
  if (error?.code === "23505") {
    const { data: replay, error: replayError } = await db
      .from("ghl_onboarding_journeys")
      .select("id,revision,opportunity_id")
      .eq("run_key", runKey)
      .maybeSingle()
    if (replayError || !replay || replay.opportunity_id !== input.opportunityId)
      throw new Error("journey_identity_conflict")
    return { journeyId: replay.id, revision: replay.revision, replayed: true }
  }
  if (error) throw new Error("journey_create_failed")
  return {
    journeyId: journey.id,
    revision: 1,
    contextToken: token,
    accountId,
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
    replayed: false,
  }
}

export async function applyCommand(input: z.infer<typeof CommandSchema>) {
  const db = createAdminClient()
  const requestHash = hash(JSON.stringify(input))
  const { data: prior, error: priorError } = await db
    .from("ghl_onboarding_events")
    .select("request_hash,revision")
    .eq("journey_id", input.journeyId)
    .eq("event_key", input.eventId)
    .maybeSingle()
  if (priorError) throw new Error("event_storage_unavailable")
  if (prior) {
    if (prior.request_hash !== requestHash)
      throw new Error("event_payload_conflict")
    return { revision: prior.revision, replayed: true }
  }
  const row = await loadJourney(input.journeyId)
  if (row.revision !== input.expectedRevision)
    throw new Error("revision_conflict")
  if (row.submitted_snapshot || row.payload.manualTakeover)
    throw new Error("journey_locked")
  let next: Journey = structuredClone(row.payload)
  const correctingSignup =
    input.action === "property" &&
    next.stage === "signup" &&
    !next.accounts.some((a) => a.documentId) &&
    !next.signedPropertySnapshot
  if (
    ["property", "preferences", "account", "submit"].includes(input.action) &&
    next.stage !== "onboarding" &&
    !correctingSignup
  )
    throw new Error("payment_required")
  if (input.action === "property") {
    if (!next.properties.some((p) => p.id === input.propertyId))
      throw new Error("property_not_in_journey")
    next.properties = next.properties.map((p) =>
      p.id === input.propertyId
        ? PropertySchema.parse({ ...p, ...input.patch })
        : p
    )
    assertSignedIdentityUnchanged(row.payload, next)
  } else if (input.action === "preferences") {
    const { applySharedPreferences } = await import("./domain")
    next = applySharedPreferences(next, input.propertyIds, input.preferences)
  } else if (input.action === "account") {
    next.software = input.software
    next.expectationsAcknowledged = input.expectationsAcknowledged
  } else if (input.action === "assisted_billing") {
    if (next.stage !== "signup" || next.accounts.some((a) => a.documentId))
      throw new Error("commercial_binding_locked")
    const rate = next.accounts[0].monthlyRateCents
    next.billingMode = "assisted"
    next.accounts = input.accounts.map((a) => ({
      id: randomUUID(),
      legalName: a.legalName,
      ghlContactId: a.ghlContactId,
      propertyIds: a.propertyIds,
      monthlyRateCents: rate,
      onboardingFeeCents: a.feeBearing ? 15000 : 0,
      documentId: null,
      invoiceId: null,
      stripePaymentIntentId: null,
      verifiedAt: null,
    }))
    next.properties = next.properties.map((p) => ({
      ...p,
      billingAccountId:
        next.accounts.find((a) => a.propertyIds.includes(p.id))?.id ??
        p.billingAccountId,
    }))
  } else if (input.action === "bind") {
    if (!["signup", "awaiting_payment"].includes(next.stage))
      throw new Error("commercial_binding_locked")
    const account = next.accounts.find((a) => a.id === input.accountId)
    if (
      !account ||
      account.documentId ||
      account.invoiceId ||
      account.verifiedAt
    )
      throw new Error("commercial_binding_locked")
    Object.assign(account, {
      documentId: input.documentId,
      invoiceId: input.invoiceId,
      stripePaymentIntentId: input.stripePaymentIntentId,
    })
    next.signedPropertySnapshot = propertySnapshot(next)
    next.stage = "awaiting_payment"
  } else if (input.action === "verify_payment") {
    const account = next.accounts.find((a) => a.id === input.accountId)
    if (!account || next.stage !== "awaiting_payment")
      throw new Error("payment_verification_not_pending")
    await verifyAccount(account, next.properties)
    account.verifiedAt = new Date().toISOString()
    if (next.accounts.every((a) => a.verifiedAt)) {
      next.stage = "onboarding"
      next.ownerId = requiredEnv("GHL_V1_POSTPAY_OWNER_ID")
    }
  } else next = submitJourney(next, new Date().toISOString())
  next = JourneySchema.parse(next)
  const { data, error } = await db.rpc("save_ghl_onboarding_v1", {
    p_id: input.journeyId,
    p_revision: input.expectedRevision,
    p_event_key: input.eventId,
    p_request_hash: requestHash,
    p_event_type: input.action,
    p_payload: next,
  })
  if (error)
    throw new Error(
      error.message.includes("revision_conflict")
        ? "revision_conflict"
        : "journey_save_failed"
    )
  return data
}

export async function getClientContext(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid_context")
  const { data, error } = await createAdminClient()
    .from("ghl_onboarding_journeys")
    .select("payload,revision")
    .eq("context_token_hash", hash(token))
    .gt("context_expires_at", new Date().toISOString())
    .maybeSingle()
  if (error || !data) throw new Error("invalid_context")
  const journey = JourneySchema.parse(data.payload)
  assertRolloutContact(journey.contactId)
  return {
    ...clientContext(journey),
    revision: data.revision,
  }
}

// Capability authorizes only this journey's questionnaire, never commercial truth.
export async function saveClientCommand(token: string, value: unknown) {
  const context = await getClientContext(token)
  const input = CommandSchema.parse(value)
  if (!["property", "preferences", "account", "submit"].includes(input.action))
    throw new Error("action_not_allowed")
  if (input.journeyId !== context.journeyId)
    throw new Error("journey_not_allowed")
  return applyCommand(input)
}
