-- Finish an account deletion request (platform admin, two-step session).
--
-- People ask to delete their account from My Account (web or phone). Until
-- now the admin could only mark the request "done" and had to remove the
-- account by hand, and deleting the auth user fails anyway: profiles and
-- clinical records point at it.
--
-- ps_admin_complete_account_deletion(request) instead ANONYMISES the
-- account, so records made at a pharmacy keep a valid (but nameless)
-- author, as the record-keeping rules require:
--   - sign-in is destroyed: email replaced, password scrambled, account
--     banned, sessions, identities and authenticator apps removed;
--   - the profile becomes "Deleted user" with no contact details;
--   - locum personal details (address, NI, DBS, indemnity, NHS email) are
--     cleared;
--   - every pharmacy membership is revoked;
--   - the request is marked done.
--
-- Rollback: drop function public.ps_admin_complete_account_deletion(uuid, text);

create extension if not exists pgcrypto with schema extensions;

create or replace function public.ps_admin_complete_account_deletion(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_status text;
begin
  if not ps_is_platform_admin() then
    raise exception 'Platform admins only, signed in with two-step sign-in' using errcode = '42501';
  end if;
  select user_id, status into v_uid, v_status from ps_account_deletion_requests where id = p_id for update;
  if v_uid is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending' then raise exception 'This request has already been handled'; end if;
  if v_uid = auth.uid() then raise exception 'You can''t delete your own account here' using errcode = '42501'; end if;
  if exists (select 1 from ps_organisations where auth_user_id = v_uid) then
    raise exception 'This is a pharmacy login, not a person. Close the pharmacy instead.';
  end if;

  -- Sign-in
  delete from auth.sessions where user_id = v_uid;
  delete from auth.mfa_factors where user_id = v_uid;
  delete from auth.identities where user_id = v_uid;
  update auth.users
     set email = 'deleted+' || v_uid::text || '@deleted.pharmstation.invalid',
         phone = null,
         encrypted_password = crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')),
         raw_user_meta_data = jsonb_build_object('deleted', true),
         banned_until = 'infinity',
         updated_at = now()
   where id = v_uid;

  -- Profile (after the email change, whose trigger copies the email across)
  update ps_user_profiles
     set full_name = 'Deleted user', first_name = null, last_name = null, email = null,
         phone = null, gphc_number = null, avatar_url = null, updated_at = now()
   where id = v_uid;

  update ps_locum_profiles
     set address_line_1 = null, address_line_2 = null, city = null, postcode = null,
         ni_number = null, dbs_number = null, dbs_expiry = null, nhs_email = null,
         indemnity_provider = null, indemnity_expiry = null, gphc_number = null,
         updated_at = now()
   where user_id = v_uid;

  update ps_organisation_members set status = 'revoked' where user_id = v_uid and status <> 'revoked';

  update ps_account_deletion_requests
     set status = 'done', admin_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         handled_by = auth.uid(), handled_at = now(), email = null
   where id = p_id;
end;
$$;
revoke all on function public.ps_admin_complete_account_deletion(uuid, text) from public, anon;
grant execute on function public.ps_admin_complete_account_deletion(uuid, text) to authenticated;
