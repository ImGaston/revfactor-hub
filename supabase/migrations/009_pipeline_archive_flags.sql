-- ============================================================
-- 009: Pipeline archive/complete flags
-- Replaces "completed" and "archived" stages with boolean
-- flags, preserving the stage where the lead was when it
-- was archived or completed.
-- ============================================================

-- Add flag columns
ALTER TABLE leads ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN is_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN completed_at TIMESTAMPTZ;

-- Mutual exclusivity: a lead cannot be both archived and completed
ALTER TABLE leads ADD CONSTRAINT leads_archive_complete_exclusive
  CHECK (NOT (is_archived AND is_completed));

-- Migrate existing data before changing the CHECK constraint
-- completed → is_completed=true, keep stage='planning' (last active stage)
UPDATE leads
  SET is_completed = TRUE, completed_at = updated_at, stage = 'planning'
  WHERE stage = 'completed';

-- archived → is_archived=true, keep stage='inquiry' (default fallback)
UPDATE leads
  SET is_archived = TRUE, archived_at = updated_at, stage = 'inquiry'
  WHERE stage = 'archived';

-- Replace stage CHECK constraint: only 8 active stages
ALTER TABLE leads DROP CONSTRAINT leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN (
    'inquiry', 'follow_up', 'audit', 'meeting',
    'proposal_sent', 'proposal_signed', 'retainer_paid', 'planning'
  ));

-- Indexes for filtering
CREATE INDEX idx_leads_is_archived ON leads(is_archived);
CREATE INDEX idx_leads_is_completed ON leads(is_completed);
