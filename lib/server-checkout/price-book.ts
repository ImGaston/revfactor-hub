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
  mode: "test" | "live"
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

  for (const entry of [book.primary, book.child, book.onboarding]) {
    const provider = await input.inspectPrice(entry.priceId)
    const expectedLiveMode = book.mode === "live"
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
    },
    { priceId: book.onboarding.priceId, quantity: 1, kind: "one_time" },
  ]
  if (entitlement.order.childQuantity > 0) {
    lines.splice(1, 0, {
      priceId: book.child.priceId,
      quantity: entitlement.order.childQuantity,
      kind: "recurring",
    })
  }
  return lines
}
