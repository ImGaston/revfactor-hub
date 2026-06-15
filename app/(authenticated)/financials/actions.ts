"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { isStripeConfigured, searchCustomersByEmail } from "@/lib/stripe"
import { syncStripeData } from "@/lib/stripe-sync"
import { getProfile } from "@/lib/supabase/profile"
import {
  isAssemblyConfigured,
  findOrCreateAssemblyClient,
  assemblyClientMessagesUrl,
} from "@/lib/assembly"
import { validateAllocations } from "@/lib/financial-planning"
import {
  dedupeHash,
  matchRecurring,
  suggestCategoryId,
  type ClassifiedBankRow,
  type RawBankRow,
} from "@/lib/bank-import"

type ListingAllocationInput = {
  listingId: string
  amountCents: number
}

async function requireSuperAdmin() {
  const profile = await getProfile()
  if (profile?.role !== "super_admin") {
    throw new Error("Unauthorized")
  }
}

async function replaceExpenseAllocations(
  expenseId: string,
  amount: number,
  type: string,
  allocations: ListingAllocationInput[]
) {
  const supabase = await createClient()
  const { error: deleteError } = await supabase
    .from("expense_listing_allocations")
    .delete()
    .eq("expense_id", expenseId)
  if (deleteError) return deleteError.message

  if (type !== "variable" || allocations.length === 0) return null
  if (!validateAllocations(Math.round(amount * 100), allocations)) {
    return "Listing allocations must equal the expense total"
  }

  const { error } = await supabase.from("expense_listing_allocations").insert(
    allocations.map((allocation) => ({
      expense_id: expenseId,
      listing_id: allocation.listingId,
      amount_cents: allocation.amountCents,
    }))
  )
  return error?.message ?? null
}

// ─── Expenses ───────────────────────────────────────────

export async function createExpense(formData: FormData) {
  const description = formData.get("description") as string
  const amount = parseFloat(formData.get("amount") as string)
  const category_id = formData.get("category_id") as string
  const type = formData.get("type") as string
  const date = formData.get("date") as string
  const notes = formData.get("notes") as string
  const allocations = JSON.parse(
    (formData.get("allocations") as string) || "[]"
  ) as ListingAllocationInput[]

  if (!description) return { error: "Description is required" }
  if (isNaN(amount) || amount <= 0) return { error: "Valid amount is required" }
  if (!type) return { error: "Type is required" }
  if (!date) return { error: "Date is required" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      description,
      amount,
      category_id: category_id || null,
      type,
      date,
      notes: notes || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  const allocationError = await replaceExpenseAllocations(
    expense.id,
    amount,
    type,
    allocations
  )
  if (allocationError) {
    await supabase.from("expenses").delete().eq("id", expense.id)
    return { error: allocationError }
  }

  revalidatePath("/financials")
  return { error: null }
}

export async function updateExpense(
  id: string,
  data: {
    description?: string
    amount?: number
    category_id?: string | null
    type?: string
    date?: string
    notes?: string | null
    allocations?: ListingAllocationInput[]
  }
) {
  const { allocations, ...expenseData } = data
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({ ...expenseData, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  if (allocations) {
    const { data: expense } = await supabase
      .from("expenses")
      .select("amount, type")
      .eq("id", id)
      .single()
    if (!expense) return { error: "Expense not found" }
    const allocationError = await replaceExpenseAllocations(
      id,
      Number(expense.amount),
      expense.type,
      allocations
    )
    if (allocationError) return { error: allocationError }
  }

  revalidatePath("/financials")
  return { error: null }
}

export async function deleteExpense(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("expenses").delete().eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function markExpensePaid(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({
      is_paid: true,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function markExpenseUnpaid(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({
      is_paid: false,
      paid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

// ─── Expense Categories ─────────────────────────────────

export async function createExpenseCategory(
  name: string,
  type: "fixed" | "variable"
) {
  if (!name) return { error: "Name is required" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("expense_categories")
    .insert({ name, type })

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function deleteExpenseCategory(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expense_categories")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

// ─── Stripe Customer Linking ────────────────────────────
//
// Source of truth: `client_stripe_customers` junction (N Stripe customers → 1 Hub client).
// `clients.stripe_customer_id` is kept as a "primary" convenience pointer, set to the
// first linked customer and not automatically rebalanced afterwards.

export async function linkStripeCustomer(
  clientId: string,
  stripeCustomerId: string
) {
  const supabase = await createClient()

  const { error: junctionError } = await supabase
    .from("client_stripe_customers")
    .upsert({ client_id: clientId, stripe_customer_id: stripeCustomerId })
  if (junctionError) return { error: junctionError.message }

  // Set primary if the client doesn't have one yet.
  const { data: client } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("id", clientId)
    .single()

  if (!client?.stripe_customer_id) {
    const { error: primaryError } = await supabase
      .from("clients")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", clientId)
    if (primaryError) return { error: primaryError.message }
  }

  revalidatePath("/financials")
  revalidatePath("/clients")
  return { error: null }
}

export async function unlinkStripeCustomer(
  clientId: string,
  stripeCustomerId?: string
) {
  const supabase = await createClient()

  if (stripeCustomerId) {
    // Unlink just this one customer
    const { error: delError } = await supabase
      .from("client_stripe_customers")
      .delete()
      .eq("client_id", clientId)
      .eq("stripe_customer_id", stripeCustomerId)
    if (delError) return { error: delError.message }

    // If this was the primary, promote another linked customer (or clear)
    const { data: client } = await supabase
      .from("clients")
      .select("stripe_customer_id")
      .eq("id", clientId)
      .single()

    if (client?.stripe_customer_id === stripeCustomerId) {
      const { data: remaining } = await supabase
        .from("client_stripe_customers")
        .select("stripe_customer_id")
        .eq("client_id", clientId)
        .limit(1)
        .maybeSingle()

      await supabase
        .from("clients")
        .update({ stripe_customer_id: remaining?.stripe_customer_id ?? null })
        .eq("id", clientId)
    }
  } else {
    // Unlink everything for this client
    const { error: delError } = await supabase
      .from("client_stripe_customers")
      .delete()
      .eq("client_id", clientId)
    if (delError) return { error: delError.message }

    const { error: primaryError } = await supabase
      .from("clients")
      .update({ stripe_customer_id: null })
      .eq("id", clientId)
    if (primaryError) return { error: primaryError.message }
  }

  revalidatePath("/financials")
  revalidatePath("/clients")
  return { error: null }
}

export async function autoLinkStripeCustomers() {
  if (!isStripeConfigured())
    return { error: "Stripe is not configured", linked: 0 }

  const supabase = await createClient()

  // All clients with an email — we may find NEW Stripe customers even for clients
  // that already have a primary, because the old 1:1 auto-link only linked one.
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, email, stripe_customer_id")
    .not("email", "is", null)

  if (clientsError) return { error: clientsError.message, linked: 0 }
  if (!clients || clients.length === 0) return { error: null, linked: 0 }

  // Pull what's already in the junction so we don't re-insert
  const { data: existing } = await supabase
    .from("client_stripe_customers")
    .select("stripe_customer_id")
  const alreadyLinked = new Set(
    (existing ?? []).map((r) => r.stripe_customer_id)
  )

  let linked = 0

  for (const client of clients) {
    if (!client.email) continue
    try {
      const matches = await searchCustomersByEmail(client.email)
      if (matches.length === 0) continue

      const toInsert = matches
        .filter((m) => !alreadyLinked.has(m.id))
        .map((m) => ({ client_id: client.id, stripe_customer_id: m.id }))

      if (toInsert.length > 0) {
        const { error: junctionError } = await supabase
          .from("client_stripe_customers")
          .upsert(toInsert)
        if (!junctionError) {
          linked += toInsert.length
          for (const row of toInsert) alreadyLinked.add(row.stripe_customer_id)
        }
      }

      // Set primary if missing
      if (!client.stripe_customer_id && matches[0]) {
        await supabase
          .from("clients")
          .update({ stripe_customer_id: matches[0].id })
          .eq("id", client.id)
      }
    } catch {
      // Skip failed lookups, continue with others
    }
  }

  revalidatePath("/financials")
  revalidatePath("/clients")
  return { error: null, linked }
}

// ─── Stripe Subscription ↔ Listing Linking ──────────────

export async function linkSubscriptionToListings(
  stripeSubscriptionId: string,
  listingIds: string[]
) {
  const supabase = await createClient()

  // Clear any existing listings linked to this subscription
  const { error: clearError } = await supabase
    .from("listings")
    .update({ stripe_subscription_id: null })
    .eq("stripe_subscription_id", stripeSubscriptionId)

  if (clearError) return { error: clearError.message }

  // Link the selected listings
  if (listingIds.length > 0) {
    const { error } = await supabase
      .from("listings")
      .update({ stripe_subscription_id: stripeSubscriptionId })
      .in("id", listingIds)

    if (error) return { error: error.message }
  }

  revalidatePath("/financials")
  revalidatePath("/listings")
  return { error: null }
}

export async function unlinkSubscriptionFromListing(listingId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("listings")
    .update({ stripe_subscription_id: null })
    .eq("id", listingId)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  revalidatePath("/listings")
  return { error: null }
}

// Create a new active listing already associated to a client, from the
// "Link Listings to Subscription" dialog. Returns the new listing id so the
// caller can auto-select it.
export async function createListingForClient(input: {
  clientId: string
  name: string
  listingId?: string | null
  pricelabsLink?: string | null
  airbnbLink?: string | null
  city?: string | null
  state?: string | null
}) {
  await requireSuperAdmin()
  if (!input.clientId) return { error: "Missing client" }
  if (!input.name?.trim()) return { error: "Name is required" }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listings")
    .insert({
      client_id: input.clientId,
      name: input.name.trim(),
      status: "active",
      listing_id: input.listingId || null,
      pricelabs_link: input.pricelabsLink || null,
      airbnb_link: input.airbnbLink || null,
      city: input.city || null,
      state: input.state || null,
    })
    .select("id")
    .single()
  if (error || !data) {
    return { error: error?.message ?? "Could not create listing" }
  }

  revalidatePath("/financials")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null, listingId: data.id as string }
}

// ─── Cash planning ─────────────────────────────────────

export async function saveCashSnapshot(input: {
  operatingCashCents: number
  taxCashCents: number
  effectiveDate: string
  notes?: string
}) {
  await requireSuperAdmin()
  if (!input.effectiveDate) return { error: "Effective date is required" }
  if (input.operatingCashCents < 0 || input.taxCashCents < 0) {
    return { error: "Cash balances cannot be negative" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from("financial_cash_snapshots").insert({
    operating_cash_cents: Math.round(input.operatingCashCents),
    tax_cash_cents: Math.round(input.taxCashCents),
    effective_date: input.effectiveDate,
    notes: input.notes || null,
    created_by: user?.id ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath("/financials")
  return { error: null }
}

export async function getPlanningData() {
  await requireSuperAdmin()
  const supabase = await createClient()
  const [scenarios, listings, events, eventAllocations, snapshots] =
    await Promise.all([
      supabase
        .from("financial_scenarios")
        .select("*")
        .order("updated_at", { ascending: false }),
      supabase.from("financial_scenario_listings").select("*").order("name"),
      supabase
        .from("financial_scenario_events")
        .select("*")
        .order("start_month"),
      supabase.from("financial_scenario_event_allocations").select("*"),
      supabase
        .from("financial_cash_snapshots")
        .select("*")
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1),
    ])

  const error =
    scenarios.error ??
    listings.error ??
    events.error ??
    eventAllocations.error ??
    snapshots.error
  if (error) return { error: error.message, data: null }
  return {
    error: null,
    data: {
      scenarios: scenarios.data ?? [],
      listings: listings.data ?? [],
      events: events.data ?? [],
      eventAllocations: eventAllocations.data ?? [],
      openingCashCents: Number(snapshots.data?.[0]?.operating_cash_cents ?? 0),
    },
  }
}

export async function createFinancialScenario(input: {
  name: string
  description?: string
  startMonth: string
}) {
  await requireSuperAdmin()
  if (!input.name.trim()) return { error: "Name is required", id: null }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [
    { data: sourceListings, error: listingError },
    { data: subscriptions },
    { data: recurring },
  ] = await Promise.all([
    supabase
      .from("listings")
      .select("id, name, stripe_subscription_id")
      .eq("status", "active")
      .order("name"),
    supabase
      .from("stripe_subscriptions")
      .select("id, amount")
      .eq("status", "active"),
    supabase
      .from("recurring_expenses")
      .select("description, amount, type")
      .eq("is_active", true),
  ])
  if (listingError) return { error: listingError.message, id: null }

  const { data: scenario, error } = await supabase
    .from("financial_scenarios")
    .insert({
      name: input.name.trim(),
      description: input.description || null,
      start_month: `${input.startMonth.slice(0, 7)}-01`,
      horizon_months: 12,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()
  if (error) return { error: error.message, id: null }

  const subscriptionAmounts = new Map(
    (subscriptions ?? []).map((subscription) => [
      subscription.id,
      Math.round(Number(subscription.amount) * 100),
    ])
  )
  const subscriptionListingCounts = new Map<string, number>()
  for (const listing of sourceListings ?? []) {
    if (!listing.stripe_subscription_id) continue
    subscriptionListingCounts.set(
      listing.stripe_subscription_id,
      (subscriptionListingCounts.get(listing.stripe_subscription_id) ?? 0) + 1
    )
  }

  if ((sourceListings ?? []).length > 0) {
    const { error: insertListingsError } = await supabase
      .from("financial_scenario_listings")
      .insert(
        (sourceListings ?? []).map((listing) => ({
          scenario_id: scenario.id,
          source_listing_id: listing.id,
          name: listing.name,
          monthly_revenue_cents: listing.stripe_subscription_id
            ? Math.round(
                (subscriptionAmounts.get(listing.stripe_subscription_id) ?? 0) /
                  (subscriptionListingCounts.get(
                    listing.stripe_subscription_id
                  ) ?? 1)
              )
            : 0,
          start_month: `${input.startMonth.slice(0, 7)}-01`,
        }))
      )
    if (insertListingsError)
      return { error: insertListingsError.message, id: null }
  }

  if ((recurring ?? []).length > 0) {
    const { error: insertEventsError } = await supabase
      .from("financial_scenario_events")
      .insert(
        (recurring ?? []).map((expense) => ({
          scenario_id: scenario.id,
          kind:
            expense.type === "variable" ? "variable_expense" : "fixed_expense",
          description: expense.description,
          amount_cents: Math.round(Number(expense.amount) * 100),
          recurrence: "monthly",
          start_month: `${input.startMonth.slice(0, 7)}-01`,
        }))
      )
    if (insertEventsError) return { error: insertEventsError.message, id: null }
  }

  revalidatePath("/financials")
  return { error: null, id: scenario.id }
}

export async function cloneFinancialScenario(id: string, name: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const [
    { data: source },
    { data: listings },
    { data: events },
    { data: eventAllocations },
  ] = await Promise.all([
    supabase.from("financial_scenarios").select("*").eq("id", id).single(),
    supabase
      .from("financial_scenario_listings")
      .select("*")
      .eq("scenario_id", id),
    supabase
      .from("financial_scenario_events")
      .select("*")
      .eq("scenario_id", id),
    supabase
      .from("financial_scenario_event_allocations")
      .select("event_id, scenario_listing_id, amount_cents"),
  ])
  if (!source) return { error: "Scenario not found", id: null }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: clone, error } = await supabase
    .from("financial_scenarios")
    .insert({
      name,
      description: source.description,
      start_month: source.start_month,
      horizon_months: source.horizon_months,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()
  if (error) return { error: error.message, id: null }

  const listingIdMap = new Map<string, string>()
  for (const listing of listings ?? []) {
    const { data: clonedListing, error: listingCloneError } = await supabase
      .from("financial_scenario_listings")
      .insert({
        scenario_id: clone.id,
        source_listing_id: listing.source_listing_id,
        name: listing.name,
        monthly_revenue_cents: listing.monthly_revenue_cents,
        start_month: listing.start_month,
        end_month: listing.end_month,
      })
      .select("id")
      .single()
    if (listingCloneError) return { error: listingCloneError.message, id: null }
    listingIdMap.set(listing.id, clonedListing.id)
  }

  const eventIdMap = new Map<string, string>()
  for (const event of events ?? []) {
    const { data: clonedEvent, error: eventCloneError } = await supabase
      .from("financial_scenario_events")
      .insert({
        scenario_id: clone.id,
        kind: event.kind,
        description: event.description,
        amount_cents: event.amount_cents,
        recurrence: event.recurrence,
        start_month: event.start_month,
        end_month: event.end_month,
      })
      .select("id")
      .single()
    if (eventCloneError) return { error: eventCloneError.message, id: null }
    eventIdMap.set(event.id, clonedEvent.id)
  }

  const clonedAllocations = (eventAllocations ?? [])
    .map((allocation) => ({
      event_id: eventIdMap.get(allocation.event_id),
      scenario_listing_id: listingIdMap.get(allocation.scenario_listing_id),
      amount_cents: allocation.amount_cents,
    }))
    .filter(
      (
        allocation
      ): allocation is {
        event_id: string
        scenario_listing_id: string
        amount_cents: number
      } => !!allocation.event_id && !!allocation.scenario_listing_id
    )
  if (clonedAllocations.length > 0) {
    const { error: allocationsError } = await supabase
      .from("financial_scenario_event_allocations")
      .insert(clonedAllocations)
    if (allocationsError) return { error: allocationsError.message, id: null }
  }
  revalidatePath("/financials")
  return { error: null, id: clone.id }
}

export async function updateFinancialScenario(input: {
  id: string
  name: string
  description?: string | null
}) {
  await requireSuperAdmin()
  if (!input.name.trim()) return { error: "Name is required" }
  const supabase = await createClient()
  const { error } = await supabase
    .from("financial_scenarios")
    .update({
      name: input.name.trim(),
      description: input.description || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
  if (error) return { error: error.message }
  revalidatePath("/financials")
  return { error: null }
}

export async function deleteFinancialScenario(id: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from("financial_scenarios")
    .delete()
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/financials")
  return { error: null }
}

export async function saveScenarioListing(input: {
  id?: string
  scenarioId: string
  name: string
  monthlyRevenueCents: number
  startMonth: string
  endMonth?: string | null
}) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const values = {
    scenario_id: input.scenarioId,
    name: input.name.trim(),
    monthly_revenue_cents: Math.round(input.monthlyRevenueCents),
    start_month: `${input.startMonth.slice(0, 7)}-01`,
    end_month: input.endMonth ? `${input.endMonth.slice(0, 7)}-01` : null,
  }
  const result = input.id
    ? await supabase
        .from("financial_scenario_listings")
        .update(values)
        .eq("id", input.id)
    : await supabase.from("financial_scenario_listings").insert(values)
  if (result.error) return { error: result.error.message }
  revalidatePath("/financials")
  return { error: null }
}

export async function deleteScenarioListing(id: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from("financial_scenario_listings")
    .delete()
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/financials")
  return { error: null }
}

export async function saveScenarioEvent(input: {
  id?: string
  scenarioId: string
  kind:
    | "fixed_expense"
    | "variable_expense"
    | "growth_investment"
    | "capital_contribution"
  description: string
  amountCents: number
  recurrence: "one_time" | "monthly"
  startMonth: string
  endMonth?: string | null
  allocations?: { scenarioListingId: string; amountCents: number }[]
}) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const values = {
    scenario_id: input.scenarioId,
    kind: input.kind,
    description: input.description.trim(),
    amount_cents: Math.round(input.amountCents),
    recurrence: input.recurrence,
    start_month: `${input.startMonth.slice(0, 7)}-01`,
    end_month: input.endMonth ? `${input.endMonth.slice(0, 7)}-01` : null,
  }
  if (
    input.kind === "variable_expense" &&
    (input.allocations?.length ?? 0) > 0 &&
    !validateAllocations(input.amountCents, input.allocations ?? [])
  ) {
    return { error: "Listing allocations must equal the event total" }
  }

  const result = input.id
    ? await supabase
        .from("financial_scenario_events")
        .update(values)
        .eq("id", input.id)
        .select("id")
        .single()
    : await supabase
        .from("financial_scenario_events")
        .insert(values)
        .select("id")
        .single()
  if (result.error) return { error: result.error.message }

  const eventId = result.data.id
  const { error: deleteError } = await supabase
    .from("financial_scenario_event_allocations")
    .delete()
    .eq("event_id", eventId)
  if (deleteError) return { error: deleteError.message }

  if (
    input.kind === "variable_expense" &&
    (input.allocations?.length ?? 0) > 0
  ) {
    const { error: allocationError } = await supabase
      .from("financial_scenario_event_allocations")
      .insert(
        (input.allocations ?? []).map((allocation) => ({
          event_id: eventId,
          scenario_listing_id: allocation.scenarioListingId,
          amount_cents: Math.round(allocation.amountCents),
        }))
      )
    if (allocationError) return { error: allocationError.message }
  }
  revalidatePath("/financials")
  return { error: null }
}

export async function deleteScenarioEvent(id: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from("financial_scenario_events")
    .delete()
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/financials")
  return { error: null }
}

// ─── Create Hub client (+ optionally Assembly) from a Stripe customer ─

export async function createClientFromStripeCustomer(input: {
  stripeCustomerId: string
  name: string
  email: string
  phone?: string | null
  alsoCreateAssembly: boolean
}) {
  if (!input.name?.trim()) return { error: "Name is required" }
  if (!input.email?.trim()) return { error: "Email is required" }
  if (!input.stripeCustomerId)
    return { error: "Stripe customer ID is required" }

  const profile = await getProfile()
  if (profile?.role !== "super_admin") return { error: "Unauthorized" }

  const supabase = await createClient()
  const admin = createAdminClient()

  // Guard: this Stripe customer must not already be linked to a Hub client.
  const { data: existingLink } = await supabase
    .from("client_stripe_customers")
    .select("client_id")
    .eq("stripe_customer_id", input.stripeCustomerId)
    .maybeSingle()
  if (existingLink) {
    return { error: "This Stripe customer is already linked to a Hub client" }
  }

  let assemblyClientId: string | null = null
  let assemblyLink: string | null = null

  if (input.alsoCreateAssembly) {
    if (!isAssemblyConfigured()) {
      return { error: "Assembly is not configured" }
    }
    const nameParts = input.name.trim().split(/\s+/)
    const givenName = nameParts[0]
    const familyName =
      nameParts.length > 1 ? nameParts.slice(1).join(" ") : givenName

    try {
      const assemblyClient = await findOrCreateAssemblyClient({
        givenName,
        familyName,
        email: input.email,
        phone: input.phone ?? undefined,
        sendInvite: true,
      })
      assemblyClientId = assemblyClient.id
      assemblyLink = assemblyClientMessagesUrl(assemblyClient.id)
    } catch (err) {
      return {
        error: `Assembly: ${err instanceof Error ? err.message : "unknown error"}`,
      }
    }
  }

  // Create Hub client
  const { data: newClient, error: insertError } = await admin
    .from("clients")
    .insert({
      name: input.name.trim(),
      email: input.email.trim(),
      status: "onboarding",
      onboarding_date: new Date().toISOString().split("T")[0],
      stripe_customer_id: input.stripeCustomerId,
      assembly_client_id: assemblyClientId,
      assembly_link: assemblyLink,
    })
    .select("id")
    .single()

  if (insertError || !newClient) {
    return {
      error: `Hub client insert failed: ${insertError?.message ?? "unknown"}`,
    }
  }

  // Link Stripe customer in junction
  const { error: junctionError } = await admin
    .from("client_stripe_customers")
    .insert({
      client_id: newClient.id,
      stripe_customer_id: input.stripeCustomerId,
    })
  if (junctionError) {
    return { error: `Junction insert failed: ${junctionError.message}` }
  }

  revalidatePath("/financials")
  revalidatePath("/clients")
  return {
    error: null,
    clientId: newClient.id,
    assemblyClientId,
  }
}

// ─── Stripe mirror sync ─────────────────────────────────

export async function syncStripeNow() {
  if (!isStripeConfigured()) return { error: "Stripe not configured" }
  const profile = await getProfile()
  if (profile?.role !== "super_admin") return { error: "Unauthorized" }

  try {
    const admin = createAdminClient()
    const result = await syncStripeData(admin)
    revalidatePath("/financials")
    return {
      error: null,
      subscriptions: result.subscriptions.upserted,
      invoices: result.invoices.upserted,
      payouts: result.payouts.upserted,
      reconciledPayouts: result.payouts.reconciled,
      warnings: [
        ...result.subscriptions.errors.map((e) => `subs: ${e}`),
        ...result.invoices.errors.map((e) => `invoices: ${e}`),
        ...result.payouts.errors.map((e) => `payouts: ${e}`),
      ],
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" }
  }
}

// ─── Bank statement import ──────────────────────────────

export async function commitBankImport(input: {
  accountId: string
  filename: string
  periodStart: string | null
  periodEnd: string | null
  rows: ClassifiedBankRow[]
}) {
  await requireSuperAdmin()
  if (!input.accountId) return { error: "Select a bank account" }
  if (input.rows.length === 0) return { error: "No rows to import" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Look up the account number for dedupe-hash recomputation and validation.
  const { data: account, error: accountError } = await supabase
    .from("bank_accounts")
    .select("id, account_number")
    .eq("id", input.accountId)
    .single()
  if (accountError || !account) return { error: "Bank account not found" }

  // Skip rows already imported (idempotent re-import).
  const hashes = input.rows.map((row) =>
    dedupeHash(account.account_number, row)
  )
  const { data: existing } = await supabase
    .from("bank_transactions")
    .select("dedupe_hash")
    .in("dedupe_hash", hashes)
  const existingHashes = new Set((existing ?? []).map((r) => r.dedupe_hash))

  const newRows = input.rows.filter(
    (row) => !existingHashes.has(dedupeHash(account.account_number, row))
  )
  const skipped = input.rows.length - newRows.length

  // Category id → type, so auto-created expenses inherit fixed/variable.
  const { data: categories } = await supabase
    .from("expense_categories")
    .select("id, type")
  const categoryType = new Map(
    (categories ?? []).map((c) => [c.id, c.type as "fixed" | "variable"])
  )

  const dates = input.rows.map((row) => row.isoDate).sort()
  const periodStart = input.periodStart ?? dates[0] ?? null
  const periodEnd = input.periodEnd ?? dates[dates.length - 1] ?? null

  const { data: importRow, error: importError } = await supabase
    .from("bank_statement_imports")
    .insert({
      account_id: input.accountId,
      filename: input.filename,
      period_start: periodStart,
      period_end: periodEnd,
      row_count: input.rows.length,
      imported_count: newRows.length,
      skipped_count: skipped,
      imported_by: user?.id ?? null,
    })
    .select("id")
    .single()
  if (importError || !importRow) {
    return { error: importError?.message ?? "Could not record import" }
  }

  let imported = 0
  let expensesCreated = 0
  for (const row of newRows) {
    const { data: txn, error: txnError } = await supabase
      .from("bank_transactions")
      .insert({
        account_id: input.accountId,
        import_id: importRow.id,
        txn_date: row.isoDate,
        payee: row.payee || null,
        counterparty_account: row.counterpartyAccount || null,
        txn_type: row.txnType || null,
        direction: row.direction,
        description: row.description || null,
        reference: row.reference || null,
        status: row.status || null,
        amount_cents: row.amountCents,
        currency: row.currency || "usd",
        balance_cents: row.balanceCents,
        flow_class: row.flowClass,
        matched_payout_id: row.matchedPayoutId,
        dedupe_hash: dedupeHash(account.account_number, row),
      })
      .select("id")
      .single()
    if (txnError || !txn) continue
    imported++

    // Auto-create a linked expense for real (external) spends.
    if (row.createExpense && row.flowClass === "external_expense") {
      const type = row.suggestedCategoryId
        ? (categoryType.get(row.suggestedCategoryId) ?? "variable")
        : "variable"
      const { data: expense } = await supabase
        .from("expenses")
        .insert({
          description: row.payee || row.description || "Bank transaction",
          amount: Math.abs(row.amountCents) / 100,
          category_id: row.suggestedCategoryId,
          type,
          date: row.isoDate,
          is_paid: true,
          paid_at: `${row.isoDate}T00:00:00Z`,
          recurring_expense_id: row.matchedRecurringId,
          bank_transaction_id: txn.id,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single()
      if (expense) {
        expensesCreated++
        await supabase
          .from("bank_transactions")
          .update({ expense_id: expense.id })
          .eq("id", txn.id)
      }
    }
  }

  revalidatePath("/financials")
  return { error: null, imported, skipped, expensesCreated }
}

export async function addBankTransactionToExpense(transactionId: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: txn, error: txnError } = await supabase
    .from("bank_transactions")
    .select(
      "id, payee, description, amount_cents, txn_date, txn_type, counterparty_account, reference, status, currency, balance_cents, expense_id"
    )
    .eq("id", transactionId)
    .single()
  if (txnError || !txn) return { error: "Transaction not found" }
  if (txn.expense_id) return { error: "This transaction is already an expense" }

  const [{ data: categories }, { data: recurring }] = await Promise.all([
    supabase.from("expense_categories").select("id, name, type"),
    supabase
      .from("recurring_expenses")
      .select("id, description, amount, type, is_active"),
  ])

  // Recompute the category/recurring suggestions the same way the importer does.
  const row: RawBankRow = {
    isoDate: txn.txn_date,
    payee: txn.payee ?? "",
    counterpartyAccount: txn.counterparty_account ?? "",
    txnType: txn.txn_type ?? "",
    description: txn.description ?? "",
    reference: txn.reference ?? "",
    status: txn.status ?? "",
    amountCents: Number(txn.amount_cents),
    currency: txn.currency ?? "usd",
    balanceCents: txn.balance_cents == null ? null : Number(txn.balance_cents),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categoryId = suggestCategoryId(row.payee, (categories ?? []) as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recurringId = matchRecurring(row, (recurring ?? []) as any)
  const type =
    (categoryId &&
      (categories ?? []).find((c) => c.id === categoryId)?.type) ||
    "variable"

  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .insert({
      description: txn.payee || txn.description || "Bank transaction",
      amount: Math.abs(Number(txn.amount_cents)) / 100,
      category_id: categoryId,
      type,
      date: txn.txn_date,
      is_paid: true,
      paid_at: `${txn.txn_date}T00:00:00Z`,
      recurring_expense_id: recurringId,
      bank_transaction_id: txn.id,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()
  if (expenseError || !expense) {
    return { error: expenseError?.message ?? "Could not create expense" }
  }

  await supabase
    .from("bank_transactions")
    .update({ expense_id: expense.id })
    .eq("id", txn.id)

  revalidatePath("/financials")
  return { error: null }
}
