import { createHash, createPrivateKey, sign } from "node:crypto"

import {
  entitlementPayloadSchema,
  type EntitlementPayload,
} from "@/lib/server-checkout/contracts"

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

export function signEntitlementToken(input: {
  payload: EntitlementPayload
  privateKeyPem: string
  keyId: string
}) {
  const parsed = entitlementPayloadSchema.parse(input.payload)
  const encodedHeader = encode({
    alg: "EdDSA",
    typ: "JWT",
    kid: input.keyId,
  })
  const encodedPayload = encode(parsed)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = sign(
    null,
    Buffer.from(signingInput),
    createPrivateKey(input.privateKeyPem)
  ).toString("base64url")
  return `${signingInput}.${signature}`
}

export function canonicalAgreementContentSha256(input: {
  documentId: string
  templateId: string
  documentRevision: number
  opportunityId: string
  legalBusinessName: string
  listingQuantity: number
  pricingProgram: "Regular" | "Referral"
  monthlyRateCents: number
  monthlyAmountCents: number
  onboardingFeeCents: number
  initialCheckoutTotalCents: number
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}
