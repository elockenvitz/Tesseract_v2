# Isolated validation environment — execution procedure

Schema-only production snapshot, synthetic fixtures, no production research
data. Operational steps only; the reasoning lives in
`docs/contribution-visibility-test-setup.md`.

---

## 0. Prerequisites and limitations — read first

| | |
|---|---|
| **`pg_dump` version** | Must be ≥ the server's major version. Supabase runs PG15/17; a PG13 client fails with a version error. `pg_dump --version`. |
| **Direct connection, not the pooler** | Dump and restore need the **session/direct** connection (port `5432`), not the transaction pooler (`6543`). The pooler does not support the statements `pg_dump` issues. |
| **IPv6** | Supabase direct connections are IPv6-only on many projects. If your network is IPv4-only, use the **session pooler** host from the dashboard (Connect → Session pooler) or the IPv4 add-on. |
| **Roles are NOT in the dump** | `pg_dump --schema-only` dumps objects, **not roles**. `anon`, `authenticated`, `service_role` and the `supabase_*` owners must be created in the target first, or the restore emits hundreds of "role does not exist" errors and grants silently vanish. Step 2 handles this. |
| **`auth.uid()` must survive** | The suites depend on it. It lives in the `auth` schema; a full-database schema dump includes it. Step 4 verifies it rather than assuming. |
| **Supabase branching is NOT suitable** | Branches seed from `supabase/migrations/`, which the preflight established do **not** describe production. A branch would test a different database. |
| **This is still not production** | The snapshot is schema-only and a point in time. If production changes, re-snapshot. |

**Nothing in this procedure writes to production.** Step 1 is the only command
that touches it, and `pg_dump --schema-only` is read-only.

---

## 1. Snapshot the production schema (read-only)

From the dashboard: **Connect → Session pooler** (or Direct connection), copy
the URI. Then:

```bash
export PROD_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'

pg_dump --schema-only --no-owner --no-privileges=false \
        --quote-all-identifiers \
        --exclude-schema='pg_*|information_schema' \
        "$PROD_URL" > /tmp/tesseract-schema.sql

grep -c 'CREATE POLICY' /tmp/tesseract-schema.sql     # expect ≥ 14
grep -c 'CREATE FUNCTION\|CREATE OR REPLACE FUNCTION' /tmp/tesseract-schema.sql
```

Keep `--no-owner` (the target has different owners) but **keep privileges** —
the GRANT statements are part of what is being tested.

> If `pg_dump` refuses on `auth`/`storage` objects it cannot read, add
> `--schema=public --schema=auth`. You need both: `public` for the tables,
> `auth` for `auth.uid()` and `auth.users`.

---

## 2. Create the isolated target, roles first

Local Postgres is simplest and costs nothing:

```bash
docker run -d --name tesseract-test \
  -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17

export DB_URL='postgresql://postgres:postgres@localhost:55432/postgres'
```

Create the roles **before** restoring:

```bash
psql "$DB_URL" <<'SQL'
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'anon','authenticated','service_role','authenticator',
    'supabase_auth_admin','supabase_storage_admin','supabase_admin',
    'dashboard_user','pgbouncer'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

---

## 3. Restore

```bash
psql "$DB_URL" -v ON_ERROR_STOP=0 -f /tmp/tesseract-schema.sql 2> /tmp/restore.log
grep -iE 'role .* does not exist|permission denied' /tmp/restore.log | sort -u | head
```

Errors about `supabase_*` extensions or `storage` objects are tolerable.
**Errors naming `anon`, `authenticated`, `public.asset_contributions`,
`public.contribution_visibility_targets` or `auth.uid` are not** — fix and
re-restore before going further.

---

## 4. Verify schema parity — **the gate**

One query. Every row must read `OK`; the expected values are the preflight's
recorded production answers.

```sql
WITH checks AS (
  SELECT 'policies on the 6 tables = 14' AS check,
         (SELECT count(*) FROM pg_policies WHERE schemaname='public'
           AND tablename IN ('asset_contributions','contribution_visibility_targets',
             'asset_contribution_history','asset_revisions','asset_revision_events',
             'asset_field_history'))::text AS actual, '14' AS expected
  UNION ALL SELECT 'team_id IS NULL branch present',
         (SELECT (qual LIKE '%team_id IS NULL%')::text FROM pg_policies
           WHERE policyname='asset_contributions_select'), 'true'
  UNION ALL SELECT 'history policy is visibility-blind',
         (SELECT (qual NOT LIKE '%visibility%')::text FROM pg_policies
           WHERE policyname='asset_contribution_history_select'), 'true'
  UNION ALL SELECT 'helper functions present',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN
             ('current_org_id','is_active_member_of_current_org',
              'contribution_in_current_org','can_view_contribution')), '4'
  UNION ALL SELECT 'auth.uid present',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='auth' AND p.proname='uid'), '1'
  UNION ALL SELECT 'triggers on asset_contributions',
         (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
           WHERE c.relname='asset_contributions' AND NOT t.tgisinternal), '2'
  UNION ALL SELECT 'history trigger present',
         (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
           WHERE c.relname='asset_contributions' AND t.tgname='contribution_history_trigger'), '1'
  UNION ALL SELECT 'unique tuple is 4 columns',
         (SELECT (pg_get_constraintdef(oid) LIKE '%organization_id%')::text
            FROM pg_constraint WHERE conname='unique_user_asset_section_org'), 'true'
  UNION ALL SELECT 'visibility CHECK present',
         (SELECT count(*)::text FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid
           WHERE r.relname='asset_contributions' AND con.contype='c'
             AND pg_get_constraintdef(con.oid) LIKE '%visibility%'), '1'
  UNION ALL SELECT 'RLS enabled on all 7',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relrowsecurity
             AND c.relname IN ('asset_contributions','contribution_visibility_targets',
               'asset_contribution_history','asset_revisions','asset_revision_events',
               'contribution_replies','contribution_reactions')), '7'
  UNION ALL SELECT 'no anon grants',
         (SELECT count(*)::text FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee='anon'
             AND table_name IN ('asset_contributions','contribution_visibility_targets',
               'asset_contribution_history','asset_revisions','asset_revision_events')), '0'
  UNION ALL SELECT 'authenticated has SIUD on the 5',
         (SELECT count(*)::text FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee='authenticated'
             AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
             AND table_name IN ('asset_contributions','contribution_visibility_targets',
               'asset_contribution_history','asset_revisions','asset_revision_events')), '20'
)
SELECT check, expected, actual,
       CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'OK' ELSE '*** MISMATCH ***' END
FROM checks ORDER BY 4 DESC, 1;
```

**Any `*** MISMATCH ***` stops the run.** The target is not
production-equivalent and a result from it would not mean what it appears to.

---

## 5. Baseline — before applying anything

```bash
psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql
psql "$DB_URL" -f supabase/tests/contribution-audience-management.sql
```

| Suite | Required | Failures must include |
|---|---|---|
| visibility-security | **9 PASS / 7 FAIL** | 3, 4, 6, 8, 13, 15, 16 |
| audience-management | **4 PASS / 10 FAIL** | all but 1, 2, 11, 14 |

**More passes than that → STOP.** The suite is not observing the defect.
Do not apply the SQL to make a test pass that was never seen failing.

---

## 6. Apply, in this order

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/sql/contribution-visibility/10-policy-fix.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/sql/contribution-visibility/20-audience-management.sql
```

`10-` first: it defines `can_read_asset_contribution`, which its own §3–5 use,
and `20-`'s revoke removes write paths the old policies assume.

---

## 7. The six role checks

```sql
-- 1  inert           expect: f | f | f
SELECT rolcanlogin, rolbypassrls, rolinherit FROM pg_roles
 WHERE rolname='tesseract_audience_writer';

-- 2  unheld          expect: 0
SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
 WHERE r.rolname='tesseract_audience_writer';

-- 3  owns the fn     expect: tesseract_audience_writer | t
SELECT pg_get_userbyid(proowner), prosecdef FROM pg_proc
 WHERE proname='set_contribution_audience';

-- 4  callable by     expect: {authenticated}
SELECT array(SELECT a.rolname FROM pg_roles a
   WHERE has_function_privilege(a.rolname,p.oid,'EXECUTE')
     AND a.rolname IN ('anon','authenticated','PUBLIC'))
  FROM pg_proc p WHERE p.proname='set_contribution_audience';

-- 5  holds only 7    expect exactly: asset_contributions SELECT,UPDATE;
--                    contribution_visibility_targets SELECT,INSERT,DELETE;
--                    org_chart_nodes SELECT; organizations SELECT
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee='tesseract_audience_writer' ORDER BY 1,2;

-- 6  client locked   expect: SELECT only
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name='contribution_visibility_targets' AND grantee='authenticated';
```

**Pass/fail.** All six must match exactly. Each is a **stop even with green
suites**, because the suites exercise the *function*, not the *role* — they
stay green while the role holds more than it should.

Check 1 is the sharpest: `rolcanlogin=t` means the boundary can be assumed
directly; `rolbypassrls=t` makes it a superuser by another name;
`rolinherit=t` means any future member inherits it silently. Check 5 failing
with an **extra** row is the same class of problem.

Also confirm trigger order — `a_pin_audience` must sort first:

```sql
SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE c.relname='asset_contributions' AND NOT t.tgisinternal ORDER BY tgname;
```

---

## 8. Post-fix

```bash
psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   # expect 16 / 0
psql "$DB_URL" -f supabase/tests/contribution-audience-management.sql   # expect 14 / 0
```

**Assertion 2 of the audience suite is the one to watch.** It asserts ordinary
research editing — a content-only save succeeds and leaves the audience alone
— and it passes in both states by design. If it fails *here*, the safeguard
has broken writing prose, which is a worse outcome than the defect it fixes.

---

## 9. Report back

1. Step 4 parity table — any `MISMATCH`.
2. Step 5 baseline counts + the failing assertion numbers for both suites.
3. Whether the required failures were among them.
4. Step 7: all six results, plus the trigger order.
5. Step 8 counts.
6. **Anything that passed at baseline and should not have** — lead with this.

## Teardown

```bash
docker rm -f tesseract-test
```

Nothing to revert: the environment is disposable and production was never
written to.
