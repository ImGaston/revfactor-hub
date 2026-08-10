-- Migration 075: reusable partner branding for Revenue Brief PDFs.
--
-- Property-management partners can present an owner opportunity brief under
-- their own brand while RevFactor remains the revenue-management provider.
-- Brand manuals and logos are private operational assets; access follows the
-- existing Pipeline permission resource used by the Revenue Brief Builder.

create table public.revenue_brief_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references public.clients(id) on delete set null,
  co_branding_mode text not null default 'co_branded'
    check (co_branding_mode in ('partner_led', 'co_branded', 'revfactor_led')),
  primary_color text not null default '#173F35'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#405542'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#95543D'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family text,
  footer_text text,
  source_drive_url text,
  logo_storage_path text,
  logo_file_name text,
  manual_storage_path text,
  manual_file_name text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_revenue_brief_brands_client
  on public.revenue_brief_brands(client_id);
create unique index idx_revenue_brief_brands_name_lower
  on public.revenue_brief_brands(lower(name));

create trigger trg_revenue_brief_brands_set_updated_at
  before update on public.revenue_brief_brands
  for each row execute function public.set_updated_at();

alter table public.revenue_brief_brands enable row level security;

create policy "Pipeline users can view revenue brief brands"
  on public.revenue_brief_brands for select to authenticated
  using (public.has_permission('pipeline', 'view'));

create policy "Pipeline users can create revenue brief brands"
  on public.revenue_brief_brands for insert to authenticated
  with check (public.has_permission('pipeline', 'create'));

create policy "Pipeline users can update revenue brief brands"
  on public.revenue_brief_brands for update to authenticated
  using (public.has_permission('pipeline', 'edit'))
  with check (public.has_permission('pipeline', 'edit'));

create policy "Pipeline users can delete revenue brief brands"
  on public.revenue_brief_brands for delete to authenticated
  using (public.has_permission('pipeline', 'delete'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'revenue-brief-brands',
  'revenue-brief-brands',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Pipeline users can view revenue brief brand assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'revenue-brief-brands'
    and public.has_permission('pipeline', 'view')
  );

create policy "Pipeline users can upload revenue brief brand assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'revenue-brief-brands'
    and (
      public.has_permission('pipeline', 'create')
      or public.has_permission('pipeline', 'edit')
    )
  );

create policy "Pipeline users can update revenue brief brand assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'revenue-brief-brands'
    and public.has_permission('pipeline', 'edit')
  )
  with check (
    bucket_id = 'revenue-brief-brands'
    and public.has_permission('pipeline', 'edit')
  );

create policy "Pipeline users can delete revenue brief brand assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'revenue-brief-brands'
    and public.has_permission('pipeline', 'delete')
  );
