-- Shift handover as a library log (5 Nov 2026, logs thread).
-- The mobile Handover tab writes notes through ps_log_save_entry like any
-- other log, so they are append-only, versioned and visible on the web Logs
-- page too. Re-runnable.

begin;

insert into public.ps_log_templates (id, org_id, title, description, category, schedule_type, required_days, is_library)
values (
  '00000000-0000-0000-0001-000000000006',
  null,
  'Shift Handover',
  'Notes for the next shift: what happened, what is still outstanding and who it is for.',
  'custom',
  'sporadic',
  null,
  true
)
on conflict (id) do nothing;

insert into public.ps_log_fields (id, template_id, label, field_key, field_type, options, is_required, display_order)
values
  ('00000000-0000-0000-0002-000000000601', '00000000-0000-0000-0001-000000000006', 'What happened this shift', 'summary', 'textarea', null, true, 1),
  ('00000000-0000-0000-0002-000000000602', '00000000-0000-0000-0001-000000000006', 'Still to do', 'outstanding', 'textarea', null, false, 2),
  ('00000000-0000-0000-0002-000000000603', '00000000-0000-0000-0001-000000000006', 'Urgent', 'urgent', 'boolean', null, false, 3),
  ('00000000-0000-0000-0002-000000000604', '00000000-0000-0000-0001-000000000006', 'For', 'handed_to', 'text', null, false, 4),
  ('00000000-0000-0000-0002-000000000605', '00000000-0000-0000-0001-000000000006', 'Handed over by', 'handed_over_by', 'text', null, true, 5)
on conflict (id) do nothing;

commit;
