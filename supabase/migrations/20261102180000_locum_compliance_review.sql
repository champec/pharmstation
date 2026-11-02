-- Locum compliance review (2 Nov 2026).
-- New locum profiles start with compliance_status = 'pending' and
-- ps_locum_book_shift refuses to book until it is 'approved', but nothing let
-- anyone approve them. PharmStation platform admins (ps_platform_admins) can
-- now list locums with their documents and approve or reject them with a note
-- the locum sees. Safe to run more than once. Run on London (and PharmEx while
-- it is still live).

-- 0. Platform admins (same definition as the pharmacy sign-up migration, so
--    either can run first)
create table if not exists public.ps_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ps_platform_admins enable row level security;
revoke all on public.ps_platform_admins from anon, authenticated;

create or replace function public.ps_is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_platform_admins where user_id = auth.uid())
$$;
revoke execute on function public.ps_is_platform_admin() from public, anon;
grant execute on function public.ps_is_platform_admin() to authenticated, service_role;

-- 1. List locums for review, with their current documents
create or replace function public.ps_admin_list_locums(p_status text default 'pending')
returns table(
  id uuid,
  user_id uuid,
  full_name text,
  email text,
  phone text,
  gphc_number text,
  gphc_expiry date,
  indemnity_provider text,
  indemnity_expiry date,
  dbs_number text,
  dbs_expiry date,
  smart_card_held boolean,
  postcode text,
  compliance_status text,
  compliance_review_notes text,
  compliance_reviewed_at timestamptz,
  created_at timestamptz,
  latest_document_at timestamptz,
  documents jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select
    l.id, l.user_id,
    coalesce(nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''), u.full_name),
    coalesce(u.email, au.email::text),
    u.phone,
    l.gphc_number, l.gphc_expiry, l.indemnity_provider, l.indemnity_expiry,
    l.dbs_number, l.dbs_expiry, l.smart_card_held, l.postcode,
    l.compliance_status, l.compliance_review_notes, l.compliance_reviewed_at, l.created_at,
    (select max(d.uploaded_at) from ps_locum_documents d where d.locum_id = l.id and d.is_current),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'label', d.label, 'file_url', d.file_url,
        'expiry_date', d.expiry_date, 'uploaded_at', d.uploaded_at
      ) order by d.uploaded_at desc)
      from ps_locum_documents d where d.locum_id = l.id and d.is_current
    ), '[]'::jsonb)
  from ps_locum_profiles l
  left join ps_user_profiles u on u.id = l.user_id
  left join auth.users au on au.id = l.user_id
  where p_status is null or l.compliance_status = p_status
  order by l.created_at asc;
end;
$$;
revoke execute on function public.ps_admin_list_locums(text) from public, anon;
grant execute on function public.ps_admin_list_locums(text) to authenticated, service_role;

-- 2. Approve, reject or send back to pending
create or replace function public.ps_admin_set_locum_compliance(
  p_locum_id uuid, p_status text, p_notes text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ps_is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid status %', p_status;
  end if;
  if p_status = 'rejected' and coalesce(trim(p_notes), '') = '' then
    raise exception 'Give the locum a reason when rejecting';
  end if;
  -- An admin who is also a locum cannot approve themselves.
  if exists (select 1 from ps_locum_profiles where id = p_locum_id and user_id = auth.uid()) then
    raise exception 'You cannot review your own locum profile';
  end if;

  update ps_locum_profiles
  set compliance_status = p_status,
      compliance_review_notes = nullif(trim(p_notes), ''),
      compliance_reviewed_at = case when p_status = 'pending' then null else now() end,
      compliance_reviewed_by = case when p_status = 'pending' then null else auth.uid() end,
      updated_at = now()
  where id = p_locum_id;

  if not found then
    raise exception 'Locum not found';
  end if;
end;
$$;
revoke execute on function public.ps_admin_set_locum_compliance(uuid, text, text) from public, anon;
grant execute on function public.ps_admin_set_locum_compliance(uuid, text, text) to authenticated, service_role;

-- 3. Let platform admins open locum documents (signed URLs) to check them
drop policy if exists locum_documents_select_platform_admin on storage.objects;
create policy locum_documents_select_platform_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'locum-documents' and public.ps_is_platform_admin());

-- After running this, make yourself an admin (replace the email):
--   insert into public.ps_platform_admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
