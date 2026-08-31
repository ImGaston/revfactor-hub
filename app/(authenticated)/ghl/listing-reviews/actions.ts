"use server"

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { emptyListingReviewDraft } from "@/lib/listing-reviews"
import { createClient } from "@/lib/supabase/server"

export async function createListingReviewRequestAction(input: {
  leadId: string
  appointmentOwnerProfileId: string
  federicoProfileId: string
  propertyCount: number
  ghlContactId?: string
  ghlAppointmentId?: string
}) {
  if (!(await hasPermission("ghl", "create"))) {
    return {
      error: "You do not have permission to create listing reviews.",
    } as const
  }
  if (
    !Number.isInteger(input.propertyCount) ||
    input.propertyCount < 1 ||
    input.propertyCount > 3
  ) {
    return { error: "Choose between one and three properties." } as const
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return { error: "Your session expired. Log in and try again." } as const

  const [{ data: lead }, { data: profiles }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, full_name, email, project_name")
      .eq("id", input.leadId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [input.appointmentOwnerProfileId, input.federicoProfileId]),
  ])

  if (!lead?.email)
    return { error: "The selected lead needs an email address." } as const
  const owner = profiles?.find(
    (profile) => profile.id === input.appointmentOwnerProfileId
  )
  const federico = profiles?.find(
    (profile) => profile.id === input.federicoProfileId
  )
  if (!owner || !federico)
    return { error: "Select both the appointment owner and Federico." } as const

  const { data: request, error } = await supabase
    .from("listing_review_requests")
    .insert({
      lead_id: lead.id,
      ghl_contact_id: input.ghlContactId?.trim() || null,
      ghl_appointment_id: input.ghlAppointmentId?.trim() || null,
      prospect_name: lead.full_name?.trim() || lead.project_name,
      prospect_email: lead.email,
      appointment_owner_profile_id: owner.id,
      appointment_owner_name: owner.full_name?.trim() || owner.email,
      appointment_owner_email: owner.email,
      federico_profile_id: federico.id,
      federico_name: federico.full_name?.trim() || federico.email,
      federico_email: federico.email,
      property_count: input.propertyCount,
      draft_payload: emptyListingReviewDraft(input.propertyCount),
      requested_by: user.id,
    })
    .select("id, public_token")
    .single()

  if (error || !request)
    return {
      error: error?.message ?? "The listing review could not be created.",
    } as const

  await supabase.from("listing_review_events").insert({
    request_id: request.id,
    event_type: "created",
    actor_type: "internal",
    actor_profile_id: user.id,
  })

  revalidatePath("/ghl/listing-reviews")
  return { success: true, token: request.public_token } as const
}
