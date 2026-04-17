-- Archive flag for tasks
ALTER TABLE tasks
  ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX idx_tasks_is_archived ON tasks(is_archived);
