import {
  CheckoutBoundaryError,
  type EntitlementPayload,
} from "@/lib/server-checkout/contracts"

export type PriceBookEntry = {
  priceId: string
  productMarker: string
  unitAmount: number
  currency: "usd"
  kind: "one_time" | "recurring"
  interval: "month" | null
}

export type PriceBook = {
  version: string
  stripeAccountId: string
  environment: "isolated_fixture" | "test" | "live"
  primary: PriceBookEntry
  child: PriceBookEntry
  onboarding: PriceBookEntry
}

export type ProviderPrice = PriceBookEntry & {
  active: boolean
  stripeAccountId: string
  livemode: boolean
}

export type PriceInspector = (priceId: string) => Promise<ProviderPrice>

export type CanonicalLineItem = {
  priceId: string
  quantity: number
  kind: "one_time" | "recurring"
  unitAmount: number
  currency: "usd"
}

export function normalizeCanonicalLineItems(
  lines: readonly CanonicalLineItem[]
): CanonicalLineItem[] {
  return [...lines]
    .map((line) => ({ ...line }))
    .sort((left, right) => left.priceId.localeCompare(right.priceId))
}

export async function resolveCanonicalLineItems(input: {
  entitlement: EntitlementPayload
  priceBooks: Readonly<Record<string, PriceBook>>
  inspectPrice: PriceInspector
  allowProvisionalFixturePolicy?: boolean
}): Promise<CanonicalLineItem[]> {
  const { entitlement } = input
  if (
    entitlement.order.taxPolicy === "policy_blocked" ||
    (entitlement.order.taxPolicy === "provisional_fixture_only" &&
      (!input.allowProvisionalFixturePolicy ||
        entitlement.environment !== "isolated_fixture"))
  ) {
    throw new CheckoutBoundaryError(
      "policy_blocked",
      "Tax policy has not been approved"
    )
  }

  const book = input.priceBooks[entitlement.order.priceBookVersion]
  if (!book || book.version !== entitlement.order.priceBookVersion) {
    throw new CheckoutBoundaryError(
      "price_book_mismatch",
      "Price-book version is not allowlisted"
    )
  }
  if (
    book.environment !== entitlement.environment ||
    book.stripeAccountId !== entitlement.order.stripeAccountId
  ) {
    throw new CheckoutBoundaryError(
      "environment_mismatch",
      "Entitlement environment or Stripe account does not match the price book"
    )
  }
  if (
    entitlement.environment === "isolated_fixture" &&
    !book.stripeAccountId.startsWith("fixture:")
  ) {
    throw new CheckoutBoundaryError(
      "environment_mismatch",
      "Isolated fixtures require a non-provider fixture account"
    )
  }

  for (const entry of [book.primary, book.child, book.onboarding]) {
    const provider = await input.inspectPrice(entry.priceId)
    const expectedLiveMode = book.environment === "live"
    if (
      !provider.active ||
      provider.stripeAccountId !== book.stripeAccountId ||
      provider.livemode !== expectedLiveMode ||
      provider.productMarker !== entry.productMarker ||
      provider.unitAmount !== entry.unitAmount ||
      provider.currency !== entry.currency ||
      provider.kind !== entry.kind ||
      provider.interval !== entry.interval
    ) {
      throw new CheckoutBoundaryError(
        "provider_price_mismatch",
        `Price ${entry.priceId} failed allowlist verification`
      )
    }
  }

  const lines: CanonicalLineItem[] = [
    {
      priceId: book.primary.priceId,
      quantity: entitlement.order.primaryQuantity,
      kind: "recurring",
      unitAmount: book.primary.unitAmount,
      currency: book.primary.currency,
    },
    {
      priceId: book.onboarding.priceId,
      quantity: 1,
      kind: "one_time",
      unitAmount: book.onboarding.unitAmount,
      currency: book.onboarding.currency,
    },
  ]
  if (entitlement.order.childQuantity > 0) {
    lines.splice(1, 0, {
      priceId: book.child.priceId,
      quantity: entitlement.order.childQuantity,
      kind: "recurring",
      unitAmount: book.child.unitAmount,
      currency: book.child.currency,
    })
  }
  return normalizeCanonicalLineItems(lines)
}
