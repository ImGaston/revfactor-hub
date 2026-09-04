import { createHash, createPrivateKey, createPublicKey } from "node:crypto"
import Stripe from "stripe"
import { z } from "zod"

import { prepareServerCheckout } from "@/lib/server-checkout/checkout-service.server"
import {
  CheckoutBoundaryError,
  type EntitlementPayload,
} from "@/lib/server-checkout/contracts"
import {
  canonicalAgreementContentSha256,
  signEntitlementToken,
} from "@/lib/server-checkout/entitlement-issuer.server"
import { DbCheckoutAttemptRepository } from "@/lib/server-checkout/repository.server"
import {
  loadServerPriceBooks,
  REFERRAL_PRICE_BOOK_VERSION,
  STANDARD_PRICE_BOOK_VERSION,
} from "@/lib/server-checkout/server-price-books.server"
import {
  StripeCheckoutAdapter,
  stripePriceInspector,
} from "@/lib/server-checkout/stripe-provider.server"
import { createAdminClient } from "@/lib/supabase/admin"

const billingAccountSchema = z.object({
  sequence: z.number().int().min(1).max(5),
  legalBusinessName: z.string().trim().min(2).max(255),
  listingQuantity: z.number().int().min(1).max(5),
  monthlyRateCents: z.union([z.literal(32000), z.literal(35000)]),
  monthlyAmountCents: z.number().int().positive(),
  onboardingFeeCents: z.union([
    z.literal(3000),
    z.literal(3750),
    z.literal(5000),
    z.literal(7500),
    z.literal(15000),
  ]),
  initialCheckoutTotalCents: z.number().int().positive(),
})

export const prepareOnboardingAccountSchema = z
  .object({
    groupFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    billingMode: z.enum(["single", "separate_per_listing"]),
    contactName: z.string().trim().min(2).max(255),
    email: z.email().transform((value) => value.trim().toLowerCase()),
    totalListingCount: z.number().int().min(1).max(5),
    pricingProgram: z.enum(["Regular", "Referral"]),
    contactId: z.string().min(1).max(100),
    opportunityId: z.string().min(1).max(100),
    documentId: z.string().min(1).max(500),
    documentRevision: z.number().int().positive(),
    signedAt: z.string().datetime(),
    account: billingAccountSchema,
  })
  .superRefine((value, context) => {
    const accountCount =
      value.billingMode === "single" ? 1 : value.totalListingCount
    const expectedFee = 15000 / accountCount
    const expectedRate = value.pricingProgram === "Referral" ? 32000 : 35000
    const invalid =
      value.account.sequence > accountCount ||
      value.account.monthlyRateCents !== expectedRate ||
      value.account.monthlyAmountCents !==
        value.account.monthlyRateCents * value.account.listingQuantity ||
      value.account.initialCheckoutTotalCents !==
        value.account.monthlyAmountCents + value.account.onboardingFeeCents ||
      value.account.onboardingFeeCents !== expectedFee ||
      (value.billingMode === "single" &&
        value.account.listingQuantity !== value.totalListingCount) ||
      (value.billingMode === "separate_per_listing" &&
        value.account.listingQuantity !== 1)
    if (invalid) {
      context.addIssue({
        code: "custom",
        path: ["account"],
        message: "Account terms conflict with the approved group allocation",
      })
    }
  })

export type PrepareOnboardingAccountInput = z.infer<
  typeof prepareOnboardingAccountSchema
>

type RpcDatabase = ConstructorParameters<
  typeof DbCheckoutAttemptRepository
>[0] & {
  rpc(
    name: string,
    parameters: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new CheckoutBoundaryError(
      "checkout_configuration_invalid",
      `${name} is not configured`
    )
  }
  return value
}

function environmentConfig(pricingProgram: "Regular" | "Referral") {
  const mode = requiredEnvironment("RF_CHECKOUT_STRIPE_MODE")
  if (mode !== "test" && mode !== "live") {
    throw new CheckoutBoundaryError(
      "checkout_configuration_invalid",
      "RF_CHECKOUT_STRIPE_MODE must be test or live"
    )
  }
  return {
    environment: mode,
    stripeAccountId: requiredEnvironment("RF_CHECKOUT_STRIPE_ACCOUNT_ID"),
    locationId: requiredEnvironment("RF_CHECKOUT_GHL_LOCATION_ID"),
    templateId: requiredEnvironment(
      pricingProgram === "Referral"
        ? "RF_CHECKOUT_GHL_REFERRAL_TEMPLATE_ID"
        : "RF_CHECKOUT_GHL_STANDARD_TEMPLATE_ID"
    ),
    priceBookVersion:
      pricingProgram === "Referral"
        ? REFERRAL_PRICE_BOOK_VERSION
        : STANDARD_PRICE_BOOK_VERSION,
    privateKeyPem: requiredEnvironment("RF_CHECKOUT_ENTITLEMENT_PRIVATE_KEY"),
    keyId: requiredEnvironment("RF_CHECKOUT_ENTITLEMENT_KID"),
    continuationUrl: requiredEnvironment("RF_CHECKOUT_CONTINUATION_URL"),
    stripeSecretKey: requiredEnvironment("RF_CHECKOUT_STRIPE_SECRET_KEY"),
  } as const
}

function stableJti(input: {
  groupFingerprint: string
  sequence: number
  documentId: string
  revision: number
}) {
  return `rfe_${createHash("sha256")
    .update(
      `${input.groupFingerprint}:${input.sequence}:${input.documentId}:${input.revision}`
    )
    .digest("hex")}`
}

export async function prepareOnboardingAccountCheckout(unsafeInput: unknown) {
  if (process.env.RF_CHECKOUT_ENABLED !== "true") {
    throw new CheckoutBoundaryError(
      "checkout_disabled",
      "Server-created onboarding checkout is disabled"
    )
  }
  const input = prepareOnboardingAccountSchema.parse(unsafeInput)
  const config = environmentConfig(input.pricingProgram)
  const contentSha256 = canonicalAgreementContentSha256({
    documentId: input.documentId,
    templateId: config.templateId,
    documentRevision: input.documentRevision,
    opportunityId: input.opportunityId,
    legalBusinessName: input.account.legalBusinessName,
    listingQuantity: input.account.listingQuantity,
    pricingProgram: input.pricingProgram,
    monthlyRateCents: input.account.monthlyRateCents,
    monthlyAmountCents: input.account.monthlyAmountCents,
    onboardingFeeCents: input.account.onboardingFeeCents,
    initialCheckoutTotalCents: input.account.initialCheckoutTotalCents,
  })
  const jti = stableJti({
    groupFingerprint: input.groupFingerprint,
    sequence: input.account.sequence,
    documentId: input.documentId,
    revision: input.documentRevision,
  })
  const database = createAdminClient() as unknown as RpcDatabase
  const issued = await database.rpc("issue_onboarding_account_entitlement", {
    p_group_fingerprint: input.groupFingerprint,
    p_highlevel_location_id: config.locationId,
    p_highlevel_contact_id: input.contactId,
    p_signer_name: input.contactName,
    p_signer_email: input.email,
    p_billing_mode: input.billingMode,
    p_total_listing_count: input.totalListingCount,
    p_pricing_program: input.pricingProgram,
    p_account_sequence: input.account.sequence,
    p_legal_business_name: input.account.legalBusinessName,
    p_highlevel_opportunity_id: input.opportunityId,
    p_listing_quantity: input.account.listingQuantity,
    p_monthly_rate_cents: input.account.monthlyRateCents,
    p_monthly_amount_cents: input.account.monthlyAmountCents,
    p_onboarding_fee_cents: input.account.onboardingFeeCents,
    p_initial_checkout_total_cents: input.account.initialCheckoutTotalCents,
    p_agreement_document_id: input.documentId,
    p_agreement_template_id: config.templateId,
    p_agreement_revision: input.documentRevision,
    p_agreement_content_sha256: contentSha256,
    p_signed_at: input.signedAt,
    p_entitlement_jti: jti,
    p_environment: config.environment,
    p_stripe_account_id: config.stripeAccountId,
    p_price_book_version: config.priceBookVersion,
  })
  if (issued.error) throw new Error(issued.error.message)
  const row = issued.data as {
    groupId?: unknown
    billingAccountId?: unknown
    entitlementId?: unknown
    jti?: unknown
  } | null
  if (
    !row ||
    typeof row.groupId !== "string" ||
    typeof row.billingAccountId !== "string" ||
    typeof row.entitlementId !== "string" ||
    row.jti !== jti
  ) {
    throw new CheckoutBoundaryError(
      "ledger_response_invalid",
      "The entitlement ledger returned an invalid identity"
    )
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: EntitlementPayload = {
    iss: "revfactor-hub",
    aud: "revfactor-server-checkout",
    sub: row.entitlementId,
    jti,
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + 15 * 60,
    environment: config.environment,
    highLevel: {
      locationId: config.locationId,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
    },
    onboardingGroup: {
      id: row.groupId,
      billingAccountId: row.billingAccountId,
      accountSequence: input.account.sequence,
      accountCount:
        input.billingMode === "single" ? 1 : input.totalListingCount,
      totalListingCount: input.totalListingCount,
      billingMode: input.billingMode,
    },
    agreement: {
      documentId: input.documentId,
      templateId: config.templateId,
      revision: input.documentRevision,
      contentSha256,
      signedAt: input.signedAt,
    },
    order: {
      primaryQuantity: input.account.listingQuantity,
      childQuantity: 0,
      onboardingFeeCents: input.account.onboardingFeeCents,
      serviceStartMode: "immediate",
      serviceStartDate: null,
      currency: "usd",
      priceBookVersion: config.priceBookVersion,
      stripeAccountId: config.stripeAccountId,
      taxPolicy: "configured_no_collection",
    },
  }
  const token = signEntitlementToken({
    payload,
    privateKeyPem: config.privateKeyPem,
    keyId: config.keyId,
  })
  const stripe = new Stripe(config.stripeSecretKey)
  const provider = new StripeCheckoutAdapter(
    stripe,
    config.stripeAccountId,
    config.environment,
    config.continuationUrl
  )
  const publicKey = createPublicKey(
    createPrivateKey(config.privateKeyPem)
  ).export({ type: "spki", format: "pem" })
  const checkout = await prepareServerCheckout({
    entitlementToken: token,
    resolvePublicKey: async (kid) => {
      if (kid !== config.keyId) {
        throw new CheckoutBoundaryError(
          "unknown_key",
          "Unknown entitlement key"
        )
      }
      return publicKey
    },
    repository: new DbCheckoutAttemptRepository(database),
    provider,
    inspectPrice: stripePriceInspector({
      stripe,
      stripeAccountId: config.stripeAccountId,
    }),
    priceBooks: loadServerPriceBooks(),
  })
  const marked = await database.rpc("mark_onboarding_account_payment_pending", {
    p_billing_account_id: row.billingAccountId,
    p_checkout_session_id: checkout.checkoutSessionId,
  })
  if (marked.error) throw new Error(marked.error.message)
  return {
    groupId: row.groupId,
    billingAccountId: row.billingAccountId,
    checkoutSessionId: checkout.checkoutSessionId,
    checkoutUrl: checkout.checkoutUrl,
    reused: checkout.reused,
  }
}

export async function onboardingAccountStatus(input: {
  groupFingerprint: string
  accountSequence: number
}) {
  if (!/^[a-f0-9]{64}$/.test(input.groupFingerprint)) {
    throw new CheckoutBoundaryError("invalid_group", "Invalid onboarding group")
  }
  const database = createAdminClient() as unknown as RpcDatabase
  const response = await database.rpc("reconcile_onboarding_account_checkout", {
    p_group_external_key: `rfg_${input.groupFingerprint}`,
    p_account_sequence: input.accountSequence,
  })
  if (response.error) throw new Error(response.error.message)
  if (!response.data) return { state: "not_found" as const }
  return response.data as Record<string, unknown>
}
