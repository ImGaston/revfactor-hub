-- Listing optimization reports: audit findings the team publishes to an owner's
-- Assembly portal, where the owner accepts or declines each suggestion.
-- An accepted change becomes an adjustment (type listing_content, origin client)
-- that the team applies through the co-host seat. Nothing is pushed automatically.

CREATE TABLE IF NOT EXISTS listing_optimization_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  airbnb_room_id TEXT,
  listing_title TEXT NOT NULL,
  listing_url TEXT,
  cover_photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  overall_score INTEGER CHECK (overall_score BETWEEN 0 AND 100),
  -- {"completion": 0-100, "structure": 0-100, "ota_style": 0-100, "seo": 0-100}
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"title": "C", "description": "B", ...}; keys match listing_optimization_items.section
  section_grades JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_line TEXT,
  summary TEXT,
  -- Standard checklist results: [{"id": "location.neighborhood", "status": "fail", "note": "..."}].
  -- Ids come from lib/listing-optimization-checks.ts; score and grades are computed from these.
  checks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array'),
  checklist_version TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent', 'grok', 'claude')),
  audited_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT listing_optimization_reports_published_shape CHECK (
    status <> 'published' OR published_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_listing_optimization_reports_client
  ON listing_optimization_reports(client_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS listing_optimization_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES listing_optimization_reports(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN (
    'title', 'description', 'photos', 'captions', 'amenities', 'location',
    'rules_settings', 'arrival', 'host_profile', 'other'
  )),
  -- change: owner accepts/declines, we apply it; owner_choice: owner decides with a
  -- trade-off, we apply it; owner_task: only the owner can do it in Airbnb (e.g.
  -- host profile), so the portal links them there; info: read-only finding.
  -- Listing content only: pricing findings belong to pricing work, not here.
  kind TEXT NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'owner_choice', 'owner_task', 'info')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL,
  rationale TEXT,
  current_value TEXT,
  proposed_value TEXT,
  -- Alternatives the owner can pick from (e.g. title options), JSON array of strings.
  options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  photo_url TEXT,
  -- The standard check this suggestion fixes (outcome = the check passes on re-audit).
  check_id TEXT,
  -- Where the owner makes an owner_task change (e.g. the Airbnb host profile editor).
  action_url TEXT CHECK (action_url IS NULL OR action_url LIKE 'https://%'),
  client_status TEXT NOT NULL DEFAULT 'pending' CHECK (client_status IN ('pending', 'accepted', 'declined')),
  client_choice TEXT,
  client_note TEXT,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  apply_status TEXT NOT NULL DEFAULT 'not_started' CHECK (apply_status IN (
    'not_started', 'queued', 'applied', 'verified', 'failed', 'skipped'
  )),
  adjustment_id UUID REFERENCES adjustments(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT listing_optimization_items_info_not_decided CHECK (
    kind <> 'info' OR client_status = 'pending'
  )
);

CREATE INDEX IF NOT EXISTS idx_listing_optimization_items_report
  ON listing_optimization_items(report_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_listing_optimization_items_apply_queue
  ON listing_optimization_items(apply_status, decided_at)
  WHERE client_status = 'accepted';

ALTER TABLE listing_optimization_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_optimization_items ENABLE ROW LEVEL SECURITY;

-- Internal Hub access is permission-based (migration 038). The owner portal reads
-- and writes through the server-side admin client only after validating the
-- Assembly session token and the client mapping.
CREATE POLICY "Listings users can view optimization reports"
  ON listing_optimization_reports FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings editors can create optimization reports"
  ON listing_optimization_reports FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can edit optimization reports"
  ON listing_optimization_reports FOR UPDATE TO authenticated
  USING (public.has_permission('listings', 'edit'))
  WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can delete optimization reports"
  ON listing_optimization_reports FOR DELETE TO authenticated
  USING (public.has_permission('listings', 'delete'));

CREATE POLICY "Listings users can view optimization items"
  ON listing_optimization_items FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings editors can create optimization items"
  ON listing_optimization_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can edit optimization items"
  ON listing_optimization_items FOR UPDATE TO authenticated
  USING (public.has_permission('listings', 'edit'))
  WITH CHECK (public.has_permission('listings', 'edit'));
CREATE POLICY "Listings editors can delete optimization items"
  ON listing_optimization_items FOR DELETE TO authenticated
  USING (public.has_permission('listings', 'delete'));

-- Accepted owner suggestions land in the existing Adjustments queue.
-- Superset of 089 so applying either order leaves both types valid.
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_type_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_type_check
  CHECK (type IN (
    'setup', 'min_stay', 'price', 'min_price', 'max_price', 'target_payout',
    'checkin_checkout', 'discount', 'markup_fees', 'availability', 'review',
    'recommendation', 'visibility', 'blocked_dates', 'pricing_flexibility',
    'cancellation_policy', 'listing_content', 'other'
  ));

-- Internal team files these; HostPricing does not edit Airbnb content.
INSERT INTO adjustment_type_settings (type, internal_enabled, hostpricing_enabled)
VALUES ('listing_content', TRUE, FALSE)
ON CONFLICT (type) DO NOTHING;

-- The team works accepted suggestions in the normal Adjustments flow. Resolving
-- the ticket marks the portal item applied; controlling it (checked live) marks
-- it live; rejecting it after acceptance marks it not applied.
CREATE OR REPLACE FUNCTION public.sync_listing_optimization_apply_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE listing_optimization_items
     SET apply_status = CASE NEW.status
           WHEN 'resolved' THEN 'applied'
           WHEN 'controlled' THEN 'verified'
           WHEN 'issue' THEN 'failed'
           WHEN 'rejected' THEN CASE WHEN client_status = 'accepted' THEN 'skipped' ELSE apply_status END
           ELSE CASE WHEN client_status = 'accepted' THEN 'queued' ELSE apply_status END
         END,
         applied_at = CASE WHEN NEW.status IN ('resolved', 'controlled') THEN COALESCE(applied_at, now()) ELSE applied_at END,
         updated_at = now()
   WHERE adjustment_id = NEW.id;

  IF NEW.status IN ('resolved', 'controlled') THEN
    INSERT INTO listing_optimization_events (report_id, item_id, action, actor_type, actor_id, details)
    SELECT i.report_id, i.id,
           CASE NEW.status WHEN 'resolved' THEN 'ApplyListingContent' ELSE 'VerifyListingContentLive' END,
           'staff', COALESCE(NEW.resolver_id::text, NEW.reviewer_id::text),
           jsonb_build_object('adjustment_id', NEW.id)
      FROM listing_optimization_items i
     WHERE i.adjustment_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_listing_optimization_apply_status ON adjustments;
CREATE TRIGGER trg_sync_listing_optimization_apply_status
  AFTER UPDATE OF status ON adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_listing_optimization_apply_status();

-- Ontology audit trail: every action on a review or suggestion appends one row
-- (SubmitListingReviewDraft, PublishListingReview, DecideSuggestion,
-- MarkOwnerTaskDone, ApplyListingContent, VerifyListingContentLive). Never updated.
CREATE TABLE IF NOT EXISTS listing_optimization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES listing_optimization_reports(id) ON DELETE CASCADE,
  item_id UUID REFERENCES listing_optimization_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'SubmitListingReviewDraft', 'PublishListingReview', 'UnpublishListingReview',
    'ArchiveListingReview', 'DecideSuggestion', 'MarkOwnerTaskDone',
    'ApplyListingContent', 'VerifyListingContentLive'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'staff', 'agent', 'system')),
  actor_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_optimization_events_report
  ON listing_optimization_events(report_id, created_at);

ALTER TABLE listing_optimization_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Listings users can view optimization events"
  ON listing_optimization_events FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
-- No INSERT/UPDATE/DELETE policies: rows are written server-side only.

REVOKE ALL ON listing_optimization_reports, listing_optimization_items, listing_optimization_events FROM anon;
REVOKE ALL ON FUNCTION public.sync_listing_optimization_apply_status() FROM PUBLIC, anon, authenticated;
