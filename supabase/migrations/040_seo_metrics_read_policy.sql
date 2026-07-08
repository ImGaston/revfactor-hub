-- 040: SELECT policy for seo_metrics_raw.
--
-- Until now seo_metrics_raw was only accessed via the admin client (Settings →
-- Listings SEO Metrics upload). The listing detail page now reads the
-- Rankbreeze association (airbnb_id → rankbreeze_id) with the user client to
-- render a direct link to app.rankbreeze.com, so we add the SELECT policy that
-- the note in 038 anticipated. Gated on listings:view — same permission that
-- guards the listings the metrics describe. Writes stay admin-client only (no
-- INSERT/UPDATE/DELETE policies).
create policy "Authorized users can view seo_metrics_raw"
  on public.seo_metrics_raw for select
  using (public.has_permission('listings', 'view'));
