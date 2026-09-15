-- Sidebar navigation groups (folders) managed from Settings > Navigation.
--
-- Lets the team file sidebar sections into collapsible folders (e.g. "Beta")
-- so day-to-day sections stay separate from experiments. The sections
-- themselves are still defined in code (`lib/navigation.ts`, keyed by a
-- stable `key`); the DB only stores how they are grouped and ordered.
-- Permission filtering of sections is unchanged: a section a role cannot
-- view is hidden whether or not it sits inside a folder.
--
-- Read: every signed-in user needs the config to render their sidebar and
-- it holds nothing sensitive (folder labels, icon names, ordering), same
-- class as `roles`. Writes: `settings:edit`.

CREATE TABLE nav_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  icon TEXT NOT NULL DEFAULT 'folder',
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_nav_groups_set_updated_at
  BEFORE UPDATE ON nav_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One row per section that has been placed in a folder. A section without a
-- row (or with group_id NULL) stays at the top level in code order.
CREATE TABLE nav_item_settings (
  item_key TEXT PRIMARY KEY,
  group_id UUID REFERENCES nav_groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nav_item_settings_group ON nav_item_settings(group_id, sort_order);

CREATE TRIGGER trg_nav_item_settings_set_updated_at
  BEFORE UPDATE ON nav_item_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE nav_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE nav_item_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read nav groups"
  ON nav_groups FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Settings editors can insert nav groups"
  ON nav_groups FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can update nav groups"
  ON nav_groups FOR UPDATE TO authenticated
  USING (public.has_permission('settings', 'edit'))
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can delete nav groups"
  ON nav_groups FOR DELETE TO authenticated
  USING (public.has_permission('settings', 'edit'));

CREATE POLICY "Signed-in users can read nav item settings"
  ON nav_item_settings FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Settings editors can insert nav item settings"
  ON nav_item_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can update nav item settings"
  ON nav_item_settings FOR UPDATE TO authenticated
  USING (public.has_permission('settings', 'edit'))
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can delete nav item settings"
  ON nav_item_settings FOR DELETE TO authenticated
  USING (public.has_permission('settings', 'edit'));
