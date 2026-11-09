-- ps_remind_sop_member exists on London but not in this repo. It has no
-- permission check, so any signed-in user could send "SOP reminder"
-- notifications into any pharmacy. Nothing in the apps calls it. Lock it down.
do $$ begin
  if to_regprocedure('public.ps_remind_sop_member(uuid,uuid,uuid)') is not null then
    revoke all on function public.ps_remind_sop_member(uuid, uuid, uuid) from public, anon, authenticated;
  end if;
end $$;
