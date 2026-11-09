-- PEPS access tests. Runs in one transaction and rolls back, so it leaves nothing behind.
--
-- Run against a fresh database built from supabase/migrations (the baseline plus the PEPS
-- phase migrations). Prints "PEPS access tests passed" or stops at the first failure.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/peps_access_test.sql
--
-- People: prescriber P (active), pending prescriber Q, pharmacist A (verified pharmacy A),
-- pharmacist B (verified pharmacy B), pharmacist U (unverified pharmacy U), patient account X,
-- platform admin Z.

\o /dev/null
begin;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('role', case when p is null then 'anon' else 'authenticated' end, true);
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;
-- Expect fn to raise; returns the message
create or replace function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED (no error): %', what;
exception when others then
  if sqlerrm like 'FAILED (no error)%' then raise; end if;
end $$;

-- Fixed ids
\set P  '''00000000-0000-0000-0000-0000000000a1'''
\set Q  '''00000000-0000-0000-0000-0000000000a2'''
\set A  '''00000000-0000-0000-0000-0000000000b1'''
\set B  '''00000000-0000-0000-0000-0000000000b2'''
\set U  '''00000000-0000-0000-0000-0000000000b3'''
\set X  '''00000000-0000-0000-0000-0000000000c1'''
\set Z  '''00000000-0000-0000-0000-0000000000d1'''
\set OA '''00000000-0000-0000-0000-00000000aaa1'''
\set OB '''00000000-0000-0000-0000-00000000aaa2'''
\set OU '''00000000-0000-0000-0000-00000000aaa3'''

insert into auth.users (id, email) values
  (:P, 'p@test'), (:Q, 'q@test'), (:A, 'a@test'), (:B, 'b@test'), (:U, 'u@test'), (:X, 'x@test'), (:Z, 'z@test');
insert into ps_organisations (id, name, verification_status) values
  (:OA, 'Pharmacy A', 'verified'), (:OB, 'Pharmacy B', 'verified'), (:OU, 'Pharmacy U', 'pending');
insert into ps_organisation_members (organisation_id, user_id, status) values
  (:OA, :A, 'active'), (:OB, :B, 'active'), (:OU, :U, 'active');
insert into ps_platform_admins (user_id) values (:Z);

-- Prescribers register themselves; status is forced to pending
select pg_temp.as_user(:P);
insert into ps_peps_prescribers (user_id, full_name, prescriber_type, registration_number, address, status)
values (:P, 'Dr P Test', 'doctor', 'GMC0000001', '1 Surgery Road, Testtown, TT1 1TT', 'active');
select pg_temp.ok((select status from ps_peps_prescribers where user_id = :P) = 'pending', 'new prescriber starts pending');
select pg_temp.as_user(:Q);
insert into ps_peps_prescribers (user_id, full_name, prescriber_type, registration_number, address)
values (:Q, 'Dr Q Pending', 'doctor', 'GMC0000002', '2 Surgery Road, Testtown, TT1 1TT');

-- Only the admin can activate
select pg_temp.as_user(:P);
select pg_temp.fails($$select ps_admin_set_prescriber_status((select id from ps_peps_prescribers where registration_number = 'GMC0000001'), 'active')$$, 'prescriber cannot self-activate');
update ps_peps_prescribers set status = 'active' where user_id = :P;
select pg_temp.ok((select status from ps_peps_prescribers where user_id = :P) = 'pending', 'direct status update is ignored');
select pg_temp.as_user(:Z);
select ps_admin_set_prescriber_status(id, 'active') from ps_admin_list_prescribers('pending') where registration_number = 'GMC0000001';

-- PIN
select pg_temp.as_user(:P);
select pg_temp.fails($$select ps_peps_set_signing_pin('111111')$$, 'obvious PIN refused');
select ps_peps_set_signing_pin('482913');
select pg_temp.ok(ps_peps_has_signing_pin(), 'PIN set');
select pg_temp.fails($$select ps_peps_set_signing_pin('593024', '000000')$$, 'changing PIN needs the current one');

-- Direct writes are blocked
select pg_temp.fails($$insert into ps_peps_prescriptions (prescription_ref, prescriber_id, written_by) values ('PX-HACK-00000', (select id from ps_peps_prescribers where user_id = auth.uid()), auth.uid())$$, 'no direct prescription insert');
select pg_temp.fails($$insert into ps_peps_events (prescription_id, event_type, actor_user_id) values (gen_random_uuid(), 'created', auth.uid())$$, 'no direct event insert');

-- Pending prescriber cannot write
select pg_temp.as_user(:Q);
select pg_temp.fails($$select ps_peps_create_prescription('{"items":[]}')$$, 'pending prescriber cannot write');

-- Writing: validation and PIN
select pg_temp.as_user(:P);
create temp table rx_ids (k text primary key, id uuid, ref text);
grant all on rx_ids to authenticated;
select pg_temp.fails($$select ps_peps_create_prescription(jsonb_build_object('prescription_type','private','pin','482913',
  'patient_snapshot', jsonb_build_object('full_name','Jo Bloggs','address','3 High St, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_code','V1','dmd_type','vmp','drug_name','Amoxicillin','quantity','21'))))$$, 'DOB required');
select pg_temp.fails($$select ps_peps_create_prescription(jsonb_build_object('prescription_type','private','pin','482913',
  'patient_snapshot', jsonb_build_object('full_name','Jo Bloggs','dob','1980-02-01','address','3 High St, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_code','V2','dmd_type','vmp','drug_name','Morphine','quantity','100ml'))))$$, 'Schedule 2 blocked');
select pg_temp.ok((select ps_peps_create_prescription(jsonb_build_object('prescription_type','private','pin','000000',
  'patient_snapshot', jsonb_build_object('full_name','Jo Bloggs','dob','1980-02-01','address','3 High St, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_code','V1','dmd_type','vmp','drug_name','Amoxicillin','quantity','21'))))).id is null, 'wrong PIN returns nothing');

-- Spine prescription (open) and one directed to pharmacy A
insert into rx_ids select 'spine', r.id, r.prescription_ref from ps_peps_create_prescription(jsonb_build_object('prescription_type','private','pin','482913',
  'patient_snapshot', jsonb_build_object('full_name','Jo Bloggs','last_name','Bloggs','dob','1980-02-01','address','3 High St, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_code','V1','dmd_type','vmp','drug_name','Amoxicillin','quantity','21')))) r;
insert into rx_ids select 'directed', r.id, r.prescription_ref from ps_peps_create_prescription(jsonb_build_object('prescription_type','private','pin','482913',
  'assigned_org_id', :OA,
  'patient_snapshot', jsonb_build_object('full_name','Sam Smith','dob','1990-05-06','address','4 Low St, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_code','V3','dmd_type','vmp','drug_name','Diazepam','quantity','14')))) r;
select pg_temp.ok((select count(*) from rx_ids) = 2, 'two prescriptions written');
select pg_temp.ok((select expires_at::date - current_date from ps_peps_prescriptions where id = (select id from rx_ids where k = 'directed')) between 26 and 28, 'Schedule 4 expires in 28 days');
select pg_temp.ok((ps_peps_verify((select id from rx_ids where k = 'spine'))->>'status') = 'verified', 'sealed on write');

-- Who can read
select pg_temp.as_user(:X);
select pg_temp.ok((select count(*) from ps_peps_prescriptions) = 0, 'patient account reads nothing');
select pg_temp.ok((select count(*) from ps_peps_prescribers) = 0, 'patient account cannot list prescribers');
select pg_temp.as_user(null);
select pg_temp.fails($$select case when count(*) > 0 then 1 else 1/0 end from ps_peps_prescriptions$$, 'anon reads nothing (no grant, or zero rows)');
select pg_temp.as_user(:U);
select pg_temp.ok((select count(*) from ps_peps_prescriptions) = 0, 'unverified pharmacy reads nothing');
select pg_temp.fails($$select ps_peps_download('00000000-0000-0000-0000-00000000aaa3'::uuid, null)$$, 'unverified pharmacy cannot download');
select pg_temp.as_user(:B);
select pg_temp.ok((select count(*) from ps_peps_prescriptions) = 0, 'pharmacy B cannot list the open spine or A''s prescriptions');
select pg_temp.as_user(:A);
select pg_temp.ok((select count(*) from ps_peps_prescriptions) = 1, 'pharmacy A reads only the one sent to it');

-- Claiming the open spine prescription needs the reference plus surname or DOB
select pg_temp.as_user(:B);
select pg_temp.ok((ps_peps_claim(:OB, (select ref from rx_ids where k = 'spine'), 'Wrongname')).id is null, 'wrong surname does not claim');
select pg_temp.ok((ps_peps_claim(:OB, (select ref from rx_ids where k = 'spine'), '01/02/1980')).id is not null, 'reference plus DOB claims');
select pg_temp.ok((select status from ps_peps_prescriptions where id = (select id from rx_ids where k = 'spine')) = 'held', 'claimed prescription is held');
select pg_temp.as_user(:U);
select pg_temp.fails($$select ps_peps_claim('00000000-0000-0000-0000-00000000aaa3'::uuid, 'PX-AAAA-AAAAA', 'Bloggs')$$, 'unverified pharmacy cannot claim');

-- Download, dispense, release, transfer
select pg_temp.as_user(:B);
select pg_temp.fails(format('select ps_peps_dispense(%L::uuid)', (select id from rx_ids where k = 'directed')), 'B cannot dispense A''s prescription');
select pg_temp.as_user(:A);
select pg_temp.ok((select count(*) from ps_peps_download(:OA, null)) = 1, 'A downloads its directed prescription');
select ps_peps_dispense((select id from rx_ids where k = 'directed'), '[{"item":"Diazepam","quantity":"14","note":"batch T1"}]');
select pg_temp.ok((select status from ps_peps_prescriptions where id = (select id from rx_ids where k = 'directed')) = 'dispensed', 'dispensed');
select pg_temp.fails(format('select ps_peps_cancel(%L::uuid, %L)', (select id from rx_ids where k = 'directed'), 'test'), 'pharmacy cannot cancel');
select pg_temp.as_user(:B);
select ps_peps_transfer((select id from rx_ids where k = 'spine'), :OA);
select pg_temp.as_user(:A);
select pg_temp.ok((select count(*) from ps_peps_download(:OA, null)) = 1, 'A downloads the transferred prescription');
select ps_peps_release((select id from rx_ids where k = 'spine'));
select pg_temp.ok((select assigned_org_id is null and status = 'available' from ps_peps_prescriptions where id = (select id from rx_ids where k = 'spine')) is null, 'released prescription leaves A''s view');

-- Events: only the app-loggable ones, only by the holder
select pg_temp.fails(format('select ps_peps_log_event(%L::uuid, %L)', (select id from rx_ids where k = 'directed'), 'dispensed'), 'cannot log a dispensed event by hand');
select ps_peps_log_event((select id from rx_ids where k = 'directed'), 'printed', '{"print_mode":"COPY"}');
select pg_temp.as_user(:B);
select pg_temp.fails(format('select ps_peps_log_event(%L::uuid, %L)', (select id from rx_ids where k = 'directed'), 'printed'), 'B cannot log on A''s prescription');

-- Prescriber cancels the open one; suspended prescriber blocks dispensing
select pg_temp.as_user(:P);
select ps_peps_cancel((select id from rx_ids where k = 'spine'), 'Wrong dose');
select pg_temp.ok((select status from ps_peps_prescriptions where id = (select id from rx_ids where k = 'spine')) = 'cancelled', 'prescriber cancels');
insert into rx_ids select 'later', r.id, r.prescription_ref from ps_peps_create_prescription(jsonb_build_object('prescription_type','vet','pin','482913',
  'assigned_org_id', :OA, 'animal_name', 'Rex', 'confirm_no_sch123', true,
  'patient_snapshot', jsonb_build_object('full_name','Owner Person','address','5 Farm Lane, Testtown'),
  'items', jsonb_build_array(jsonb_build_object('dmd_type','free_text','drug_name','Vet wormer','quantity','1')))) r;
select pg_temp.as_user(:Z);
select ps_admin_set_prescriber_status(id, 'suspended') from ps_admin_list_prescribers(null) where registration_number = 'GMC0000001';
select pg_temp.as_user(:A);
select pg_temp.fails($$select ps_peps_download('00000000-0000-0000-0000-00000000aaa1'::uuid, null)$$, 'suspended prescriber''s prescription cannot be downloaded');

-- Signing keys are never readable
select pg_temp.as_user(:P);
select pg_temp.fails($$select * from ps_peps_signing_keys$$, 'signing keys not readable');

select pg_temp.as_admin();
\echo 'PEPS access tests passed'
rollback;
