import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export type StripeEntitlementSubscription = {
  id: string
  customerId: string
  status: string
  raw: unknown
}

export type OnboardingEntitlementSyncResult = {
  enabled: boolean
  created: number
  warnings: string[]
}

const billableStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function metadata(value: unknown): Record<string, string> {
  const source = record(value)
  if (!source) return {}
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
}

function count(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5
    ? parsed
    : null
}

export function deriveOnboardingEntitlement(raw: unknown): {
  primary: number
  child: number
} | null {
  const subscription = record(raw)
  if (!subscription) return null

  const subscriptionMetadata = metadata(subscription.metadata)
  const primaryOverride = count(
    subscriptionMetadata.revfactor_primary_listings
  )
  const childOverride = count(subscriptionMetadata.revfactor_child_listings)
  if (primaryOverride != null || childOverride != null) {
    return {
      primary: primaryOverride ?? 0,
      child: childOverride ?? 0,
    }
  }

  const items = record(subscription.items)?.data
  if (!Array.isArray(items)) return null

  let primary = 0
  let child = 0
  let recognized = false
  for (const value of items) {
    const item = record(value)
    const price = record(item?.price)
    const product = record(price?.product)
    const marker =
      metadata(price?.metadata).revfactor_entitlement ??
      metadata(product?.metadata).revfactor_entitlement
    const quantity =
      typeof item?.quantity === "number" &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0
        ? item.quantity
        : 1

    if (marker === "primary_listing") {
      primary += quantity
      recognized = true
    } else if (marker === "child_listing") {
      child += quantity
      recognized = true
    }
  }

  return recognized ? { primary, child } : null
}

function runKey(
  clientId: string,
  subscriptionIds: string[],
  primary: number,
  child: number,
  prefix: "initial" | "property"
) {
  const fingerprint = createHash("sha256")
    .update(`${clientId}:${subscriptionIds.sort().join(",")}:${primary}:${child}`)
    .digest("hex")
    .slice(0, 16)
  return `${prefix}-${fingerprint}`
}

export async function syncOnboardingEntitlements(
  supabase: SupabaseClient,
  subscriptions: StripeEntitlementSubscription[]
): Promise<OnboardingEntitlementSyncResult> {
  const warnings: string[] = []
  const active = subscriptions.filter((subscription) =>
    billableStatuses.has(subscription.status)
  )
  const customerIds = [...new Set(active.map((subscription) => subscription.customerId))]
  if (customerIds.length === 0) {
    return { enabled: true, created: 0, warnings }
  }

  const { data: links, error: linksError } = await supabase
    .from("client_stripe_customers")
    .select("client_id, stripe_customer_id")
    .in("stripe_customer_id", customerIds)
  if (linksError) throw new Error(linksError.message)

  const clientByCustomer = new Map(
    (links ?? []).map((link) => [link.stripe_customer_id, link.client_id])
  )
  const totals = new Map<
    string,
    { primary: number; child: number; subscriptionIds: Set<string> }
  >()

  for (const subscription of active) {
    const entitlement = deriveOnboardingEntitlement(subscription.raw)
    if (!entitlement) {
      warnings.push(
        `${subscription.id}: add RevFactor entitlement metadata before onboarding sync can use it.`
      )
      continue
    }
    const clientId = clientByCustomer.get(subscription.customerId)
    if (!clientId) {
      warnings.push(`${subscription.id}: Stripe customer is not linked to a Hub client.`)
      continue
    }
    const total = totals.get(clientId) ?? {
      primary: 0,
      child: 0,
      subscriptionIds: new Set<string>(),
    }
    total.primary += entitlement.primary
    total.child += entitlement.child
    total.subscriptionIds.add(subscription.id)
    totals.set(clientId, total)
  }

  let created = 0
  for (const [clientId, total] of totals) {
    if (total.primary < 1) {
      warnings.push(
        `${clientId}: onboarding requires at least one primary-listing entitlement.`
      )
      continue
    }
    if (total.primary > 5 || total.child > 5) {
      warnings.push(
        `${clientId}: entitlement exceeds the current five-primary/five-child onboarding limit.`
      )
      continue
    }

    const { data: runs, error: runsError } = await supabase
      .from("onboarding_runs")
      .select(
        "id, status, primary_listing_entitlement, child_listing_entitlement"
      )
      .eq("client_id", clientId)
      .neq("status", "archived")
    if (runsError) throw new Error(runsError.message)

    const allocated = (runs ?? []).reduce(
      (sum, run) => ({
        primary:
          sum.primary + Number(run.primary_listing_entitlement ?? 0),
        child: sum.child + Number(run.child_listing_entitlement ?? 0),
      }),
      { primary: 0, child: 0 }
    )
    const primaryDelta = total.primary - allocated.primary
    const childDelta = total.child - allocated.child
    if (primaryDelta < 0 || childDelta < 0) {
      warnings.push(
        `${clientId}: Stripe entitlement decreased; review existing onboarding runs manually.`
      )
      continue
    }
    if (primaryDelta === 0 && childDelta === 0) continue
    if ((runs ?? []).some((run) => run.status === "draft")) {
      warnings.push(
        `${clientId}: entitlement changed while a draft is active; review before resizing the run.`
      )
      continue
    }
    if ((runs ?? []).length > 0 && primaryDelta < 1) {
      warnings.push(
        `${clientId}: a child-only addition needs manual parent mapping to an existing listing.`
      )
      continue
    }

    const subscriptionIds = [...total.subscriptionIds].sort()
    const isInitial = (runs ?? []).length === 0
    const runPrimary = isInitial ? total.primary : primaryDelta
    const runChild = isInitial ? total.child : childDelta
    const externalKey = runKey(
      clientId,
      subscriptionIds,
      runPrimary,
      runChild,
      isInitial ? "initial" : "property"
    )
    const { error: insertError } = await supabase
      .from("onboarding_runs")
      .upsert(
        {
          client_id: clientId,
          external_key: externalKey,
          run_type: isInitial ? "initial" : "additional_property",
          stripe_subscription_ids: subscriptionIds,
          primary_listing_entitlement: runPrimary,
          child_listing_entitlement: runChild,
          entitlement_synced_at: new Date().toISOString(),
        },
        { onConflict: "client_id,external_key", ignoreDuplicates: true }
      )
    if (insertError) throw new Error(insertError.message)
    created += 1
  }

  return { enabled: true, created, warnings }
}
