"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { isStripeConfigured, listCustomers, searchCustomersByEmail } from "@/lib/stripe"
import { syncStripeData } from "@/lib/stripe-sync"
import { getProfile } from "@/lib/supabase/profile"

// ─── Expenses ───────────────────────────────────────────

export async function createExpense(formData: FormData) {
  const description = formData.get("description") as string
  const amount = parseFloat(formData.get("amount") as string)
  const category_id = formData.get("category_id") as string
  const type = formData.get("type") as string
  const date = formData.get("date") as string
  const notes = formData.get("notes") as string

  if (!description) return { error: "Description is required" }
  if (isNaN(amount) || amount <= 0) return { error: "Valid amount is required" }
  if (!type) return { error: "Type is required" }
  if (!date) return { error: "Date is required" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from("expenses").insert({
    description,
    amount,
    category_id: category_id || null,
    type,
    date,
    notes: notes || null,
    created_by: user?.id ?? null,
  })

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function updateExpense(id: string, data: {
  description?: string
  amount?: number
  category_id?: string | null
  type?: string
  date?: string
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

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
    .update({ is_paid: true, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function markExpenseUnpaid(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({ is_paid: false, paid_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

// ─── Expense Categories ─────────────────────────────────

export async function createExpenseCategory(name: string, type: "fixed" | "variable") {
  if (!name) return { error: "Name is required" }

  const supabase = await createClient()
  const { error } = await supabase.from("expense_categories").insert({ name, type })

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function deleteExpenseCategory(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("expense_categories").delete().eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

// ─── Stripe Customer Linking ────────────────────────────
//
// Source of truth: `client_stripe_customers` junction (N Stripe customers → 1 Hub client).
// `clients.stripe_customer_id` is kept as a "primary" convenience pointer, set to the
// first linked customer and not automatically rebalanced afterwards.

export async function linkStripeCustomer(clientId: string, stripeCustomerId: string) {
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

export async function unlinkStripeCustomer(clientId: string, stripeCustomerId?: string) {
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
  if (!isStripeConfigured()) return { error: "Stripe is not configured", linked: 0 }

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
  const alreadyLinked = new Set((existing ?? []).map((r) => r.stripe_customer_id))

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

// ─── Recurring Expenses ─────────────────────────────────

export async function createRecurringExpense(formData: FormData) {
  const description = formData.get("description") as string
  const amount = parseFloat(formData.get("amount") as string)
  const category_id = formData.get("category_id") as string
  const type = formData.get("type") as string
  const day_of_month = parseInt(formData.get("day_of_month") as string, 10)
  const start_date = formData.get("start_date") as string
  const end_date = formData.get("end_date") as string
  const notes = formData.get("notes") as string

  if (!description) return { error: "Description is required" }
  if (isNaN(amount) || amount <= 0) return { error: "Valid amount is required" }
  if (!type) return { error: "Type is required" }
  if (isNaN(day_of_month) || day_of_month < 1 || day_of_month > 31) return { error: "Valid day of month (1-31) is required" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from("recurring_expenses").insert({
    description,
    amount,
    category_id: category_id || null,
    type,
    day_of_month,
    start_date: start_date || null,
    end_date: end_date || null,
    notes: notes || null,
    created_by: user?.id ?? null,
  })

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function updateRecurringExpense(id: string, data: {
  description?: string
  amount?: number
  category_id?: string | null
  type?: string
  day_of_month?: number
  is_active?: boolean
  start_date?: string | null
  end_date?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function deleteRecurringExpense(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("recurring_expenses").delete().eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function toggleRecurringExpenseActive(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/financials")
  return { error: null }
}

export async function generateMonthExpenses(yearMonth: string) {
  // yearMonth format: "YYYY-MM"
  const [yearStr, monthStr] = yearMonth.split("-")
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)

  if (!year || !month) return { error: "Invalid month format", generated: 0, skipped: 0 }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch all active recurring expenses
  const { data: recurring, error: fetchError } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("is_active", true)

  if (fetchError) return { error: fetchError.message, generated: 0, skipped: 0 }
  if (!recurring || recurring.length === 0) return { error: null, generated: 0, skipped: 0 }

  // Check which ones already have entries for this month
  const { data: existing } = await supabase
    .from("expenses")
    .select("recurring_expense_id")
    .eq("recurring_month", yearMonth)
    .not("recurring_expense_id", "is", null)

  const existingSet = new Set((existing ?? []).map((e) => e.recurring_expense_id))

  let generated = 0
  let skipped = 0

  for (const rec of recurring) {
    // Skip if already generated
    if (existingSet.has(rec.id)) {
      skipped++
      continue
    }

    // Check date bounds
    if (rec.start_date) {
      const startMonth = rec.start_date.substring(0, 7)
      if (yearMonth < startMonth) {
        skipped++
        continue
      }
    }
    if (rec.end_date) {
      const endMonth = rec.end_date.substring(0, 7)
      if (yearMonth > endMonth) {
        skipped++
        continue
      }
    }

    // Clamp day to last day of month
    const lastDay = new Date(year, month, 0).getDate()
    const day = Math.min(rec.day_of_month, lastDay)
    const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`

    const { error: insertError } = await supabase.from("expenses").insert({
      description: rec.description,
      amount: rec.amount,
      category_id: rec.category_id,
      type: rec.type,
      date: dateStr,
      notes: rec.notes,
      created_by: user?.id ?? null,
      recurring_expense_id: rec.id,
      recurring_month: yearMonth,
    })

    if (!insertError) {
      generated++
    }
  }

  revalidatePath("/financials")
  return { error: null, generated, skipped }
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
      warnings: [
        ...result.subscriptions.errors.map((e) => `subs: ${e}`),
        ...result.invoices.errors.map((e) => `invoices: ${e}`),
      ],
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" }
  }
}
