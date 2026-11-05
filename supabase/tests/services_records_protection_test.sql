-- Tests for 20261105160000_services_records_protection.sql.
-- Run after services_test_setup.sql and the migration. Prints PASS/FAIL lines.
-- Each check is its own statement: a check that reads rows changed inside the
-- same statement would not see them (statement snapshot).
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_uid text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', p_uid, false) $$;

create or replace function pg_temp.check(p_name text, p_ok boolean) returns text language sql as
$$ select case when coalesce(p_ok, false) then 'PASS ' else 'FAIL ' end || p_name $$;

-- Runs p_sql and says whether it raised an error.
create or replace function pg_temp.raises(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

-- Runs p_sql and returns the number of rows it touched.
create or replace function pg_temp.touched(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end $$;

-- Fixtures: org1 has a pharmacist (a) and a dispenser (b); org2 an owner (c).
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into ps_user_profiles select id from auth.users;
insert into ps_organisations(id,name) values ('10000000-0000-0000-0000-000000000001','Org1'),('10000000-0000-0000-0000-000000000002','Org2');
insert into ps_organisation_members(organisation_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','pharmacist'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','dispenser'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c','owner');
insert into ps_patients(id,organisation_id,first_name,last_name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Pat','One'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Pat','Two');
insert into ps_services(id,org_id,name) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','BP check');
insert into ps_service_forms(id,org_service_id,name) values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Default');
insert into ps_service_form_fields(form_id,label,field_key) values ('40000000-0000-0000-0000-000000000001','Systolic','SYS');

set role authenticated;

-- Dispenser (b)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('dispenser cannot create a service',
  pg_temp.raises($$insert into ps_services(org_id,name) values ('10000000-0000-0000-0000-000000000001','X')$$));
select pg_temp.check('dispenser cannot change a service',
  pg_temp.touched($$update ps_services set name='Y'$$) = 0);
select pg_temp.check('dispenser can see the service', (select count(*) from ps_services) = 1);
select pg_temp.check('dispenser cannot edit form fields',
  pg_temp.raises($$select ps_save_service_form_fields('40000000-0000-0000-0000-000000000001','[]')$$));

select pg_temp.check('dispenser completes a delivery with outcome and medicine',
  (select delivered_by = '00000000-0000-0000-0000-00000000000b' and form_version = 1
          and form_snapshot->'fields'->0->>'label' = 'Systolic'
   from ps_complete_service_delivery('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
     '50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
     '{"SYS":120}','note','{"outcome_type":"prescription"}','[{"drug_name":"Amlodipine","quantity":"28"},{"drug_name":"  "}]')));
select pg_temp.check('blank medicine lines are skipped', (select count(*) from ps_delivery_outcome_medications) = 1);
select pg_temp.check('retry with the same client_ref saves nothing new',
  (select count(*) from ps_complete_service_delivery('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
     '50000000-0000-0000-0000-000000000001')) = 1
  and (select count(*) from ps_service_deliveries) = 1 and (select count(*) from ps_delivery_outcomes) = 1);
select pg_temp.check('another pharmacy''s patient is refused',
  pg_temp.raises($$select ps_complete_service_delivery('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
     '50000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002')$$));
select pg_temp.check('a completed record cannot be inserted directly',
  pg_temp.raises($$insert into ps_service_deliveries(org_id,service_id,status) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','completed')$$));
select pg_temp.check('a draft can be inserted and delivered_by is forced',
  pg_temp.touched($$insert into ps_service_deliveries(id,org_id,service_id,status,delivered_by) values ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','draft','00000000-0000-0000-0000-00000000000a')$$) = 1);
select pg_temp.check('delivered_by on the draft is the signed-in person, not what was sent',
  (select delivered_by from ps_service_deliveries where id = '60000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000b');
select pg_temp.check('the author can edit their draft',
  pg_temp.touched($$update ps_service_deliveries set notes='draft edit' where id='60000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check('a draft cannot be completed by a plain update',
  pg_temp.raises($$update ps_service_deliveries set status='completed' where id='60000000-0000-0000-0000-000000000001'$$));
select pg_temp.check('a completed record cannot be updated',
  pg_temp.touched($$update ps_service_deliveries set notes='x' where status='completed'$$) = 0);
select pg_temp.check('a completed record cannot be deleted',
  pg_temp.touched($$delete from ps_service_deliveries where status='completed'$$) = 0);
select pg_temp.check('a completed record''s outcome cannot be changed',
  pg_temp.raises($$update ps_delivery_outcomes set outcome_type='advice'$$));
select pg_temp.check('a completed record''s medicines cannot be deleted',
  pg_temp.raises($$delete from ps_delivery_outcome_medications$$));
select pg_temp.check('dispenser cannot amend',
  pg_temp.raises($$select ps_amend_service_delivery((select id from ps_service_deliveries where status='completed'),'typo fix', null, 'x')$$));

-- Pharmacist (a)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('pharmacist cannot edit someone else''s draft',
  pg_temp.touched($$update ps_service_deliveries set notes='a' where id='60000000-0000-0000-0000-000000000001'$$) = 0);
select pg_temp.check('amendment needs a reason',
  pg_temp.raises($$select ps_amend_service_delivery((select id from ps_service_deliveries where status='completed'),'no', null, 'x')$$));
select pg_temp.check('pharmacist amends with a reason',
  (select amendment_count = 1 and form_data = '{"SYS":130}'::jsonb
   from ps_amend_service_delivery((select id from ps_service_deliveries where status='completed'),'Corrected BP reading','{"SYS":130}', null)));
select pg_temp.check('audit trail has completed + amended with before/after',
  (select count(*) from ps_service_delivery_events where event='completed') = 1
  and (select before->'form_data' = '{"SYS":120}'::jsonb and after->'form_data' = '{"SYS":130}'::jsonb and reason = 'Corrected BP reading'
       from ps_service_delivery_events where event='amended'));
select pg_temp.check('nobody can write to the audit trail directly',
  pg_temp.raises($$insert into ps_service_delivery_events(delivery_id,org_id,event) select id, org_id, 'amended' from ps_service_deliveries limit 1$$)
  or pg_temp.touched($$delete from ps_service_delivery_events$$) = 0);

-- Dispenser completes their own draft
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('author completes their draft through the function',
  (select status = 'completed' from ps_complete_service_delivery('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
     '50000000-0000-0000-0000-000000000002', null, null, '{}', '', null, '[]', '60000000-0000-0000-0000-000000000001')));

-- Pharmacist manages forms and services
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('pharmacist saves form fields in one go and the version goes up',
  (select ps_save_service_form_fields('40000000-0000-0000-0000-000000000001',
     '[{"label":"Systolic","field_key":"SYS","is_required":true},{"label":"Diastolic","field_key":"DIA","options":null}]')) = 2);
select pg_temp.check('the form now has both fields', (select count(*) from ps_service_form_fields) = 2);
select pg_temp.check('old record keeps its form snapshot after the form changes',
  (select jsonb_array_length(form_snapshot->'fields') = 1 from ps_service_deliveries where client_ref = '50000000-0000-0000-0000-000000000001'));
select pg_temp.check('services cannot be deleted by staff',
  pg_temp.touched($$delete from ps_services$$) = 0);
select pg_temp.check('forms cannot be deleted by staff',
  pg_temp.touched($$delete from ps_service_forms$$) = 0);
select pg_temp.check('pharmacist archives the service',
  pg_temp.touched($$update ps_services set is_active=false, archived_at=now()$$) = 1);
select pg_temp.check('an archived service cannot be delivered',
  pg_temp.raises($$select ps_complete_service_delivery('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003')$$));
select pg_temp.check('records survive archiving', (select count(*) from ps_service_deliveries) = 2);

-- Other pharmacy
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check('another pharmacy sees no records or audit rows',
  (select count(*) from ps_service_deliveries) = 0 and (select count(*) from ps_service_delivery_events) = 0);
select pg_temp.check('another pharmacy cannot amend',
  pg_temp.raises($$select ps_amend_service_delivery('60000000-0000-0000-0000-000000000001','Trying to change it', null, 'x')$$));

reset role;
select pg_temp.as_user('');
select pg_temp.check('a service with records cannot be hard-deleted even by the database owner',
  pg_temp.raises($$delete from ps_services where id='30000000-0000-0000-0000-000000000001'$$));
select pg_temp.check('deleting a whole pharmacy still works (service role)',
  pg_temp.touched($$delete from ps_organisations where id='10000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check('and its records go with it', (select count(*) from ps_service_deliveries) = 0);
