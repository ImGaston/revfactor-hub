-- Add listing counts to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS listing_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS child_listing_count integer DEFAULT 0;

-- Lead notes table
CREATE TABLE IF NOT EXISTS lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);

-- RLS
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead notes"
  ON lead_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert lead notes"
  ON lead_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Authors can update their own notes"
  ON lead_notes FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id);

CREATE POLICY "Authors can delete their own notes"
  ON lead_notes FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);
