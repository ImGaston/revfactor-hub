"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceLabsConfigured } from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"

type ListingInput = {
  client_id: string
  name: string
  status: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

export async function getClientOptionsAction(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .order("name")
  return data ?? []
}

export async function createListingAction(input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").insert(input)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateListingAction(id: string, input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").update(input).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function deleteListingAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateListingStatusAction(
  id: string,
  status: "active" | "inactive"
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("listings")
    .update({ status })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function syncPriceLabsAction() {
  if (!isPriceLabsConfigured()) {
    return {
      error: "PRICELABS_API_KEY not configured",
      synced: 0,
      notFound: 0,
      failed: 0,
      totalDb: 0,
      totalPriceLabs: 0,
      results: [],
    }
  }

  try {
    const result = await syncPriceLabsData(createAdminClient())

    revalidatePath("/settings/listings")
    revalidatePath("/listings")
    revalidatePath("/clients")
    revalidatePath("/dashboard")
    return { error: null, ...result }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      synced: 0,
      notFound: 0,
      failed: 0,
      totalDb: 0,
      totalPriceLabs: 0,
      results: [],
    }
  }
}
