# Running the two security suites in isolation

**Never against production.** Both suites write fixture users, organizations,
org-chart nodes, contributions, history and revision events, then delete them.
They are safe where they belong and destructive where they do not.

---

## 1. An isolated target

Any of these; in rough order of fidelity.

**A Supabase branch** — closest to production, since it carries the real
schema including the objects that are not in version control (the history
trigger, `can_view_contribution`, `contribution_in_current_org`). Create from
the dashboard, then use the branch's connection string.

**A restored dump** — same fidelity, more setup:

```bash
pg_dump --schema-only "$PROD_URL" > schema.sql     # read-only on production
createdb tesseract_test
psql tesseract_test -f schema.sql
```

**`supabase start`** — local, fastest, **least faithful**: it applies
`supabase/migrations/`, which do **not** describe production. The preflight
established that the history trigger, both helper functions and the C1 policy
set exist only in production. On a local stack the suites would test a
different database and could pass for the wrong reason. Use it only for syntax
checking, and say so if you report results from it.

Set `DB_URL` to whichever you chose. Everything below is `psql`.

---

## 2. Establish the baseline — **before applying anything**

This is the step that makes the rest meaningful. A suite that has never been
seen failing proves nothing when it passes.

```bash
psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql
psql "$DB_URL" -f supabase/tests/contribution-audience-management.sql
```

| Suite | Required baseline | Must be among the failures |
|---|---|---|
| `contribution-visibility-security` | **9 PASS / 7 FAIL** | 3, 4, 6, 8, 13, 15, 16 |
| `contribution-audience-management` | **4 PASS / 10 FAIL** | everything except 1, 2, 11, 14 |

**If either reports more passes than that, stop.** The suite is not observing
the defect and neither it nor the fix can be trusted. Do not apply the SQL to
make a test pass that was never seen failing.

Each prints a `_sec_results` / `_aud_results` grid; keep both runs.

---

## 3. Apply, in this order

```bash
psql "$DB_URL" -f scripts/sql/contribution-visibility/10-policy-fix.sql
psql "$DB_URL" -f scripts/sql/contribution-visibility/20-audience-management.sql
```

`10-` first: `20-`'s revoke removes the direct write paths the old policies
assume, and `10-` defines `can_read_asset_contribution`, which `10-` §3–5 use.

---

## 4. Verify the function-owner role's privileges

The privilege boundary is the part most worth checking by hand, because a
mistake here is silent — the suites would still pass while the role held more
than it should.

```sql
-- (a) inert and unheld. Expect: f, f, f, and 0 members.
SELECT rolname, rolcanlogin, rolbypassrls, rolinherit
  FROM pg_roles WHERE rolname = 'tesseract_audience_writer';

SELECT count(*) AS members_must_be_zero
  FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
 WHERE r.rolname = 'tesseract_audience_writer';

-- (b) it owns the function, and the function is SECURITY DEFINER.
--     Expect: tesseract_audience_writer, t
SELECT pg_get_userbyid(proowner) AS owner, prosecdef
  FROM pg_proc WHERE proname = 'set_contribution_audience';

-- (c) only `authenticated` may call it. Expect exactly {authenticated}.
SELECT array(SELECT a.rolname FROM pg_roles a
              WHERE has_function_privilege(a.rolname, p.oid, 'EXECUTE')
                AND a.rolname IN ('anon','authenticated','PUBLIC')) AS can_execute
  FROM pg_proc p WHERE p.proname = 'set_contribution_audience';

-- (d) it holds ONLY what the replace needs, on only these tables.
--     Expect: asset_contributions SELECT+UPDATE,
--             contribution_visibility_targets SELECT+INSERT+DELETE,
--             org_chart_nodes SELECT, organizations SELECT. Nothing else.
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'tesseract_audience_writer'
 ORDER BY table_name, privilege_type;

-- (e) the client's direct write paths are gone.
--     Expect: SELECT only.
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'contribution_visibility_targets' AND grantee = 'authenticated';

-- (f) the pin runs first. Expect a_pin_audience, then
--     asset_contributions_set_organization_id, then contribution_history_trigger.
SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE c.relname = 'asset_contributions' AND NOT t.tgisinternal
 ORDER BY tgname;
```

**Any of these failing is a stop**, even with green suites. (a) and (d) are
the ones that matter most: a role that can log in, inherits, bypasses RLS, has
members, or holds a grant beyond the six above is a wider boundary than the
design claims — and the suites cannot see that, because they exercise the
function, not the role.

---

## 5. Re-run

```bash
psql "$DB_URL" -f supabase/tests/contribution-visibility-security.sql   # 16 / 0
psql "$DB_URL" -f supabase/tests/contribution-audience-management.sql   # 14 / 0
```

**Watch assertion 2 of the audience suite specifically.** It asserts ordinary
research editing: a content-only save succeeds and leaves the audience
untouched. It passes in *both* states by design, so it is the one assertion
whose failure means the safeguard has broken writing prose — a worse outcome
than the defect it fixes.

---

## 6. Reverting the test environment

```bash
psql "$DB_URL" -f scripts/sql/contribution-visibility/90-rollback.sql
```

Policy-only; it touches no data. It restores the defective policies verbatim,
so a re-run should return to the §2 baseline — which is itself a useful check
that the rollback is complete.

`90-` does **not** revert `20-`. To undo that:

```sql
DROP TRIGGER IF EXISTS a_pin_audience ON public.asset_contributions;
DROP FUNCTION IF EXISTS public.asset_contributions_pin_audience();
DROP FUNCTION IF EXISTS public.set_contribution_audience(uuid, text, uuid[]);
DROP POLICY IF EXISTS contribution_visibility_targets_writer_insert ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS contribution_visibility_targets_writer_delete ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS asset_contributions_writer_update ON public.asset_contributions;
GRANT INSERT, UPDATE, DELETE ON public.contribution_visibility_targets TO authenticated;
DROP ROLE IF EXISTS tesseract_audience_writer;   -- after the function is gone
```

The `GRANT` restores what A4 found in production. Reverting reopens the direct
write paths; that is what reverting means here.

---

## 7. What a complete report looks like

1. Which target, and if it was `supabase start`, say so — the fidelity caveat
   changes how much the result is worth.
2. Baseline counts for both suites, with the failing assertion numbers.
3. Confirmation that the required failures were among them.
4. The six role-verification results from §4.
5. Post-apply counts for both suites.
6. Anything that passed at baseline and should not have.

Item 6 is the one to lead with if it happens.
