-- Anexos enviados pela inbox: membros do workspace gravam no bucket privado inbox-media, só na pasta
-- <workspace>/outbound/. A pasta dos arquivos recebidos (<workspace>/<conversa>/) continua só do servidor.
create policy inbox_media_objects_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inbox-media'
    and (storage.foldername(name))[2] = 'outbound'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and m.workspace_id::text = (storage.foldername(name))[1]
    )
  );
