\set ON_ERROR_STOP 0
-- Part C checks. Run after the setup file, parts A and B, the
-- ps_role_default_permission function from 20261104123000 and part C.
-- Uses the fixtures created by cd_register_rls_test.sql (run that first).
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create function pg_temp.fails(name text, sql text) returns void language plpgsql as $$ begin
  begin execute sql; raise notice 'FAIL % (it succeeded)', name; exception when others then raise notice 'PASS % (refused: %)', name, sqlerrm; end; end $$;
create function pg_temp.works(name text, sql text) returns void language plpgsql as $$ begin
  begin execute sql; raise notice 'PASS %', name; exception when others then raise notice 'FAIL % (%)', name, sqlerrm; end; end $$;
create function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin
  raise notice '% %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into ps_register_ledgers(organisation_id,register_type,drug_name) values ('a0000000-0000-0000-0000-000000000000','RETURNS','Patient CD Returns Register');
set role authenticated;
-- RP record
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.works('pharmacist signs in as RP', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RP'), p_register_type=>'RP', p_pharmacist_name=>'P', p_gphc_number=>'2000001', p_rp_signed_in_at=>now())$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.fails('technician cannot sign RP record', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RP'), p_register_type=>'RP', p_pharmacist_name=>'T', p_gphc_number=>'2000002', p_rp_signed_in_at=>now())$$);
select pg_temp.fails('technician cannot correct RP record', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RP'), p_register_type=>'RP', p_entry_type=>'correction', p_corrects_entry_id=>(select id from ps_register_entries where register_type='RP' limit 1), p_correction_reason=>'x', p_pharmacist_name=>'T', p_gphc_number=>'2000002', p_rp_signed_in_at=>now())$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');
select pg_temp.fails('manager cannot sign RP record', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RP'), p_register_type=>'RP', p_pharmacist_name=>'M', p_gphc_number=>'2000003', p_rp_signed_in_at=>now())$$);
-- Returns
select pg_temp.works('manager records a patient return', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RETURNS'), p_register_type=>'RETURNS', p_return_patient_name=>'A', p_return_drug_name=>'Zomorph', p_return_quantity=>3)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.works('technician records a patient return', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RETURNS'), p_register_type=>'RETURNS', p_return_patient_name=>'B', p_return_drug_name=>'Zomorph', p_return_quantity=>2)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');
select pg_temp.fails('dispenser cannot record a patient return', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='RETURNS'), p_register_type=>'RETURNS', p_return_patient_name=>'C', p_return_drug_name=>'Zomorph', p_return_quantity=>1)$$);
-- AI scans
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.works('technician uploads a scan', $$insert into ps_ai_scan_queue(organisation_id,uploaded_by) values ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003')$$);
select pg_temp.works('technician adds scan item', $$insert into ps_ai_scan_items(organisation_id,scan_id,drug_name_raw) select organisation_id,id,'Zomorph' from ps_ai_scan_queue$$);
select pg_temp.check('technician sees scan', (select count(*)=1 from ps_ai_scan_queue));
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');
select pg_temp.check('dispenser sees no scans', (select count(*)=0 from ps_ai_scan_queue) and (select count(*)=0 from ps_ai_scan_items));
select pg_temp.fails('dispenser cannot upload a scan', $$insert into ps_ai_scan_queue(organisation_id,uploaded_by) values ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000004')$$);
select pg_temp.as_user('20000000-0000-0000-0000-000000000001');
select pg_temp.check('other pharmacy sees no scans', (select count(*)=0 from ps_ai_scan_queue));
select pg_temp.fails('other pharmacy cannot add scan', $$insert into ps_ai_scan_queue(organisation_id,uploaded_by) values ('a0000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001')$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.works('pharmacist deletes scan', $$delete from ps_ai_scan_queue$$);
reset role;
set role anon;
select pg_temp.fails('anon cannot read scans', $$select 1 from ps_ai_scan_queue$$);
reset role;
