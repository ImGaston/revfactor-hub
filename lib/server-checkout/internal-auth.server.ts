import { createHmac, timingSafeEqual } from "node:crypto"

import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"

const MAX_CLOCK_SKEW_SECONDS = 300

function digest(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
}

export function signInternalOnboardingRequest(input: {
  secret: string
  body: string
  timestamp?: number
}) {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000))
  return {
    timestamp,
    signature: `v1=${digest(input.secret, timestamp, input.body)}`,
  }
}

export function verifyInternalOnboardingRequest(input: {
  secret: string
  body: string
  timestamp: string | null
  signature: string | null
  now?: number
}) {
  if (!input.secret || !input.timestamp || !input.signature) {
    throw new CheckoutBoundaryError(
      "internal_auth_failed",
      "Internal request authentication is missing"
    )
  }
  const timestamp = Number(input.timestamp)
  const now = input.now ?? Math.floor(Date.now() / 1000)
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new CheckoutBoundaryError(
      "internal_auth_failed",
      "Internal request timestamp is outside its validity window"
    )
  }
  const expected = Buffer.from(
    `v1=${digest(input.secret, input.timestamp, input.body)}`
  )
  const received = Buffer.from(input.signature)
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new CheckoutBoundaryError(
      "internal_auth_failed",
      "Internal request signature is invalid"
    )
  }
}
