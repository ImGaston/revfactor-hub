"use server"

import { revalidatePath } from "next/cache"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { listingExitSchema } from "@/lib/churn"

export async function tagListingExitAction(
  input: unknown
): Promise<{ error: string | null }> {
  const [canEdit, canView, canEditListing, canViewClient] = await Promise.all([
    hasPermission("churn", "edit"),
    hasPermission("churn", "view"),
    hasPermission("listings", "edit"),
    hasPermission("clients", "view"),
  ])
  if (!canEdit || !canView || !canEditListing || !canViewClient)
    return { error: "Not authorized to tag listing exits." }
  const parsed = listingExitSchema.safeParse(input)
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid exit details." }
  const value = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("tag_listing_exit", {
    p_listing_id: value.listingId,
    p_reason: value.reason,
    p_note: value.note,
    p_handled_by: value.handledBy,
    p_stripe_item_status: value.stripeItemStatus,
  })
  if (error) return { error: error.message }
  if (!data)
    return { error: "Listing exit was not saved. Refresh and try again." }
  revalidatePath("/churn")
  revalidatePath("/settings/listings")
  revalidatePath(`/clients`)
  return { error: null }
}
