\set ON_ERROR_STOP 0
-- fixtures (as postgres)
insert into cdr_drugs_unique(id,drug_brand,drug_type,drug_form,drug_strength,drug_class) values
 ('d0000000-0000-0000-0000-000000000001','Zomorph','CD2','capsule','10mg','Morphine'),
 ('d0000000-0000-0000-0000-000000000002','OxyContin','CD2','tablet','5mg','Oxycodone');
-- org A: owner, pharmacist, technician, dispenser, carehome, suspended pharmacist, dispenser with override, manager; org B pharmacist
insert into ps_organisation_members(organisation_id,user_id,role,status,permissions) values
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','owner','active','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','pharmacist','active','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003','technician','active','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000004','dispenser','active','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000005','carehome_user','active','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000006','pharmacist','suspended','{}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000007','dispenser','active','{"cd_register_read":true,"cd_register_write":true}'),
 ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000008','manager','active','{"cd_register_write":false}'),
 ('b0000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','pharmacist','active','{}');
insert into ps_user_profiles values ('10000000-0000-0000-0000-000000000001','Owner',null),('10000000-0000-0000-0000-000000000007','Disp override',null);

create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin
  raise notice '% %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create function pg_temp.fails(name text, sql text) returns void language plpgsql as $$ begin
  begin execute sql; raise notice 'FAIL % (it succeeded)', name; exception when others then raise notice 'PASS % (refused: %)', name, sqlerrm; end; end $$;
create function pg_temp.works(name text, sql text) returns void language plpgsql as $$ begin
  begin execute sql; raise notice 'PASS %', name; exception when others then raise notice 'FAIL % (%)', name, sqlerrm; end; end $$;
grant execute on all functions in schema pg_temp to authenticated;
set role authenticated;
-- owner adds Zomorph with opening balance 56
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.works('owner creates register with opening 56', $$select ps_create_cd_register('a0000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000001',56,'stock count on go-live')$$);
select pg_temp.check('opening line written', (select count(*)=1 and min(running_balance)=56 and min(transaction_type)='opening_balance' from ps_register_entries));
select pg_temp.check('ledger balance 56', (select current_balance=56 and entry_count=1 from ps_register_ledgers where register_type='CD'));
select pg_temp.check('register in list', (select count(*)=1 from ps_subscribed_registers));
select pg_temp.works('re-adding is harmless', $$select ps_create_cd_register('a0000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000001',99)$$);
select pg_temp.check('still one opening line', (select count(*)=1 from ps_register_entries));
select pg_temp.fails('second opening balance refused', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'opening_balance', p_quantity_received=>5)$$);
-- direct writes
select pg_temp.fails('direct entry insert refused', $$insert into ps_register_entries(ledger_id,organisation_id,entry_number,register_type,entry_type,entered_by,ledger_lock_version,quantity_received,transaction_type) select id, organisation_id, 2,'CD','normal','10000000-0000-0000-0000-000000000001',1,1000,'receipt' from ps_register_ledgers where register_type='CD'$$);
select pg_temp.fails('direct CD ledger insert refused', $$insert into ps_register_ledgers(organisation_id,register_type,drug_id,drug_name) values ('a0000000-0000-0000-0000-000000000000','CD','d0000000-0000-0000-0000-000000000002','x')$$);
select pg_temp.fails('ledger balance cannot be set on insert', $$insert into ps_register_ledgers(organisation_id,register_type,drug_name,current_balance) values ('a0000000-0000-0000-0000-000000000000','RETURNS','r',500)$$);
select pg_temp.works('RP ledger insert still works', $$insert into ps_register_ledgers(organisation_id,register_type,drug_name) values ('a0000000-0000-0000-0000-000000000000','RP','Responsible Pharmacist Log')$$);
select pg_temp.fails('ledger update refused', $$update ps_register_ledgers set current_balance=1$$);
-- pharmacist supply, technician receipt
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.works('pharmacist supplies 6', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'supply', p_quantity_deducted=>6, p_collector_type=>'patient')$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.works('technician receives 10', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>10)$$);
select pg_temp.fails('technician cannot correct', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_entry_type=>'correction', p_corrects_entry_id=>(select id from ps_register_entries where entry_number=2), p_correction_reason=>'x')$$);
select pg_temp.works('technician approves AI scan', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_source=>'ai_scan', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.works('pharmacist corrects', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_entry_type=>'correction', p_corrects_entry_id=>(select id from ps_register_entries where entry_number=2), p_correction_reason=>'wrong qty')$$);
select pg_temp.fails('negative stock refused', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'supply', p_quantity_deducted=>1000)$$);
select pg_temp.fails('stale lock version refused', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'supply', p_quantity_deducted=>1, p_expected_lock_version=>0)$$);
-- owner: write yes, ai scan no (no GPhC number), correct no
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.works('owner can write', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'supply', p_quantity_deducted=>1)$$);
select pg_temp.fails('owner without GPhC cannot approve AI scan', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_source=>'ai_scan', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
reset role; update ps_user_profiles set gphc_number='2012345' where id='10000000-0000-0000-0000-000000000001'; set role authenticated;
select pg_temp.works('owner with GPhC can approve AI scan', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_source=>'ai_scan', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
-- dispenser, carehome, suspended, manager override
reset role; select set_config('t.ledger',(select id::text from ps_register_ledgers where register_type='CD'),false); set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');
select pg_temp.fails('dispenser cannot write (explicit id)', $$select ps_make_register_entry(p_ledger_id=>current_setting('t.ledger')::uuid, p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.fails('dispenser cannot write', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.check('dispenser cannot read CD entries', (select count(*)=0 from ps_register_entries));
select pg_temp.check('dispenser cannot see CD list', (select count(*)=0 from ps_subscribed_registers));
select pg_temp.check('dispenser still sees RP ledger', (select count(*)=1 from ps_register_ledgers));
select pg_temp.fails('dispenser cannot add register', $$select ps_create_cd_register('a0000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000002',0)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.check('care-home user cannot read CD', (select count(*)=0 from ps_register_entries));
select pg_temp.fails('care-home user cannot write (explicit id)', $$select ps_make_register_entry(p_ledger_id=>current_setting('t.ledger')::uuid, p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000006');
select pg_temp.fails('suspended pharmacist cannot write (explicit id)', $$select ps_make_register_entry(p_ledger_id=>current_setting('t.ledger')::uuid, p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.fails('suspended pharmacist cannot write', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.check('suspended cannot see list', (select count(*)=0 from ps_subscribed_registers));
select pg_temp.as_user('10000000-0000-0000-0000-000000000007');
select pg_temp.works('dispenser with override can write', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.fails('dispenser without GPhC cannot approve AI scan', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_source=>'ai_scan', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');
select pg_temp.fails('manager with write=false override cannot write', $$select ps_make_register_entry(p_ledger_id=>(select id from ps_register_ledgers where register_type='CD'), p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$);
-- other pharmacy
select pg_temp.as_user('20000000-0000-0000-0000-000000000001');
select pg_temp.check('other pharmacy sees nothing', (select count(*)=0 from ps_register_entries) and (select count(*)=0 from ps_register_ledgers) and (select count(*)=0 from ps_subscribed_registers));
select pg_temp.fails('other pharmacy cannot write', $$select ps_make_register_entry(p_ledger_id=>'00000000-0000-0000-0000-000000000000'::uuid, p_register_type=>'CD')$$);
reset role;
select pg_temp.fails('other pharmacy cannot write to A ledger', format($$set role authenticated; select pg_temp.as_user('20000000-0000-0000-0000-000000000001'); select ps_make_register_entry(p_ledger_id=>%L, p_register_type=>'CD', p_transaction_type=>'receipt', p_quantity_received=>1)$$, (select id from ps_register_ledgers where register_type='CD')));
reset role; set role authenticated;
-- removing a register
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
delete from ps_subscribed_registers;
select pg_temp.check('pharmacist cannot remove register', (select count(*)=1 from ps_subscribed_registers));
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
delete from ps_subscribed_registers;
select pg_temp.check('owner cannot remove register with stock', (select count(*)=1 from ps_subscribed_registers));
-- balance checks
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.works('pharmacist saves completed quick check session', $$insert into ps_balance_check_sessions(id,organisation_id,started_by,status,total_registers,checked_count,completed_at,completed_by) values ('5e000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','completed',1,1,now(),'10000000-0000-0000-0000-000000000002')$$);
select pg_temp.works('pharmacist saves quick check item', $$insert into ps_balance_check_items(session_id,organisation_id,drug_id,ledger_id,drug_brand,drug_form,drug_strength,drug_class,expected_balance,actual_count,status) select '5e000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000000','d0000000-0000-0000-0000-000000000001',(select id from ps_register_ledgers where register_type='CD'),'Z','c','10','M',62,62,'matched'$$);
update ps_balance_check_items set actual_count=1;
select pg_temp.check('completed check item cannot be edited', (select actual_count=62 from ps_balance_check_items));
update ps_balance_check_sessions set notes='changed';
select pg_temp.check('completed session cannot be edited', (select notes is null from ps_balance_check_sessions));
select pg_temp.works('in-progress session can be completed', $$with s as (insert into ps_balance_check_sessions(organisation_id,started_by) values ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002') returning id) update ps_balance_check_sessions set status='completed' where id in (select id from s)$$);
select pg_temp.fails('dispenser cannot start check', $$select pg_temp.as_user('10000000-0000-0000-0000-000000000004'); insert into ps_balance_check_sessions(organisation_id,started_by) values ('a0000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000004')$$);
reset role;
select pg_temp.check('ledger balance equals last running balance', (select l.current_balance = (select running_balance from ps_register_entries e where e.ledger_id=l.id order by entry_number desc limit 1) from ps_register_ledgers l where register_type='CD'));
select pg_temp.check('entry numbers have no gaps', (select max(entry_number)=count(*) from ps_register_entries));
set role anon;
select pg_temp.fails('anon cannot read entries', $$select 1 from ps_register_entries limit 1$$);
