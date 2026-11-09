-- Security fixes from the internal pen test (F1, F4, F6), applied 9 Nov 2026.

-- F1. scan-images: any signed-in user could read, upload to and delete every
-- pharmacy's scans. Scope to the caller's org folder; PEPS controlled-drug
-- evidence lives under peps/<prescription_id>/ and follows the prescription's RLS.
alter policy scan_images_select on storage.objects using (
  bucket_id = 'scan-images' and (
    (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text)
    or ((storage.foldername(name))[1] = 'peps' and exists (
      select 1 from public.ps_peps_prescriptions p where p.id::text = (storage.foldername(name))[2]))
  ));
alter policy scan_images_insert on storage.objects with check (
  bucket_id = 'scan-images' and (
    (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text)
    or ((storage.foldername(name))[1] = 'peps' and exists (
      select 1 from public.ps_peps_prescriptions p where p.id::text = (storage.foldername(name))[2]))
  ));
alter policy scan_images_delete on storage.objects using (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] in (select public.ps_get_user_org_ids()::text));

-- F4. Anyone could insert fake rows into the NHS claim submission audit trail.
-- Only the claim edge functions write here (service role).
alter policy ps_nhs_attempts_insert_service_role on public.ps_nhs_submission_attempts to service_role;

-- F6. Anyone could change the stored name for any GPhC number. Require sign-in to update.
alter policy "Anyone can update public pharmacists" on public.ps_public_pharmacists to authenticated;
