import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createListingReviewDownloadUrl } from "@/lib/listing-reviews.server"
import { createClient } from "@/lib/supabase/server"
import { ListingReviewAdmin } from "./listing-review-admin"

export default async function ListingReviewsPage() {
  if (!(await hasPermission("ghl", "view"))) redirect("/")

  const supabase = await createClient()
  const [{ data: requests }, { data: leads }, { data: profiles }, canCreate] =
    await Promise.all([
      supabase
        .from("listing_review_requests")
        .select(
          `id, public_token, lead_id, prospect_name, prospect_email, status,
         property_count, revision, created_at, last_saved_at, submitted_at,
         appointment_owner_name, appointment_owner_email, federico_name, federico_email,
         listing_review_files(id, property_number, storage_path, file_name, mime_type, byte_size, uploaded_at),
         listing_review_notification_deliveries(id, recipient_email, recipient_name, recipient_roles, status, attempts, sent_at)`
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("leads")
        .select("id, full_name, email, project_name")
        .not("email", "is", null)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name"),
      hasPermission("ghl", "create"),
    ])

  const hydrated = await Promise.all(
    (requests ?? []).map(async (request) => ({
      ...request,
      listing_review_files: await Promise.all(
        (request.listing_review_files ?? []).map(async (file) => ({
          ...file,
          download_url: await createListingReviewDownloadUrl(file.storage_path),
        }))
      ),
    }))
  )

  return (
    <ListingReviewAdmin
      requests={hydrated}
      leads={leads ?? []}
      profiles={profiles ?? []}
      canCreate={canCreate}
    />
  )
}
