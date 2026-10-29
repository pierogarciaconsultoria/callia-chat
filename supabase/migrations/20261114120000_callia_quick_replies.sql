-- Respostas rápidas da inbox: textos prontos (chave PIX, endereço, horários…) com atalho "/pix".
-- Membros usam; dono e admin cadastram. Anexo opcional guardado em inbox-media/<ws>/outbound/.
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  title text not null check (length(title) between 1 and 80),
  content text not null check (length(content) between 1 and 4096),
  media_path text check (media_path is null or (length(media_path) <= 300 and media_path not like '%..%')),
  media_name text check (media_name is null or length(media_name) <= 200),
  media_mime text check (media_mime is null or length(media_mime) <= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, shortcut)
);
create index quick_replies_workspace_idx on public.quick_replies(workspace_id, shortcut);
alter table public.quick_replies enable row level security;
create policy quick_replies_select on public.quick_replies for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy quick_replies_write on public.quick_replies for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id) and (media_path is null or media_path like workspace_id::text || '/outbound/%'));
grant select, insert, update, delete on public.quick_replies to authenticated;
grant all on public.quick_replies to service_role;
create trigger trg_quick_replies_touch before update on public.quick_replies
  for each row execute function public.touch_updated_at();
