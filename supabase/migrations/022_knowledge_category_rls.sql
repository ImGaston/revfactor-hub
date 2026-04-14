-- ============================================================
-- 022: Allow authenticated users to manage knowledge categories & tags
-- Adds INSERT/UPDATE/DELETE policies (migration 021 only had SELECT).
-- Permission enforcement happens in server actions, not RLS.
-- ============================================================

-- knowledge_categories
CREATE POLICY "Authenticated users can insert knowledge_categories"
  ON knowledge_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update knowledge_categories"
  ON knowledge_categories FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete knowledge_categories"
  ON knowledge_categories FOR DELETE TO authenticated USING (true);

-- knowledge_tags
CREATE POLICY "Authenticated users can insert knowledge_tags"
  ON knowledge_tags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update knowledge_tags"
  ON knowledge_tags FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete knowledge_tags"
  ON knowledge_tags FOR DELETE TO authenticated USING (true);
