-- Governed visual Agent Flows for the Knowledge workspace.
-- Graphs compile into observable operating instructions; they do not execute
-- arbitrary code or create external side effects.

CREATE TABLE agent_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 120),
  description TEXT CHECK (description IS NULL OR CHAR_LENGTH(description) <= 500),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_agent_flows_name_active
  ON agent_flows (LOWER(name))
  WHERE archived_at IS NULL;
CREATE INDEX idx_agent_flows_updated
  ON agent_flows (updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE agent_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES agent_flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'testing', 'approved', 'production', 'archived')),
  graph JSONB NOT NULL CHECK (
    JSONB_TYPEOF(graph) = 'object'
    AND JSONB_TYPEOF(graph -> 'nodes') = 'array'
    AND JSONB_TYPEOF(graph -> 'edges') = 'array'
  ),
  compiled_instructions TEXT NOT NULL
    CHECK (CHAR_LENGTH(compiled_instructions) BETWEEN 20 AND 50000),
  change_note TEXT CHECK (change_note IS NULL OR CHAR_LENGTH(change_note) <= 500),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  promoted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, version)
);

CREATE UNIQUE INDEX idx_agent_flow_one_production
  ON agent_flow_versions (flow_id)
  WHERE status = 'production';
CREATE INDEX idx_agent_flow_versions_recent
  ON agent_flow_versions (flow_id, version DESC);
CREATE INDEX idx_agent_flow_versions_status
  ON agent_flow_versions (status, updated_at DESC);

CREATE TABLE agent_flow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES agent_flows(id) ON DELETE CASCADE,
  version_id UUID REFERENCES agent_flow_versions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'flow_created',
      'draft_saved',
      'version_created',
      'moved_to_testing',
      'approved',
      'promoted_to_production',
      'archived'
    )
  ),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_flow_events_recent
  ON agent_flow_events (flow_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_agent_flow_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_event_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'agent_flows' AND TG_OP = 'INSERT' THEN
    INSERT INTO agent_flow_events (flow_id, event_type, created_by, details)
    VALUES (NEW.id, 'flow_created', auth.uid(), '{}'::JSONB);
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'agent_flow_versions' AND TG_OP = 'INSERT' THEN
    INSERT INTO agent_flow_events (
      flow_id, version_id, event_type, created_by, details
    ) VALUES (
      NEW.flow_id,
      NEW.id,
      'version_created',
      auth.uid(),
      JSONB_BUILD_OBJECT('version', NEW.version)
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'agent_flow_versions' AND TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      audit_event_type := CASE NEW.status
        WHEN 'testing' THEN 'moved_to_testing'
        WHEN 'approved' THEN 'approved'
        WHEN 'production' THEN 'promoted_to_production'
        WHEN 'archived' THEN 'archived'
        ELSE NULL
      END;
    ELSIF NEW.graph IS DISTINCT FROM OLD.graph
       OR NEW.change_note IS DISTINCT FROM OLD.change_note THEN
      audit_event_type := 'draft_saved';
    END IF;

    IF audit_event_type IS NOT NULL THEN
      INSERT INTO agent_flow_events (
        flow_id, version_id, event_type, created_by, details
      ) VALUES (
        NEW.flow_id,
        NEW.id,
        audit_event_type,
        auth.uid(),
        JSONB_BUILD_OBJECT(
          'version', NEW.version,
          'from', OLD.status,
          'to', NEW.status
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_agent_flow_changes()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_agent_flow_created_audit
  AFTER INSERT ON agent_flows
  FOR EACH ROW EXECUTE FUNCTION public.audit_agent_flow_changes();
CREATE TRIGGER trg_agent_flow_version_audit
  AFTER INSERT OR UPDATE ON agent_flow_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_agent_flow_changes();

CREATE TRIGGER trg_agent_flows_updated_at
  BEFORE UPDATE ON agent_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_agent_flow_versions_updated_at
  BEFORE UPDATE ON agent_flow_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_agent_flow_version_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.graph IS DISTINCT FROM OLD.graph
    OR NEW.compiled_instructions IS DISTINCT FROM OLD.compiled_instructions
    OR NEW.change_note IS DISTINCT FROM OLD.change_note
  ) THEN
    RAISE EXCEPTION 'Create a new draft to edit a non-draft Agent Flow version';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('testing', 'archived'))
      OR (OLD.status = 'testing' AND NEW.status IN ('approved', 'archived'))
      OR (OLD.status = 'approved' AND NEW.status IN ('production', 'archived'))
      OR (OLD.status = 'production' AND NEW.status = 'archived')
    ) THEN
      RAISE EXCEPTION 'Invalid Agent Flow lifecycle transition: % to %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'approved'
       AND NOT public.has_permission('knowledge', 'publish') THEN
      RAISE EXCEPTION 'knowledge:publish is required to approve an Agent Flow';
    END IF;

    IF (NEW.status = 'production' OR OLD.status = 'production')
       AND NOT public.has_permission('agent_studio', 'control') THEN
      RAISE EXCEPTION 'agent_studio:control is required for production Agent Flows';
    END IF;

    IF NEW.status = 'approved' THEN
      NEW.approved_by := auth.uid();
      NEW.approved_at := NOW();
    ELSIF NEW.status = 'production' THEN
      NEW.promoted_by := auth.uid();
      NEW.promoted_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_agent_flow_version_governance()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_agent_flow_version_governance
  BEFORE UPDATE ON agent_flow_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_flow_version_governance();

ALTER TABLE agent_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_flow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Knowledge viewers can view Agent Flows"
  ON agent_flows FOR SELECT TO authenticated
  USING (public.has_permission('knowledge', 'view'));
CREATE POLICY "Knowledge creators can create Agent Flows"
  ON agent_flows FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('knowledge', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Knowledge editors can edit Agent Flows"
  ON agent_flows FOR UPDATE TO authenticated
  USING (public.has_permission('knowledge', 'edit'))
  WITH CHECK (public.has_permission('knowledge', 'edit'));
CREATE POLICY "Knowledge deleters can delete Agent Flows"
  ON agent_flows FOR DELETE TO authenticated
  USING (public.has_permission('knowledge', 'delete'));

CREATE POLICY "Knowledge viewers can view Agent Flow versions"
  ON agent_flow_versions FOR SELECT TO authenticated
  USING (public.has_permission('knowledge', 'view'));
CREATE POLICY "Knowledge builders can create Agent Flow versions"
  ON agent_flow_versions FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_permission('knowledge', 'create')
      OR public.has_permission('knowledge', 'edit')
    )
    AND created_by = auth.uid()
    AND status = 'draft'
  );
CREATE POLICY "Knowledge editors can update Agent Flow versions"
  ON agent_flow_versions FOR UPDATE TO authenticated
  USING (public.has_permission('knowledge', 'edit'))
  WITH CHECK (public.has_permission('knowledge', 'edit'));
CREATE POLICY "Knowledge publishers can update Agent Flow versions"
  ON agent_flow_versions FOR UPDATE TO authenticated
  USING (public.has_permission('knowledge', 'publish'))
  WITH CHECK (public.has_permission('knowledge', 'publish'));
CREATE POLICY "Agent controllers can update Agent Flow versions"
  ON agent_flow_versions FOR UPDATE TO authenticated
  USING (public.has_permission('agent_studio', 'control'))
  WITH CHECK (public.has_permission('agent_studio', 'control'));
CREATE POLICY "Knowledge deleters can delete draft Agent Flow versions"
  ON agent_flow_versions FOR DELETE TO authenticated
  USING (
    public.has_permission('knowledge', 'delete')
    AND status = 'draft'
  );

CREATE POLICY "Knowledge viewers can view Agent Flow events"
  ON agent_flow_events FOR SELECT TO authenticated
  USING (public.has_permission('knowledge', 'view'));
CREATE POLICY "Knowledge builders can create Agent Flow events"
  ON agent_flow_events FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_permission('knowledge', 'create')
      OR public.has_permission('knowledge', 'edit')
      OR public.has_permission('knowledge', 'publish')
      OR public.has_permission('agent_studio', 'control')
    )
    AND created_by = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.transition_agent_flow_version(
  p_version_id UUID,
  p_target_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  target_version agent_flow_versions%ROWTYPE;
BEGIN
  IF p_target_status NOT IN ('testing', 'approved', 'production', 'archived') THEN
    RAISE EXCEPTION 'Unsupported Agent Flow status';
  END IF;

  SELECT * INTO target_version
  FROM agent_flow_versions
  WHERE id = p_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent Flow version not found';
  END IF;

  IF p_target_status = 'production' THEN
    UPDATE agent_flow_versions
    SET status = 'archived'
    WHERE flow_id = target_version.flow_id
      AND status = 'production'
      AND id <> p_version_id;
  END IF;

  UPDATE agent_flow_versions
  SET status = p_target_status
  WHERE id = p_version_id;

  RETURN p_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_agent_flow_version(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_agent_flow_version(UUID, TEXT)
  TO authenticated;
