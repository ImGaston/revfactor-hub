-- ============================================================
-- 023: Reservations table - TODAVIA NO SE CORRIO
-- Forward-looking reservations data sourced from PMS systems.
-- Powers the Pacing Chart on the dashboard home.
-- ============================================================

CREATE TABLE reservations (
  row_key TEXT PRIMARY KEY,
  pms_name TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  listing_name TEXT,
  reservation_id TEXT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  booking_status TEXT NOT NULL,
  booked_date DATE,
  rental_revenue FLOAT8,
  total_cost FLOAT8,
  no_of_days INT8,
  currency TEXT,
  cancelled_on DATE,
  min_price_type TEXT,
  cleaning_fees FLOAT8,
  booking_channel TEXT,
  channel_confirmation_code TEXT,
  source_api_window_start DATE,
  source_api_window_end DATE,
  first_seen_in_source_at TIMESTAMPTZ,
  last_seen_in_source_at TIMESTAMPTZ,
  last_refresh_run_at TIMESTAMPTZ,
  last_refresh_window_type TEXT,
  missing_from_latest_window BOOLEAN DEFAULT FALSE,
  missing_from_source_count INT8 DEFAULT 0,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  raw_json JSONB
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_reservations_listing ON reservations(listing_id);
CREATE INDEX idx_reservations_check_in ON reservations(check_in);
CREATE INDEX idx_reservations_check_out ON reservations(check_out);
CREATE INDEX idx_reservations_booking_status ON reservations(booking_status);
CREATE INDEX idx_reservations_window ON reservations(booking_status, check_out, check_in);

-- ============================================================
-- RLS — authenticated users can view, super_admin writes
-- ============================================================
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view reservations"
  ON reservations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can insert reservations"
  ON reservations FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update reservations"
  ON reservations FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete reservations"
  ON reservations FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

COMMENT ON TABLE reservations IS 'Forward-looking reservation data from PMS sync; source for the Pacing Chart.';
COMMENT ON COLUMN reservations.row_key IS 'Stable composite key, typically "${pms_name}_${reservation_id}"';
COMMENT ON COLUMN reservations.cancelled_on IS 'Date the reservation was cancelled. NULL if active. A reservation still counts toward stay nights that occurred before this date.';
