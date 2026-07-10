-- Migration 038: RLS hardening before creating contractor (India) accounts
-- Closes the 2026-07-03 commitment in docs/agent/decisions.md.
--
-- Until now most SELECT policies (and several write policies) were
-- `TO authenticated USING (true)`, so any hub session could read
-- client_credentials, stripe_*, bank_*, expenses, etc. through the REST API
-- regardless of what the UI hides. This migration moves them to
-- public.has_permission(<resource>, <action>) following the 019 pattern.
--
-- Also fixed here:
--   * profiles: any user could UPDATE their own `role` (privilege escalation).
--   * post_with_counts / knowledge_category_article_counts / seo_metrics were
--     definer views owned by postgres, silently bypassing RLS.
--   * clients_basic: minimal definer view (id, name, status) so the
--     Adjustments flow keeps client names for roles without clients:view,
--     without exposing billing/stripe/token/email columns.
--
-- Left intentionally open to all authenticated sessions:
--   * profiles SELECT (author/resolver names), roles + role_permissions SELECT
--     (the layout builds the permission map with the user's client).
--   * listings SELECT also allows adjustments:view (the share card needs
--     listing names/links; listings carry no RevFactor-financial columns).

-- ==========================================================
-- 1. profiles: only super admins may change roles
-- ==========================================================
create or replace function public.enforce_profiles_role_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- auth.uid() is null for the service-role/admin client and direct SQL;
  -- those keep working. Authenticated users need super_admin.
  if new.role is distinct from old.role
     and auth.uid() is not null
     and public.get_my_role() is distinct from 'super_admin' then
    raise exception 'Only super admins can change user roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.enforce_profiles_role_guard();

-- ==========================================================
-- 2. Views: respect the querying user's RLS
-- ==========================================================
alter view public.post_with_counts set (security_invoker = true);
alter view public.knowledge_category_article_counts set (security_invoker = true);
-- seo_metrics is only written/read via the admin client today; if the app
-- ever reads it with the user client, add a SELECT policy on seo_metrics_raw.
alter view public.seo_metrics set (security_invoker = true);

-- ==========================================================
-- 3. clients_basic: minimal projection for the Adjustments flow
--    Definer view on purpose: bypasses clients RLS but exposes ONLY
--    non-sensitive columns to logged-in sessions (never anon).
-- ==========================================================
create or replace view public.clients_basic as
  select id, name, status from public.clients;
alter view public.clients_basic owner to postgres;
revoke all on public.clients_basic from public, anon;
grant select on public.clients_basic to authenticated, service_role;

-- ==========================================================
-- 4. Adjustments module: SELECT requires adjustments:view
-- ==========================================================
drop policy "Authenticated users can view adjustments" on adjustments;
create policy "Authorized users can view adjustments"
  on adjustments for select to authenticated
  using (public.has_permission('adjustments', 'view'));

drop policy "Authenticated users can view adjustment_comments" on adjustment_comments;
create policy "Authorized users can view adjustment_comments"
  on adjustment_comments for select to authenticated
  using (public.has_permission('adjustments', 'view'));

drop policy "Authenticated users can insert adjustment_comments" on adjustment_comments;
create policy "Authorized users can insert adjustment_comments"
  on adjustment_comments for insert to authenticated
  with check (author_id = auth.uid() and public.has_permission('adjustments', 'view'));

-- ==========================================================
-- 5. Clients / listings / credentials
-- ==========================================================
drop policy "Authenticated users can view clients" on clients;
create policy "Authorized users can view clients"
  on clients for select to authenticated
  using (public.has_permission('clients', 'view'));

-- The Adjustments queue/card joins listings for shortcuts, so adjustments:view
-- is enough to read listings (operational data only).
drop policy "Authenticated users can view listings" on listings;
create policy "Authorized users can view listings"
  on listings for select to authenticated
  using (
    public.has_permission('listings', 'view')
    or public.has_permission('adjustments', 'view')
  );

drop policy "Authenticated users can view credentials" on client_credentials;
create policy "Authorized users can view credentials"
  on client_credentials for select to authenticated
  using (public.has_permission('clients', 'view'));

-- ==========================================================
-- 6. Financial data: SELECT requires financials:view
-- ==========================================================
drop policy "Authenticated can view stripe_payouts" on stripe_payouts;
create policy "Authorized users can view stripe_payouts"
  on stripe_payouts for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view stripe_payout_transactions" on stripe_payout_transactions;
create policy "Authorized users can view stripe_payout_transactions"
  on stripe_payout_transactions for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view stripe_subscriptions" on stripe_subscriptions;
create policy "Authorized users can view stripe_subscriptions"
  on stripe_subscriptions for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view stripe_invoices" on stripe_invoices;
create policy "Authorized users can view stripe_invoices"
  on stripe_invoices for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view client_stripe_customers" on client_stripe_customers;
create policy "Authorized users can view client_stripe_customers"
  on client_stripe_customers for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view dismissed_payment_issues" on dismissed_payment_issues;
create policy "Authorized users can view dismissed_payment_issues"
  on dismissed_payment_issues for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view bank_accounts" on bank_accounts;
create policy "Authorized users can view bank_accounts"
  on bank_accounts for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view bank_statement_imports" on bank_statement_imports;
create policy "Authorized users can view bank_statement_imports"
  on bank_statement_imports for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated can view bank_transactions" on bank_transactions;
create policy "Authorized users can view bank_transactions"
  on bank_transactions for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated users can view expenses" on expenses;
create policy "Authorized users can view expenses"
  on expenses for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated users can view expense categories" on expense_categories;
create policy "Authorized users can view expense categories"
  on expense_categories for select to authenticated
  using (public.has_permission('financials', 'view'));

drop policy "Authenticated users can view recurring expenses" on recurring_expenses;
create policy "Authorized users can view recurring expenses"
  on recurring_expenses for select to authenticated
  using (public.has_permission('financials', 'view'));

-- ==========================================================
-- 7. Pipeline (leads): view + writes by permission
-- ==========================================================
drop policy "Authenticated users can view leads" on leads;
create policy "Authorized users can view leads"
  on leads for select to authenticated
  using (public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can insert leads" on leads;
create policy "Authorized users can insert leads"
  on leads for insert to authenticated
  with check (public.has_permission('pipeline', 'create'));

drop policy "Authenticated users can update leads" on leads;
create policy "Authorized users can update leads"
  on leads for update to authenticated
  using (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can delete leads" on leads;
create policy "Authorized users can delete leads"
  on leads for delete to authenticated
  using (public.has_permission('pipeline', 'delete'));

drop policy "Authenticated users can view lead notes" on lead_notes;
create policy "Authorized users can view lead notes"
  on lead_notes for select to authenticated
  using (public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can insert lead notes" on lead_notes;
create policy "Authorized users can insert lead notes"
  on lead_notes for insert to authenticated
  with check (auth.uid() = author_id and public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can view lead_tags" on lead_tags;
create policy "Authorized users can view lead_tags"
  on lead_tags for select to authenticated
  using (public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can insert lead_tags" on lead_tags;
create policy "Authorized users can insert lead_tags"
  on lead_tags for insert to authenticated
  with check (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can update lead_tags" on lead_tags;
create policy "Authorized users can update lead_tags"
  on lead_tags for update to authenticated
  using (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can delete lead_tags" on lead_tags;
create policy "Authorized users can delete lead_tags"
  on lead_tags for delete to authenticated
  using (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can view lead_tag_assignments" on lead_tag_assignments;
create policy "Authorized users can view lead_tag_assignments"
  on lead_tag_assignments for select to authenticated
  using (public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can insert lead_tag_assignments" on lead_tag_assignments;
create policy "Authorized users can insert lead_tag_assignments"
  on lead_tag_assignments for insert to authenticated
  with check (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can delete lead_tag_assignments" on lead_tag_assignments;
create policy "Authorized users can delete lead_tag_assignments"
  on lead_tag_assignments for delete to authenticated
  using (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can view lead_team_assignments" on lead_team_assignments;
create policy "Authorized users can view lead_team_assignments"
  on lead_team_assignments for select to authenticated
  using (public.has_permission('pipeline', 'view'));

drop policy "Authenticated users can insert lead_team_assignments" on lead_team_assignments;
create policy "Authorized users can insert lead_team_assignments"
  on lead_team_assignments for insert to authenticated
  with check (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can update lead_team_assignments" on lead_team_assignments;
create policy "Authorized users can update lead_team_assignments"
  on lead_team_assignments for update to authenticated
  using (public.has_permission('pipeline', 'edit'));

drop policy "Authenticated users can delete lead_team_assignments" on lead_team_assignments;
create policy "Authorized users can delete lead_team_assignments"
  on lead_team_assignments for delete to authenticated
  using (public.has_permission('pipeline', 'edit'));

-- ==========================================================
-- 8. Tasks: view + writes by permission
-- ==========================================================
drop policy "Authenticated users can view tasks" on tasks;
create policy "Authorized users can view tasks"
  on tasks for select to authenticated
  using (public.has_permission('tasks', 'view'));

drop policy "Authenticated users can insert tasks" on tasks;
create policy "Authorized users can insert tasks"
  on tasks for insert to authenticated
  with check (public.has_permission('tasks', 'create'));

drop policy "Authenticated users can update tasks" on tasks;
create policy "Authorized users can update tasks"
  on tasks for update to authenticated
  using (public.has_permission('tasks', 'edit'));

drop policy "Authenticated users can delete tasks" on tasks;
create policy "Authorized users can delete tasks"
  on tasks for delete to authenticated
  using (public.has_permission('tasks', 'delete'));

drop policy "Authenticated users can view task_comments" on task_comments;
create policy "Authorized users can view task_comments"
  on task_comments for select to authenticated
  using (public.has_permission('tasks', 'view'));

drop policy "Authenticated users can insert task_comments" on task_comments;
create policy "Authorized users can insert task_comments"
  on task_comments for insert to authenticated
  with check (author_id = auth.uid() and public.has_permission('tasks', 'view'));

drop policy "Authenticated users can view task_listings" on task_listings;
create policy "Authorized users can view task_listings"
  on task_listings for select to authenticated
  using (public.has_permission('tasks', 'view'));

drop policy "Authenticated users can insert task_listings" on task_listings;
create policy "Authorized users can insert task_listings"
  on task_listings for insert to authenticated
  with check (public.has_permission('tasks', 'edit'));

drop policy "Authenticated users can delete task_listings" on task_listings;
create policy "Authorized users can delete task_listings"
  on task_listings for delete to authenticated
  using (public.has_permission('tasks', 'edit'));

-- ==========================================================
-- 9. Roadmap (boards/posts/comments/tags): view + writes by permission
--    Upvotes/reactions only require roadmap:view (participation).
-- ==========================================================
drop policy "Authenticated users can view boards" on boards;
create policy "Authorized users can view boards"
  on boards for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert boards" on boards;
create policy "Authorized users can insert boards"
  on boards for insert to authenticated
  with check (public.has_permission('roadmap', 'create'));

drop policy "Authenticated users can update boards" on boards;
create policy "Authorized users can update boards"
  on boards for update to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can delete boards" on boards;
create policy "Authorized users can delete boards"
  on boards for delete to authenticated
  using (public.has_permission('roadmap', 'delete'));

drop policy "Authenticated users can view posts" on posts;
create policy "Authorized users can view posts"
  on posts for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert posts" on posts;
create policy "Authorized users can insert posts"
  on posts for insert to authenticated
  with check (public.has_permission('roadmap', 'create'));

drop policy "Authenticated users can update posts" on posts;
create policy "Authorized users can update posts"
  on posts for update to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can delete posts" on posts;
create policy "Authorized users can delete posts"
  on posts for delete to authenticated
  using (public.has_permission('roadmap', 'delete'));

drop policy "Authenticated users can view comments" on comments;
create policy "Authorized users can view comments"
  on comments for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert comments" on comments;
create policy "Authorized users can insert comments"
  on comments for insert to authenticated
  with check (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can update comments" on comments;
create policy "Authorized users can update comments"
  on comments for update to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can delete comments" on comments;
create policy "Authorized users can delete comments"
  on comments for delete to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can view comment_reactions" on comment_reactions;
create policy "Authorized users can view comment_reactions"
  on comment_reactions for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert comment_reactions" on comment_reactions;
create policy "Authorized users can insert comment_reactions"
  on comment_reactions for insert to authenticated
  with check (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can delete comment_reactions" on comment_reactions;
create policy "Authorized users can delete comment_reactions"
  on comment_reactions for delete to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can view post_upvotes" on post_upvotes;
create policy "Authorized users can view post_upvotes"
  on post_upvotes for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert post_upvotes" on post_upvotes;
create policy "Authorized users can insert post_upvotes"
  on post_upvotes for insert to authenticated
  with check (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can delete post_upvotes" on post_upvotes;
create policy "Authorized users can delete post_upvotes"
  on post_upvotes for delete to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can view post_tags" on post_tags;
create policy "Authorized users can view post_tags"
  on post_tags for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert post_tags" on post_tags;
create policy "Authorized users can insert post_tags"
  on post_tags for insert to authenticated
  with check (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can delete post_tags" on post_tags;
create policy "Authorized users can delete post_tags"
  on post_tags for delete to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can view tags" on tags;
create policy "Authorized users can view tags"
  on tags for select to authenticated
  using (public.has_permission('roadmap', 'view'));

drop policy "Authenticated users can insert tags" on tags;
create policy "Authorized users can insert tags"
  on tags for insert to authenticated
  with check (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can update tags" on tags;
create policy "Authorized users can update tags"
  on tags for update to authenticated
  using (public.has_permission('roadmap', 'edit'));

drop policy "Authenticated users can delete tags" on tags;
create policy "Authorized users can delete tags"
  on tags for delete to authenticated
  using (public.has_permission('roadmap', 'edit'));

-- ==========================================================
-- 10. Knowledge base: view + writes by permission
-- ==========================================================
drop policy "Authenticated users can view knowledge_articles" on knowledge_articles;
create policy "Authorized users can view knowledge_articles"
  on knowledge_articles for select to authenticated
  using (public.has_permission('knowledge', 'view'));

drop policy "Authenticated users can insert knowledge_articles" on knowledge_articles;
create policy "Authorized users can insert knowledge_articles"
  on knowledge_articles for insert to authenticated
  with check (public.has_permission('knowledge', 'create'));

drop policy "Authenticated users can update knowledge_articles" on knowledge_articles;
create policy "Authorized users can update knowledge_articles"
  on knowledge_articles for update to authenticated
  using (public.has_permission('knowledge', 'edit'));

drop policy "Authenticated users can delete knowledge_articles" on knowledge_articles;
create policy "Authorized users can delete knowledge_articles"
  on knowledge_articles for delete to authenticated
  using (public.has_permission('knowledge', 'delete'));

drop policy "Authenticated users can view knowledge_categories" on knowledge_categories;
create policy "Authorized users can view knowledge_categories"
  on knowledge_categories for select to authenticated
  using (public.has_permission('knowledge', 'view'));

drop policy "Authenticated users can insert knowledge_categories" on knowledge_categories;
create policy "Authorized users can insert knowledge_categories"
  on knowledge_categories for insert to authenticated
  with check (public.has_permission('knowledge', 'create'));

drop policy "Authenticated users can update knowledge_categories" on knowledge_categories;
create policy "Authorized users can update knowledge_categories"
  on knowledge_categories for update to authenticated
  using (public.has_permission('knowledge', 'edit'));

drop policy "Authenticated users can delete knowledge_categories" on knowledge_categories;
create policy "Authorized users can delete knowledge_categories"
  on knowledge_categories for delete to authenticated
  using (public.has_permission('knowledge', 'delete'));

drop policy "Authenticated users can view knowledge_tags" on knowledge_tags;
create policy "Authorized users can view knowledge_tags"
  on knowledge_tags for select to authenticated
  using (public.has_permission('knowledge', 'view'));

drop policy "Authenticated users can insert knowledge_tags" on knowledge_tags;
create policy "Authorized users can insert knowledge_tags"
  on knowledge_tags for insert to authenticated
  with check (public.has_permission('knowledge', 'create'));

drop policy "Authenticated users can update knowledge_tags" on knowledge_tags;
create policy "Authorized users can update knowledge_tags"
  on knowledge_tags for update to authenticated
  using (public.has_permission('knowledge', 'edit'));

drop policy "Authenticated users can delete knowledge_tags" on knowledge_tags;
create policy "Authorized users can delete knowledge_tags"
  on knowledge_tags for delete to authenticated
  using (public.has_permission('knowledge', 'delete'));

drop policy "Authenticated users can view knowledge_article_tags" on knowledge_article_tags;
create policy "Authorized users can view knowledge_article_tags"
  on knowledge_article_tags for select to authenticated
  using (public.has_permission('knowledge', 'view'));

drop policy "Authenticated users can insert knowledge_article_tags" on knowledge_article_tags;
create policy "Authorized users can insert knowledge_article_tags"
  on knowledge_article_tags for insert to authenticated
  with check (public.has_permission('knowledge', 'edit'));

drop policy "Authenticated users can delete knowledge_article_tags" on knowledge_article_tags;
create policy "Authorized users can delete knowledge_article_tags"
  on knowledge_article_tags for delete to authenticated
  using (public.has_permission('knowledge', 'edit'));

-- ==========================================================
-- 11. Onboarding: view + progress writes by permission
--     (templates/resources writes were already permission-based in 019)
-- ==========================================================
drop policy "Authenticated users can view onboarding templates" on onboarding_templates;
create policy "Authorized users can view onboarding templates"
  on onboarding_templates for select to authenticated
  using (public.has_permission('onboarding', 'view'));

drop policy "Authenticated users can view onboarding resources" on onboarding_resources;
create policy "Authorized users can view onboarding resources"
  on onboarding_resources for select to authenticated
  using (public.has_permission('onboarding', 'view'));

drop policy "Authenticated users can view onboarding progress" on onboarding_progress;
create policy "Authorized users can view onboarding progress"
  on onboarding_progress for select to authenticated
  using (public.has_permission('onboarding', 'view'));

drop policy "Authenticated users can insert onboarding progress" on onboarding_progress;
create policy "Authorized users can insert onboarding progress"
  on onboarding_progress for insert to authenticated
  with check (public.has_permission('onboarding', 'edit'));

drop policy "Authenticated users can update onboarding progress" on onboarding_progress;
create policy "Authorized users can update onboarding progress"
  on onboarding_progress for update to authenticated
  using (public.has_permission('onboarding', 'edit'));

drop policy "Authenticated users can delete onboarding progress" on onboarding_progress;
create policy "Authorized users can delete onboarding progress"
  on onboarding_progress for delete to authenticated
  using (public.has_permission('onboarding', 'edit'));

drop policy "Authenticated users can view onboarding_comments" on onboarding_comments;
create policy "Authorized users can view onboarding_comments"
  on onboarding_comments for select to authenticated
  using (public.has_permission('onboarding', 'view'));

drop policy "Authenticated users can insert onboarding_comments" on onboarding_comments;
create policy "Authorized users can insert onboarding_comments"
  on onboarding_comments for insert to authenticated
  with check (author_id = auth.uid() and public.has_permission('onboarding', 'view'));

-- ==========================================================
-- 12. Report Builder mirror: SELECT requires listings:view
--     (feeds listing detail + dashboard pacing; writes stay admin-client)
-- ==========================================================
drop policy "Authenticated can view report_runs" on report_runs;
create policy "Authorized users can view report_runs"
  on report_runs for select to authenticated
  using (public.has_permission('listings', 'view'));

drop policy "Authenticated can view report_listings" on report_listings;
create policy "Authorized users can view report_listings"
  on report_listings for select to authenticated
  using (public.has_permission('listings', 'view'));

drop policy "Authenticated can view report_metrics" on report_metrics;
create policy "Authorized users can view report_metrics"
  on report_metrics for select to authenticated
  using (public.has_permission('listings', 'view'));

drop policy "Authenticated can view report_group_overrides" on report_group_overrides;
create policy "Authorized users can view report_group_overrides"
  on report_group_overrides for select to authenticated
  using (public.has_permission('listings', 'view'));
