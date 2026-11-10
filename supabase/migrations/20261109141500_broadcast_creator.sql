-- Broadcasts could never be saved: created_by_user_id is NOT NULL with no
-- default, and the web/app insert doesn't send it. Stamp it from the caller
-- (also stops one member recording a broadcast as someone else's).
create or replace function public.ps_broadcasts_set_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.created_by_user_id := auth.uid(); end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ps_broadcasts_set_creator' and tgrelid = 'public.ps_broadcasts'::regclass) then
    create trigger ps_broadcasts_set_creator before insert on public.ps_broadcasts
      for each row execute function public.ps_broadcasts_set_creator();
  end if;
end $$;
