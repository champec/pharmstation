-- Genie attachments: images and PDFs staff attach to a Genie question.
-- Private bucket; each person can only upload, read and delete files in their own
-- folder ({user_id}/...). The ai-chat edge function reads them with the service role
-- after checking the path belongs to the caller.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'genie-attachments', 'genie-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "genie_attachments_insert_own" on storage.objects;
create policy "genie_attachments_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'genie-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "genie_attachments_select_own" on storage.objects;
create policy "genie_attachments_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'genie-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "genie_attachments_delete_own" on storage.objects;
create policy "genie_attachments_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'genie-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
