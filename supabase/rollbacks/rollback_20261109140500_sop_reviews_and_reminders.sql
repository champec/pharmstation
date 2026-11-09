-- Rollback for 20261109140500_sop_reviews_and_reminders.sql
-- Restores the 5 Nov ps_sop_publish and ps_sop_document_guard: re-run their
-- definitions from 20261105160100_sop_production_readiness.sql afterwards.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ps-sop-review-reminders', 'ps-sop-outstanding-reminders');
  end if;
end $$;
drop function if exists public.ps_sop_send_outstanding_reminders();
drop function if exists public.ps_sop_send_review_reminders();
drop function if exists public.ps_sop_manager_user_ids(uuid);
drop function if exists public.ps_sop_mark_reviewed(uuid, text);
drop function if exists public.ps_sop_log_review(ps_sop_documents, text, text, date);
drop table if exists public.ps_sop_reviews;
alter table public.ps_sop_documents
  drop constraint if exists ps_sop_documents_review_interval_check,
  drop column if exists review_reminded_for,
  drop column if exists last_reviewed_by,
  drop column if exists last_reviewed_at,
  drop column if exists next_review_due,
  drop column if exists review_interval_months;
commit;
