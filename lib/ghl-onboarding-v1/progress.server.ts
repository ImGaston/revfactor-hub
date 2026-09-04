import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { JourneySchema, missingRequirements } from "./domain"
import { highlevelFetch, requiredEnv } from "./providers.server"

/** Internal CRM fields only. Never sends a message or enrolls a contact. */
export async function projectGhlProgress() {
  if (
    process.env.GHL_V1_ENABLED !== "true" ||
    process.env.GHL_V1_PROGRESS_ENABLED !== "true"
  )
    return { status: "disabled" }
  const db = createAdminClient()
  const { data: claimed, error } = await db.rpc("claim_ghl_onboarding_job", {
    p_kind: "ghl_progress",
  })
  if (error) throw new Error("progress_claim_failed")
  const job = claimed?.[0]
  if (!job) return { status: "idle" }
  let revision: number | null = null
  async function finish(
    outcome: "projected" | "superseded" | "failed" | "manual_review",
    code: string | null = null
  ) {
    const { data, error: finishError } = await db.rpc(
      "finish_ghl_progress_v1",
      {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_revision: revision,
        p_outcome: outcome,
        p_code: code,
      }
    )
    if (finishError) throw new Error("progress_finish_failed")
    return data === true
  }
  try {
    const { data: row, error: readError } = await db
      .from("ghl_onboarding_journeys")
      .select("id,payload,revision,created_at")
      .eq("id", job.journey_id)
      .single()
    if (readError || !row) throw new Error("progress_journey_unavailable")
    revision = row.revision
    const journey = JourneySchema.parse(row.payload)
    const { data: others, error: otherError } = await db
      .from("ghl_onboarding_journeys")
      .select("id,created_at,stage")
      .eq("contact_id", journey.contactId)
      .neq("id", journey.id)
    if (otherError) throw new Error("progress_identity_unavailable")
    // Match the database ordering, including a deterministic tie break.
    if (
      others?.some(
        (r) =>
          r.created_at > row.created_at ||
          (r.created_at === row.created_at && r.id > row.id)
      )
    ) {
      return {
        status: (await finish("superseded")) ? "superseded" : "stale_lease",
      }
    }
    if (others?.some((r) => !["portal_active", "exception"].includes(r.stage)))
      throw new Error("progress_ambiguous_journey")
    const nextAction = journey.manualTakeover
      ? "Team follow-up"
      : {
          signup: "Complete signup",
          awaiting_payment: "Complete agreement and payment",
          onboarding: "Complete property onboarding",
          submitted: "Portal invitation pending",
          portal_invited: "Open your Assembly invitation",
          portal_active: "Continue in Assembly",
          exception: "Team follow-up",
        }[journey.stage]
    const fields = [
      ["GHL_V1_FIELD_JOURNEY_ID", journey.id],
      ["GHL_V1_FIELD_STAGE", journey.stage],
      [
        "GHL_V1_FIELD_MISSING",
        missingRequirements(journey)
          .filter((s) => !s.startsWith("billing:"))
          .join("\n"),
      ],
      ["GHL_V1_FIELD_REVISION", String(row.revision)],
      ["GHL_V1_FIELD_NEXT_ACTION", nextAction],
    ].map(([name, value]) => ({ id: requiredEnv(name), field_value: value }))
    // Verify contact location before writing configured fields. PUT repeats only an
    // idempotent field assignment; client notification/enrollment is not performed.
    const contact = (await highlevelFetch(
      `/contacts/${encodeURIComponent(journey.contactId)}`
    )) as { contact?: { id?: string; locationId?: string } }
    if (
      contact.contact?.id !== journey.contactId ||
      contact.contact.locationId !== requiredEnv("HIGHLEVEL_LOCATION_ID")
    )
      throw new Error("progress_contact_mismatch")
    // Recheck the lease before the external mutation. Pause revokes this lease and
    // schedules a fresh projection after a short drain window for an in-flight PUT.
    const { data: lease, error: leaseError } = await db
      .from("ghl_onboarding_jobs")
      .select("id")
      .eq("id", job.id)
      .eq("status", "running")
      .eq("lease_token", job.lease_token)
      .gt("lease_until", new Date().toISOString())
      .maybeSingle()
    if (leaseError) throw new Error("progress_lease_unavailable")
    if (!lease) return { status: "stale_lease" }
    await highlevelFetch(`/contacts/${encodeURIComponent(journey.contactId)}`, {
      method: "PUT",
      body: JSON.stringify({ customFields: fields }),
    })
    return { status: (await finish("projected")) ? "projected" : "stale_lease" }
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : ""
    const permanent =
      [
        "progress_ambiguous_journey",
        "progress_contact_mismatch",
        "signed_property_correction_requires_review",
      ].includes(code) ||
      /^highlevel_http_(400|401|403|404)$/.test(code) ||
      code.startsWith("missing_configuration:")
    const reason =
      code === "progress_ambiguous_journey"
        ? code
        : code === "progress_contact_mismatch"
          ? code
          : permanent
            ? "progress_configuration_or_identity_invalid"
            : "progress_projection_failed"
    const outcome = permanent ? "manual_review" : "failed"
    if (!(await finish(outcome, reason))) return { status: "stale_lease" }
    return { status: outcome, reason }
  }
}
