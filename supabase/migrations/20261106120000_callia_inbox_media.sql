-- Arquivos recebidos dos clientes (fotos, PDFs, áudios): guardados no Callia para a equipe abrir na inbox
-- (comprovantes de depósito, documentos). Bucket privado: a inbox usa URL assinada; só membros do workspace leem.

insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox-media', 'inbox-media', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy inbox_media_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'inbox-media' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.workspace_id::text = (storage.foldername(name))[1]));

-- Webhook (arquivo guardado) e IA (texto lido) gravam em messages.metadata em paralelo: merge atômico, sem sobrescrever.
create or replace function public.merge_message_metadata(p_message_id uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages set metadata = coalesce(metadata, '{}'::jsonb) || p_patch where id = p_message_id;
$$;
revoke execute on function public.merge_message_metadata from public, anon, authenticated;
grant execute on function public.merge_message_metadata to service_role;
