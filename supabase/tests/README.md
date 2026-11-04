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
