-- Fotos para o agente enviar no WhatsApp: álbuns por acomodação/área, importação do Google Drive e do Hospedin.

-- Bucket público: são fotos de divulgação e a Evolution precisa baixá-las por URL. Caminhos aleatórios por workspace.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy media_objects_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'admin')
      and m.workspace_id::text = (storage.foldername(name))[1]));
create policy media_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'admin')
      and m.workspace_id::text = (storage.foldername(name))[1]));

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  album text not null check (length(trim(album)) between 1 and 80),
  product_id uuid references public.products(id) on delete set null,
  caption text,
  storage_path text not null,
  public_url text not null,
  mime_type text not null,
  size_bytes integer,
  source text not null default 'upload' check (source in ('upload', 'drive', 'hospedin')),
  -- Id do arquivo na origem (Drive/Hospedin): reimportar não duplica.
  source_ref text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_assets_album_idx on public.media_assets(workspace_id, album, position);
create unique index media_assets_source_uniq on public.media_assets(workspace_id, source, source_ref) where source_ref is not null;
create trigger trg_media_assets_touch before update on public.media_assets for each row execute function public.touch_updated_at();

create table public.media_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (source in ('drive', 'hospedin')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  total integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index media_imports_workspace_idx on public.media_imports(workspace_id, created_at desc);

alter table public.media_assets enable row level security;
alter table public.media_imports enable row level security;
revoke all on public.media_assets, public.media_imports from anon;
create policy media_assets_select on public.media_assets for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy media_imports_select on public.media_imports for select to authenticated
  using (public.is_workspace_admin(workspace_id));
-- Escrita só pela function media.
revoke insert, update, delete on public.media_assets, public.media_imports from authenticated;
