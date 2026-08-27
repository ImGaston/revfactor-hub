import { createHash, verify as verifySignature } from "node:crypto"

import {
  CheckoutBoundaryError,
  entitlementPayloadSchema,
  type EntitlementPayload,
  type StoredEntitlement,
} from "@/lib/server-checkout/contracts"

type JwsHeader = { alg: "EdDSA"; kid: string; typ: "JWT" }

export type EntitlementKeyResolver = (kid: string) => Promise<string | Buffer>

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
  } catch {
    throw new CheckoutBoundaryError(
      "invalid_token",
      "Entitlement contains invalid JSON"
    )
  }
}

export async function verifyEntitlementToken(input: {
  token: string
  resolvePublicKey: EntitlementKeyResolver
  now?: Date
}): Promise<EntitlementPayload> {
  if (input.token.length > 16_384) {
    throw new CheckoutBoundaryError("invalid_token", "Entitlement is too large")
  }

  const parts = input.token.split(".")
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new CheckoutBoundaryError(
      "invalid_token",
      "Entitlement must be compact JWS"
    )
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJson(encodedHeader) as Partial<JwsHeader>
  if (header.alg !== "EdDSA" || header.typ !== "JWT" || !header.kid) {
    throw new CheckoutBoundaryError(
      "invalid_token",
      "Entitlement header is not allowlisted"
    )
  }

  const publicKey = await input.resolvePublicKey(header.kid)
  const valid = verifySignature(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    Buffer.from(encodedSignature, "base64url")
  )
  if (!valid) {
    throw new CheckoutBoundaryError(
      "invalid_signature",
      "Entitlement signature is invalid"
    )
  }

  const parsed = entitlementPayloadSchema.safeParse(decodeJson(encodedPayload))
  if (!parsed.success) {
    throw new CheckoutBoundaryError(
      "invalid_claims",
      "Entitlement claims are invalid"
    )
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (now < parsed.data.nbf || now >= parsed.data.exp) {
    throw new CheckoutBoundaryError(
      "expired_token",
      "Entitlement is outside its validity window"
    )
  }
  return parsed.data
}

export function compareEntitlementToStoredRecord(
  payload: EntitlementPayload,
  stored: StoredEntitlement,
  now = new Date()
): void {
  const expected: Array<[string, unknown, unknown]> = [
    ["subject", payload.sub, stored.id],
    ["jti", payload.jti, stored.jti],
    ["GHL location", payload.highLevel.locationId, stored.highLevelLocationId],
    ["GHL contact", payload.highLevel.contactId, stored.highLevelContactId],
    [
      "agreement document",
      payload.agreement.documentId,
      stored.agreementDocumentId,
    ],
    [
      "agreement template",
      payload.agreement.templateId,
      stored.agreementTemplateId,
    ],
    [
      "agreement revision",
      payload.agreement.revision,
      stored.agreementRevision,
    ],
    [
      "agreement hash",
      payload.agreement.contentSha256,
      stored.agreementContentSha256,
    ],
    ["primary quantity", payload.order.primaryQuantity, stored.primaryQuantity],
    ["child quantity", payload.order.childQuantity, stored.childQuantity],
    [
      "onboarding fee",
      payload.order.onboardingFeeCents,
      stored.onboardingFeeCents,
    ],
    [
      "service-start mode",
      payload.order.serviceStartMode,
      stored.serviceStartMode,
    ],
    [
      "service-start date",
      payload.order.serviceStartDate,
      stored.serviceStartDate,
    ],
    ["currency", payload.order.currency, stored.currency],
    [
      "price-book version",
      payload.order.priceBookVersion,
      stored.priceBookVersion,
    ],
    ["tax policy", payload.order.taxPolicy, stored.taxPolicy],
  ]
  const mismatch = expected.find(
    ([, signed, canonical]) => signed !== canonical
  )
  if (mismatch) {
    throw new CheckoutBoundaryError(
      "entitlement_mismatch",
      `Signed ${mismatch[0]} does not match the stored agreement entitlement`
    )
  }
  if (stored.status !== "active" || new Date(stored.expiresAt) <= now) {
    throw new CheckoutBoundaryError(
      "inactive_entitlement",
      "Stored entitlement is not active"
    )
  }
}

export function agreementRevisionIdentity(payload: EntitlementPayload): string {
  return createHash("sha256")
    .update(
      [
        payload.iss,
        payload.agreement.documentId,
        payload.agreement.revision,
        payload.agreement.contentSha256,
        payload.jti,
      ].join(":")
    )
    .digest("hex")
}
