-- Throwaway local Postgres 16 setup for the services tests. Recreates the
-- services tables and the London policies as of 3 Nov 2026 (open FOR ALL
-- policies, cascading foreign keys) and stubs auth.uid().
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create table ps_organisations(id uuid primary key default gen_random_uuid(), name text, is_public boolean default false);
create table ps_user_profiles(id uuid primary key references auth.users(id));
create table ps_organisation_members(id uuid primary key default gen_random_uuid(), organisation_id uuid not null references ps_organisations(id) on delete cascade, user_id uuid not null, role text not null default 'dispenser', permissions jsonb default '{}', status text default 'active', access_expires_at timestamptz);
create table ps_patients(id uuid primary key default gen_random_uuid(), auth_user_id uuid, organisation_id uuid not null references ps_organisations(id) on delete cascade, first_name text not null, last_name text not null, nhs_number text, dob date, phone text);
create table ps_service_library(id uuid primary key default gen_random_uuid(), name text, is_nhs_service boolean default false);
create table ps_services(id uuid primary key default gen_random_uuid(), org_id uuid not null references ps_organisations(id) on delete cascade, library_service_id uuid references ps_service_library(id) on delete set null, name text not null, description text default '' not null, is_active boolean default true not null, is_public boolean default false not null, duration_minutes int default 15 not null, created_at timestamptz default now() not null, is_nhs_service boolean default false not null);
create table ps_service_forms(id uuid primary key default gen_random_uuid(), service_id uuid references ps_service_library(id) on delete cascade, name text default 'Default' not null, is_default boolean default false not null, version int default 1 not null, created_at timestamptz default now() not null, org_service_id uuid references ps_services(id) on delete cascade, check (num_nonnulls(service_id, org_service_id) = 1));
create table ps_service_form_fields(id uuid primary key default gen_random_uuid(), form_id uuid not null references ps_service_forms(id) on delete cascade, label text not null, field_key text not null, field_type text default 'text' not null, options jsonb, is_required boolean default false not null, display_order int default 0 not null);
create table ps_service_deliveries(id uuid primary key default gen_random_uuid(), org_id uuid not null references ps_organisations(id) on delete cascade, service_id uuid not null, patient_id uuid references ps_patients(id) on delete set null, form_id uuid, form_data jsonb default '{}' not null, delivered_by uuid references ps_user_profiles(id) on delete set null, notes text default '' not null, status text default 'completed' not null check (status in ('draft','completed')), created_at timestamptz default now() not null, completed_at timestamptz);
alter table ps_service_deliveries add constraint ps_service_deliveries_service_id_fkey foreign key (service_id) references ps_services(id) on delete cascade;
alter table ps_service_deliveries add constraint ps_service_deliveries_form_id_fkey foreign key (form_id) references ps_service_forms(id) on delete set null;
create table ps_delivery_outcomes(id uuid primary key default gen_random_uuid(), delivery_id uuid not null references ps_service_deliveries(id) on delete cascade, org_id uuid not null, outcome_type text default 'advice' not null check (outcome_type in ('prescription','referral','advice','no_treatment')), referral_to text, referral_reason text, referral_urgency text, advice_given text, created_by uuid, created_at timestamptz default now() not null, updated_at timestamptz default now() not null);
create table ps_delivery_outcome_medications(id uuid primary key default gen_random_uuid(), outcome_id uuid not null references ps_delivery_outcomes(id) on delete cascade, drug_id uuid, drug_name text not null, drug_form text, drug_strength text, dose text, quantity int, unit text, is_controlled_drug boolean default false not null, sort_order int default 0 not null, created_at timestamptz default now() not null);
create function ps_get_user_org_ids() returns setof uuid language sql stable security definer set search_path=public as $$ select organisation_id from ps_organisation_members where user_id = auth.uid() and status='active' $$;
alter table ps_services enable row level security; alter table ps_service_forms enable row level security; alter table ps_service_form_fields enable row level security; alter table ps_service_deliveries enable row level security; alter table ps_delivery_outcomes enable row level security; alter table ps_delivery_outcome_medications enable row level security; alter table ps_patients enable row level security;
create policy org_members_crud_services on ps_services for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
create policy org_members_crud_deliveries on ps_service_deliveries for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
create policy org_members_crud_custom_service_forms on ps_service_forms for all to authenticated using (org_service_id in (select s.id from ps_services s where s.org_id in (select ps_get_user_org_ids())));
create policy org_members_crud_custom_form_fields on ps_service_form_fields for all to authenticated using (true);
create policy outcomes_all on ps_delivery_outcomes for all using (org_id in (select ps_get_user_org_ids())) with check (org_id in (select ps_get_user_org_ids()));
create policy meds_all on ps_delivery_outcome_medications for all using (true) with check (true);
create policy patients_org on ps_patients for all using (organisation_id in (select ps_get_user_org_ids())) with check (organisation_id in (select ps_get_user_org_ids()));
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
create policy patients_read_own_deliveries on ps_service_deliveries for select using (patient_id in (select id from ps_patients where auth_user_id = auth.uid()));
