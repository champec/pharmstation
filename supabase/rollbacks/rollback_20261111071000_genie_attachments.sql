drop policy if exists "genie_attachments_insert_own" on storage.objects;
drop policy if exists "genie_attachments_select_own" on storage.objects;
drop policy if exists "genie_attachments_delete_own" on storage.objects;
-- Empty the bucket in the dashboard first, then:
delete from storage.buckets where id = 'genie-attachments';
