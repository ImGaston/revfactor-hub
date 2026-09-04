import { z } from "zod"

export const checkoutStates = [
  "policy_blocked",
  "eligible",
  "session_creating",
  "session_open",
  "session_expired",
  "checkout_completed_unverified",
  "provider_reconciling",
  "payment_verified",
  "payment_verified_scheduled",
  "ghl_sync_pending",
  "ghl_onboarding_unlocked",
  "service_billing_active",
  "service_billing_failed",
  "payment_failed",
  "identity_conflict",
  "provider_conflict",
  "manual_review",
  "superseded",
  "revoked",
  "cancelled",
] as const

export type CheckoutState = (typeof checkoutStates)[number]

export const entitlementPayloadSchema = z
  .object({
    iss: z.literal("revfactor-hub"),
    aud: z.literal("revfactor-server-checkout"),
    sub: z.string().uuid(),
    jti: z.string().min(16).max(200),
    iat: z.number().int().positive(),
    nbf: z.number().int().positive(),
    exp: z.number().int().positive(),
    environment: z.enum(["isolated_fixture", "test", "live"]),
    highLevel: z.object({
      locationId: z.string().min(1).max(100),
      contactId: z.string().min(1).max(100),
      opportunityId: z.string().min(1).max(100),
    }),
    onboardingGroup: z.object({
      id: z.string().uuid(),
      billingAccountId: z.string().uuid(),
      accountSequence: z.number().int().min(1).max(5),
      accountCount: z.number().int().min(1).max(5),
      totalListingCount: z.number().int().min(1).max(5),
      billingMode: z.enum(["single", "separate_per_listing"]),
    }),
    agreement: z.object({
      documentId: z.string().min(1).max(500),
      templateId: z.string().min(1).max(200),
      revision: z.number().int().positive(),
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      signedAt: z.string().datetime(),
    }),
    order: z.object({
      primaryQuantity: z.number().int().min(1).max(5),
      childQuantity: z.number().int().min(0).max(5),
      onboardingFeeCents: z.number().int().min(3000).max(15000),
      serviceStartMode: z.enum(["immediate", "scheduled"]),
      serviceStartDate: z.string().date().nullable(),
      currency: z.literal("usd"),
      priceBookVersion: z.string().min(1).max(50),
      stripeAccountId: z.string().min(3).max(100),
      taxPolicy: z.enum([
        "policy_blocked",
        "provisional_fixture_only",
        "configured_no_collection",
      ]),
    }),
  })
  .superRefine((value, context) => {
    if (
      (value.onboardingGroup.billingMode === "single" &&
        (value.onboardingGroup.accountCount !== 1 ||
          value.onboardingGroup.accountSequence !== 1 ||
          value.order.onboardingFeeCents !== 15000 ||
          value.order.primaryQuantity !==
            value.onboardingGroup.totalListingCount)) ||
      (value.onboardingGroup.billingMode === "separate_per_listing" &&
        (value.onboardingGroup.accountCount !==
          value.onboardingGroup.totalListingCount ||
          value.order.primaryQuantity !== 1 ||
          value.order.onboardingFeeCents *
            value.onboardingGroup.accountCount !==
            15000))
    ) {
      context.addIssue({
        code: "custom",
        path: ["onboardingGroup"],
        message:
          "Billing account allocation conflicts with the onboarding group",
      })
    }
    if (value.exp - value.iat > 15 * 60) {
      context.addIssue({
        code: "custom",
        path: ["exp"],
        message: "Entitlements may be valid for at most 15 minutes",
      })
    }
    if (value.nbf < value.iat || value.nbf > value.exp) {
      context.addIssue({
        code: "custom",
        path: ["nbf"],
        message: "nbf must be within the signed validity window",
      })
    }
    if (
      value.order.serviceStartMode === "scheduled" &&
      !value.order.serviceStartDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["order", "serviceStartDate"],
        message: "Scheduled service requires a service-start date",
      })
    }
    if (
      value.order.serviceStartMode === "immediate" &&
      value.order.serviceStartDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["order", "serviceStartDate"],
        message: "Immediate service cannot include a scheduled date",
      })
    }
  })

export type EntitlementPayload = z.infer<typeof entitlementPayloadSchema>

export type StoredEntitlement = {
  id: string
  jti: string
  status: "active" | "superseded" | "revoked"
  expiresAt: string
  environment: "isolated_fixture" | "test" | "live"
  stripeAccountId: string
  highLevelLocationId: string
  highLevelContactId: string
  highLevelOpportunityId: string
  onboardingGroupId: string
  billingAccountId: string
  accountSequence: number
  accountCount: number
  totalListingCount: number
  billingMode: "single" | "separate_per_listing"
  agreementDocumentId: string
  agreementTemplateId: string
  agreementRevision: number
  agreementContentSha256: string
  primaryQuantity: number
  childQuantity: number
  onboardingFeeCents: number
  serviceStartMode: "immediate" | "scheduled"
  serviceStartDate: string | null
  currency: "usd"
  priceBookVersion: string
  taxPolicy:
    | "policy_blocked"
    | "provisional_fixture_only"
    | "configured_no_collection"
}

export class CheckoutBoundaryError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "CheckoutBoundaryError"
  }
}
