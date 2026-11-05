# Database tests

## CD register (row security and entry rules)

Runs against a throwaway local Postgres 16, not a Supabase project. The setup file
recreates the CD tables, the London policies as of 3 Nov 2026, and stubs `auth.uid()`.

```bash
createdb -h <socket> -p <port> -U postgres cd_test
psql ... -d cd_test -f supabase/tests/cd_register_test_setup.sql
psql ... -d cd_test -f supabase/migrations/20261104090000_cd_register_part_a_additive.sql
psql ... -d cd_test -f supabase/migrations/20261104090100_cd_register_part_b_lockdown.sql
psql ... -d cd_test -f supabase/tests/cd_register_rls_test.sql 2>&1 | grep -E 'PASS|FAIL'
```

Every line must say PASS (50 checks as of 4 Nov 2026).

### Part C (RP record, patient returns, AI scans)

On the same database, after the run above: create the two scan tables with the
3 Nov membership-only policies, load `ps_role_default_permission` from
`20261104123000_role_permissions_foundation.sql`, then:

```bash
psql ... -d cd_test -f supabase/migrations/20261104150000_cd_register_part_c_rp_returns_scans.sql
psql ... -d cd_test -f supabase/tests/cd_register_part_c_test.sql 2>&1 | grep -E 'PASS|FAIL'
```

16 checks, all PASS. Part C refuses to run before the foundation function is in place.

## Services (clinical service records)

Fresh database each run:

```bash
createdb -h <socket> -p <port> -U postgres svc_test
psql ... -d svc_test -f supabase/tests/services_test_setup.sql
psql ... -d svc_test -f supabase/migrations/20261105160000_services_records_protection.sql
psql ... -d svc_test -t -f supabase/tests/services_records_protection_test.sql | grep -E 'PASS|FAIL'
```

38 checks, all PASS (5 Nov 2026). The rollback file also applies cleanly and the
migration re-applies after it.
