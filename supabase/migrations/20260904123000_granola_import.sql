-- Internal-only Granola import state and summaries. No table is exposed to
-- authenticated Hub users; the server-side service role owns this pipeline.

CREATE TABLE granola_sales_appointment_map (
  appointment_id TEXT PRIMARY KEY,
  calendar_event_id TEXT,
  rep_email TEXT NOT NULL,
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  attendee_emails TEXT[] NOT NULL DEFAULT '{}',
  eligible_for_granola_import BOOLEAN NOT NULL DEFAULT FALSE,
  eligibility_source TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT granola_sales_map_rep_email_normalized
    CHECK (rep_email = LOWER(BTRIM(rep_email))),
  CONSTRAINT granola_sales_map_calendar_event_trimmed
    CHECK (
      calendar_event_id IS NULL
      OR calendar_event_id = BTRIM(calendar_event_id)
    ),
  CONSTRAINT granola_sales_map_has_match_path
    CHECK (
      NULLIF(BTRIM(calendar_event_id), '') IS NOT NULL
      OR CARDINALITY(attendee_emails) > 0
    )
);

COMMENT ON TABLE granola_sales_appointment_map IS
  'Explicit sales-appointment eligibility gate populated by a trusted GHL/calendar integration; never inferred from Granola.';
COMMENT ON COLUMN granola_sales_appointment_map.eligible_for_granola_import IS
  'Must be set true by the trusted appointment integration before a Granola note may attach.';

CREATE INDEX granola_sales_map_calendar_event_idx
  ON granola_sales_appointment_map (calendar_event_id)
  WHERE eligible_for_granola_import;
CREATE INDEX granola_sales_map_fallback_idx
  ON granola_sales_appointment_map (rep_email, scheduled_start_at)
  WHERE eligible_for_granola_import;

CREATE TABLE granola_import_checkpoints (
  source_id TEXT PRIMARY KEY,
  updated_after TIMESTAMPTZ NOT NULL,
  cursor TEXT,
  pending_high_watermark TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT granola_checkpoint_continuation_shape
    CHECK (
      (cursor IS NULL AND pending_high_watermark IS NULL)
      OR (cursor IS NOT NULL AND pending_high_watermark IS NOT NULL)
    )
);

CREATE TABLE granola_processed_notes (
  note_id TEXT NOT NULL,
  note_updated_at TIMESTAMPTZ NOT NULL,
  source_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('imported', 'unmatched', 'missing_summary')
  ),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, note_updated_at)
);

CREATE TABLE granola_appointment_summaries (
  note_id TEXT NOT NULL,
  note_updated_at TIMESTAMPTZ NOT NULL,
  appointment_id TEXT NOT NULL
    REFERENCES granola_sales_appointment_map(appointment_id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  source_url TEXT,
  summary_text TEXT,
  summary_markdown TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, note_updated_at),
  CONSTRAINT granola_summary_has_content
    CHECK (
      NULLIF(BTRIM(COALESCE(summary_text, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(summary_markdown, '')), '') IS NOT NULL
    )
);

CREATE INDEX granola_appointment_summaries_appointment_idx
  ON granola_appointment_summaries (appointment_id, note_updated_at DESC);

ALTER TABLE granola_sales_appointment_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE granola_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE granola_processed_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE granola_appointment_summaries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON granola_sales_appointment_map FROM anon, authenticated;
REVOKE ALL ON granola_import_checkpoints FROM anon, authenticated;
REVOKE ALL ON granola_processed_notes FROM anon, authenticated;
REVOKE ALL ON granola_appointment_summaries FROM anon, authenticated;

GRANT ALL ON granola_sales_appointment_map TO service_role;
GRANT ALL ON granola_import_checkpoints TO service_role;
GRANT ALL ON granola_processed_notes TO service_role;
GRANT ALL ON granola_appointment_summaries TO service_role;
