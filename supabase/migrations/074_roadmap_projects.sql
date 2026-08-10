-- Migration 074: project-based roadmap planning
-- Keeps existing roadmap posts as tasks, groups every task under a project,
-- and presents the existing ETA field as the task deadline in the app.

create table public.roadmap_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  deadline date,
  created_by uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roadmap_projects enable row level security;

create policy "Authorized users can view roadmap projects"
  on public.roadmap_projects for select to authenticated
  using (public.has_permission('roadmap', 'view'));

create policy "Authorized users can create roadmap projects"
  on public.roadmap_projects for insert to authenticated
  with check (public.has_permission('roadmap', 'create'));

create policy "Authorized users can update roadmap projects"
  on public.roadmap_projects for update to authenticated
  using (public.has_permission('roadmap', 'edit'))
  with check (public.has_permission('roadmap', 'edit'));

create policy "Authorized users can delete roadmap projects"
  on public.roadmap_projects for delete to authenticated
  using (
    public.has_permission('roadmap', 'delete')
    and id <> '00000000-0000-0000-0000-000000000071'
  );

insert into public.roadmap_projects (
  id,
  name,
  description,
  sort_order
) values (
  '00000000-0000-0000-0000-000000000071',
  'General',
  'Existing roadmap tasks that have not yet been organized into a dedicated project.',
  0
);

alter table public.posts
  add column project_id uuid not null
  default '00000000-0000-0000-0000-000000000071'
  references public.roadmap_projects(id) on delete restrict;

create index idx_posts_project_status_sort
  on public.posts(project_id, status, sort_order);
create index idx_roadmap_projects_deadline
  on public.roadmap_projects(deadline) where deadline is not null;

-- Recreate the view because its original p.* projection was expanded when
-- migration 006 ran and would not otherwise expose the new project_id column.
drop view public.post_with_counts;
create view public.post_with_counts
with (security_invoker = true) as
select
  p.*,
  coalesce(u.upvote_count, 0)::integer as upvote_count,
  coalesce(c.comment_count, 0)::integer as comment_count
from public.posts p
left join (
  select post_id, count(*)::integer as upvote_count
  from public.post_upvotes
  group by post_id
) u on u.post_id = p.id
left join (
  select post_id, count(*)::integer as comment_count
  from public.comments
  group by post_id
) c on c.post_id = p.id;

grant select on public.post_with_counts to authenticated, service_role;
