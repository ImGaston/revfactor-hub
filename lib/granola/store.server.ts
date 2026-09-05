import { createAdminClient } from "@/lib/supabase/admin"
import type {
  GranolaAppointmentLookup,
  GranolaImportCheckpoint,
  GranolaImportStore,
  GranolaInternalSummary,
  GranolaProcessedNote,
  GranolaSalesAppointment,
  GranolaSummarySink,
} from "@/lib/granola/types"

type AdminClient = ReturnType<typeof createAdminClient>

type AppointmentRow = {
  appointment_id: string
  calendar_event_id: string | null
  rep_email: string
  scheduled_start_at: string
  attendee_emails: string[] | null
}

export class SupabaseGranolaPersistence
  implements GranolaImportStore, GranolaSummarySink
{
  constructor(private readonly client: AdminClient = createAdminClient()) {}

  async getCheckpoint(
    sourceId: string
  ): Promise<GranolaImportCheckpoint | null> {
    const { data, error } = await this.client
      .from("granola_import_checkpoints")
      .select("updated_after,cursor,pending_high_watermark")
      .eq("source_id", sourceId)
      .maybeSingle()
    if (error) throw new Error("Granola checkpoint read failed")
    if (!data) return null
    return {
      updatedAfter: data.updated_after,
      cursor: data.cursor,
      pendingHighWatermark: data.pending_high_watermark,
    }
  }

  async saveCheckpoint(
    sourceId: string,
    checkpoint: GranolaImportCheckpoint
  ): Promise<void> {
    const { error } = await this.client
      .from("granola_import_checkpoints")
      .upsert(
        {
          source_id: sourceId,
          updated_after: checkpoint.updatedAfter,
          cursor: checkpoint.cursor,
          pending_high_watermark: checkpoint.pendingHighWatermark,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_id" }
      )
    if (error) throw new Error("Granola checkpoint write failed")
  }

  async hasProcessedNote(input: {
    noteId: string
    updatedAt: string
  }): Promise<boolean> {
    const { data, error } = await this.client
      .from("granola_processed_notes")
      .select("note_id")
      .eq("note_id", input.noteId)
      .eq("note_updated_at", input.updatedAt)
      .maybeSingle()
    if (error) throw new Error("Granola processed-note read failed")
    return data !== null
  }

  async findEligibleSalesAppointments(
    lookup: GranolaAppointmentLookup
  ): Promise<GranolaSalesAppointment[]> {
    const rows = new Map<string, AppointmentRow>()

    if (lookup.calendarEventId) {
      const { data, error } = await this.client
        .from("granola_sales_appointment_map")
        .select(
          "appointment_id,calendar_event_id,rep_email,scheduled_start_at,attendee_emails"
        )
        .eq("eligible_for_granola_import", true)
        .eq("calendar_event_id", lookup.calendarEventId)
        .limit(3)
      if (error) throw new Error("Granola appointment lookup failed")
      for (const row of (data ?? []) as AppointmentRow[]) {
        rows.set(row.appointment_id, row)
      }
    }

    if (
      lookup.repEmail &&
      lookup.scheduledStartAt &&
      lookup.attendeeEmails.length > 0
    ) {
      const { data, error } = await this.client
        .from("granola_sales_appointment_map")
        .select(
          "appointment_id,calendar_event_id,rep_email,scheduled_start_at,attendee_emails"
        )
        .eq("eligible_for_granola_import", true)
        .eq("rep_email", lookup.repEmail)
        .eq("scheduled_start_at", lookup.scheduledStartAt)
        .limit(25)
      if (error) throw new Error("Granola appointment lookup failed")
      if ((data?.length ?? 0) >= 25)
        throw new Error("Granola appointment candidates truncated")
      for (const row of (data ?? []) as AppointmentRow[]) {
        rows.set(row.appointment_id, row)
      }
    }

    return [...rows.values()].map((row) => ({
      id: row.appointment_id,
      kind: "revfactor_sales",
      calendarEventId: row.calendar_event_id,
      repEmail: row.rep_email,
      scheduledStartAt: row.scheduled_start_at,
      attendeeEmails: row.attendee_emails ?? [],
    }))
  }

  async recordProcessedNote(input: GranolaProcessedNote): Promise<void> {
    const { error } = await this.client.from("granola_processed_notes").upsert(
      {
        note_id: input.noteId,
        note_updated_at: input.updatedAt,
        source_id: input.sourceId,
        outcome: input.outcome,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "note_id,note_updated_at", ignoreDuplicates: true }
    )
    if (error) throw new Error("Granola processed-note write failed")
  }

  async upsertInternalSummary(summary: GranolaInternalSummary): Promise<void> {
    const { error } = await this.client
      .from("granola_appointment_summaries")
      .upsert(
        {
          note_id: summary.noteId,
          note_updated_at: summary.noteUpdatedAt,
          appointment_id: summary.appointmentId,
          source_id: summary.sourceId,
          source_url: safeGranolaUrl(summary.sourceUrl),
          summary_text: summary.summaryText,
          summary_markdown: summary.summaryMarkdown,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "note_id,note_updated_at", ignoreDuplicates: true }
      )
    if (error) throw new Error("Granola internal summary write failed")
  }
}

export function createGranolaPersistence(): SupabaseGranolaPersistence {
  return new SupabaseGranolaPersistence()
}

function safeGranolaUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "notes.granola.ai"
      ? url.toString()
      : null
  } catch {
    return null
  }
}
