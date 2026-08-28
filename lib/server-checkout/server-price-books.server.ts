import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import type { PriceBook } from "@/lib/server-checkout/price-book"

export const STANDARD_PRICE_BOOK_VERSION = "rf-standard-usd-v1" as const

type ServerPriceBookEnvironment = {
  RF_CHECKOUT_STRIPE_ACCOUNT_ID?: string
  RF_CHECKOUT_STRIPE_MODE?: string
  RF_CHECKOUT_V1_PRIMARY_PRICE_ID?: string
  RF_CHECKOUT_V1_CHILD_PRICE_ID?: string
  RF_CHECKOUT_V1_ONBOARDING_PRICE_ID?: string
}

function required(
  environment: ServerPriceBookEnvironment,
  key: keyof ServerPriceBookEnvironment
) {
  const value = environment[key]?.trim()
  if (!value) {
    throw new CheckoutBoundaryError(
      "price_book_unconfigured",
      `${key} is not configured`
    )
  }
  return value
}

// IDs are injected from server-only configuration, while all commercial
// attributes remain versioned constants. Provider inspection must still prove
// the account, mode, product marker, amount, currency, kind and cadence.
export function loadServerPriceBooks(
  environment?: ServerPriceBookEnvironment
): Readonly<Record<string, PriceBook>> {
  const serverEnvironment: ServerPriceBookEnvironment = environment ?? {
    RF_CHECKOUT_STRIPE_ACCOUNT_ID: process.env.RF_CHECKOUT_STRIPE_ACCOUNT_ID,
    RF_CHECKOUT_STRIPE_MODE: process.env.RF_CHECKOUT_STRIPE_MODE,
    RF_CHECKOUT_V1_PRIMARY_PRICE_ID:
      process.env.RF_CHECKOUT_V1_PRIMARY_PRICE_ID,
    RF_CHECKOUT_V1_CHILD_PRICE_ID: process.env.RF_CHECKOUT_V1_CHILD_PRICE_ID,
    RF_CHECKOUT_V1_ONBOARDING_PRICE_ID:
      process.env.RF_CHECKOUT_V1_ONBOARDING_PRICE_ID,
  }
  const mode = required(serverEnvironment, "RF_CHECKOUT_STRIPE_MODE")
  if (mode !== "test" && mode !== "live") {
    throw new CheckoutBoundaryError(
      "price_book_unconfigured",
      "RF_CHECKOUT_STRIPE_MODE must be test or live"
    )
  }
  const book: PriceBook = {
    version: STANDARD_PRICE_BOOK_VERSION,
    stripeAccountId: required(
      serverEnvironment,
      "RF_CHECKOUT_STRIPE_ACCOUNT_ID"
    ),
    environment: mode,
    primary: {
      priceId: required(serverEnvironment, "RF_CHECKOUT_V1_PRIMARY_PRICE_ID"),
      productMarker: "revfactor_primary_listing",
      unitAmount: 35000,
      currency: "usd",
      kind: "recurring",
      interval: "month",
    },
    child: {
      priceId: required(serverEnvironment, "RF_CHECKOUT_V1_CHILD_PRICE_ID"),
      productMarker: "revfactor_child_listing",
      unitAmount: 5000,
      currency: "usd",
      kind: "recurring",
      interval: "month",
    },
    onboarding: {
      priceId: required(
        serverEnvironment,
        "RF_CHECKOUT_V1_ONBOARDING_PRICE_ID"
      ),
      productMarker: "revfactor_onboarding_fee",
      unitAmount: 15000,
      currency: "usd",
      kind: "one_time",
      interval: null,
    },
  }
  return Object.freeze({ [STANDARD_PRICE_BOOK_VERSION]: Object.freeze(book) })
}
