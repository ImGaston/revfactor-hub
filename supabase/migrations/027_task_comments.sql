-- Task comments
CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);
CREATE INDEX idx_task_comments_created ON task_comments(created_at);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view task_comments"
  ON task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert task_comments"
  ON task_comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors can update own task_comments"
  ON task_comments FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "Authors can delete own task_comments"
  ON task_comments FOR DELETE TO authenticated USING (author_id = auth.uid());
