-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  owner TEXT,
  tag TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'waiting', 'done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task-Listings junction (many-to-many)
CREATE TABLE task_listings (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, listing_id)
);

-- Roadmap items table
CREATE TABLE roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  tag TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'planned', 'in_progress', 'done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_client_id ON tasks(client_id);
CREATE INDEX idx_task_listings_task ON task_listings(task_id);
CREATE INDEX idx_task_listings_listing ON task_listings(listing_id);
CREATE INDEX idx_roadmap_items_status ON roadmap_items(status);

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;

-- All authenticated users can CRUD tasks and roadmap
CREATE POLICY "Authenticated users can view tasks"
  ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tasks"
  ON tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete tasks"
  ON tasks FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view task_listings"
  ON task_listings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert task_listings"
  ON task_listings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete task_listings"
  ON task_listings FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view roadmap_items"
  ON roadmap_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert roadmap_items"
  ON roadmap_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update roadmap_items"
  ON roadmap_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete roadmap_items"
  ON roadmap_items FOR DELETE TO authenticated USING (true);
