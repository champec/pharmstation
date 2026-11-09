-- Support tickets: platform admins can see and triage every ticket in the app
-- (My Account > PharmStation admin > Support inbox). Safe to run more than once.
-- Applied on London 9 Nov 2026.

alter table public.ps_support_tickets add column if not exists admin_note text
  check (admin_note is null or char_length(admin_note) <= 2000);

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'support_tickets_admin_select' and polrelid = 'public.ps_support_tickets'::regclass) then
    create policy support_tickets_admin_select on public.ps_support_tickets
      for select to authenticated using (ps_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policy where polname = 'support_tickets_admin_update' and polrelid = 'public.ps_support_tickets'::regclass) then
    create policy support_tickets_admin_update on public.ps_support_tickets
      for update to authenticated using (ps_is_platform_admin()) with check (ps_is_platform_admin());
  end if;
end $$;

-- Admins may only change the triage fields, never what the sender wrote.
grant update (status, admin_note, updated_at) on public.ps_support_tickets to authenticated;
