# Controlled production implementation — plan

**Prepared, not authorized.** Nothing below runs without explicit approval.

Context accepted: 28 test/development tenants, no live customers, zero active
restricted contributions. Residual risk of skipping a separate
schema-equivalent environment is accepted.

---

## 1. Readiness review — three findings, one of which was a blocker

### F1 — `ALTER FUNCTION … OWNER TO` would have failed. **Fixed.**

Postgres requires direct or indirect membership in the new owning role to
transfer ownership, and Supabase's `postgres` is **not** a superuser. Without a
`GRANT tesseract_audience_writer TO postgres`, the `ALTER` at the foot of
`20-` raises and the whole transaction rolls back — a clean failure, but it
would have burned the window.

Added, with the consequence recorded: the role now has **exactly one member,
`postgres`**, so the verification expects that rather than zero. The pin is
unaffected — `current_user` becomes the role only *inside* the SECURITY
DEFINER function, so a `postgres` session still has its audience fields pinned
like any other caller.

### F2 — `20-` breaks the **currently deployed** app, silently

After the revoke, the deployed bundle's visibility picker stops working:
`updateVisibility` writes the row (pinned → no-op), then deletes/inserts
targets (revoked → zero rows), and swallows the error. The user sees success
and nothing changes.

Harmless here — there are no restricted contributions and no live users — but
it means **the app deploy should follow the SQL promptly**, and nobody should
use the visibility picker in between.

### F3 — dependency order is strict

`10-` defines `can_read_asset_contribution`, which its own §3–5 use, and `20-`
removes write paths the old policies assume. `10-` then `20-`, never reversed.

### Rollback safety — confirmed

Both files are **policy/function/grant only**. No contribution, visibility
value, target row, timestamp or audit event is read or written, so there is no
data to restore and no backfill to undo. `90-rollback.sql` plus the `20-`
teardown returns the database to its exact current state.

Both are wrapped in `BEGIN/COMMIT`, so a failure mid-file leaves nothing
partially applied.

---

## 2. Minimal validation set

**Run both suites against production.** They are the smallest *reliable* check,
and one property makes this safe rather than reckless:

> Each suite is a single `DO` block. Its fixtures and its cleanup are in the
> same statement, so a failure **rolls the fixtures back** and a success
> **deletes them**. Orphaned rows are not reachable either way.

They create only `ZZ`-prefixed synthetic organizations, users, assets,
org-chart nodes and contributions. **No existing research is read or
modified** — every fixture is created and destroyed within the block.

| Need | Covered by |
|---|---|
| policies | visibility suite 1–16 |
| RPC behaviour | audience suite 7–13 |
| dedicated role privileges | the six checks in §3, step 6 |
| ordinary prose editing | **audience suite 2** — passes before *and* after |
| restricted audience access | visibility suite 3, 4, 11, 12 |
| failed atomic audience change | audience suite 10 |

The alternative — hand-writing a narrower smoke script — needs multiple users
to test cross-user visibility at all, so it would end up recreating the suites
with less rigour and no rollback property.

---

## 3. Deployment procedure

Every step is one command. **Step 1 is read-only. Step 2 is NOT** — each suite
writes synthetic `ZZ`-prefixed fixtures and relies on its own cleanup and on
statement-level atomicity to remove them (§2, §6). It is safe, not read-only.
Visibility assertion 15 additionally *reads* existing quarantined revision
rows — counts only, no prose, no writes — which is the one exception to the
"no existing record is read" claim in §6.

### Step 1 — recoverable backup *(read-only)*

```bash
export PROD_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres'
pg_dump --schema-only --no-owner "$PROD_URL" > ~/tesseract-pre-release-$(date +%F).sql
```

Schema-only is sufficient **because neither file touches data**. Confirm
Supabase PITR is enabled as a second line; it is not expected to be needed.

### Step 2 — baseline *(writes synthetic fixtures, rolls them back)*

```bash
psql "$PROD_URL" -f supabase/tests/contribution-visibility-security.sql
psql "$PROD_URL" -f supabase/tests/contribution-audience-management.sql
```

| Suite | Required | Failures must include |
|---|---|---|
| visibility-security | **10 PASS / 6 FAIL** | 3, 4, 6, 8, 13, 16 |
| audience-management | **4 PASS / 10 FAIL** | all but 1, 2, 11, 14 |

**Revised 2026-10-20.** The visibility baseline was 9/7 with 15 among the
failures. Two corrections, both verified against the live database:

- 15's fixture was **unreachable** — the `asset_revisions` BEFORE INSERT OR
  UPDATE trigger overwrites `organization_id` with `current_org_id()` and
  raises when that is NULL, so no synthetic quarantined revision can be
  created. 15 is now a read-only check against existing quarantined rows.
- 15 **passes before 10- as well as after**: the C1 lane's
  `asset_revision_events_select` already carries the null-org actor-only
  branch. It is a preserve-access guard, not a proof that 10- does anything.

**More passes than required → STOP and report.** A suite that was never seen
failing proves nothing when it passes.

### Step 3 — apply the policy fix

```bash
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f scripts/sql/contribution-visibility/10-policy-fix.sql
```

### Step 4 — apply audience management

```bash
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f scripts/sql/contribution-visibility/20-audience-management.sql
```

### Step 5 — post-fix suites

```bash
psql "$PROD_URL" -f supabase/tests/contribution-visibility-security.sql   # 16 / 0
psql "$PROD_URL" -f supabase/tests/contribution-audience-management.sql   # 14 / 0
```

**Watch audience assertion 2.** It asserts ordinary research editing and
passes in both states by design. Failing *here* means the safeguard has broken
writing prose — stop and roll back; that is worse than the defect.

### Step 6 — role privilege checks

```sql
-- 1 inert                     expect f | f | f
SELECT rolcanlogin, rolbypassrls, rolinherit FROM pg_roles
 WHERE rolname='tesseract_audience_writer';
-- 2 members                   expect exactly one row: postgres
SELECT r2.rolname FROM pg_auth_members m
  JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles r2 ON r2.oid=m.member
 WHERE r.rolname='tesseract_audience_writer';
-- 3 owns the function         expect tesseract_audience_writer | t
SELECT pg_get_userbyid(proowner), prosecdef FROM pg_proc
 WHERE proname='set_contribution_audience';
-- 4 callable by               expect {authenticated}
SELECT array(SELECT a.rolname FROM pg_roles a
   WHERE has_function_privilege(a.rolname,p.oid,'EXECUTE')
     AND a.rolname IN ('anon','authenticated','PUBLIC'))
  FROM pg_proc p WHERE p.proname='set_contribution_audience';
-- 5 holds only these 7        asset_contributions SELECT,UPDATE;
--                             contribution_visibility_targets SELECT,INSERT,DELETE;
--                             org_chart_nodes SELECT; organizations SELECT
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee='tesseract_audience_writer' ORDER BY 1,2;
-- 6 client locked out         expect SELECT only
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name='contribution_visibility_targets' AND grantee='authenticated';
-- 7 pin runs first            expect a_pin_audience first
SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE c.relname='asset_contributions' AND NOT t.tgisinternal ORDER BY tgname;
```

**Any mismatch is a stop even with green suites** — the suites exercise the
function, not the role, so they stay green while the role holds too much.
`rolcanlogin=t` means the boundary can be assumed directly; `rolbypassrls=t`
makes it a superuser by another name; an **extra** row in check 5 is the same
class of problem.

### Step 7 — deploy the application

Normal deploy of `a7ecb58a`. Between steps 4 and 7 the visibility picker
silently does nothing (F2) — do not use it in that window.

### Step 8 — confirm in the UI *(read-only)*

Open an asset's Research tab; confirm sections render and the picker still
greys out Division/Department with its reason. **Do not save an audience
change against existing research.**

---

## 4. Rollback

Policy-only; no data to restore.

```bash
psql "$PROD_URL" -f scripts/sql/contribution-visibility/90-rollback.sql
```

```sql
-- then undo 20-
DROP TRIGGER IF EXISTS a_pin_audience ON public.asset_contributions;
DROP FUNCTION IF EXISTS public.asset_contributions_pin_audience();
DROP FUNCTION IF EXISTS public.set_contribution_audience(uuid, text, uuid[]);
DROP POLICY IF EXISTS contribution_visibility_targets_writer_insert ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS contribution_visibility_targets_writer_delete ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS asset_contributions_writer_update ON public.asset_contributions;
GRANT INSERT, UPDATE, DELETE ON public.contribution_visibility_targets TO authenticated;
REVOKE tesseract_audience_writer FROM postgres;
DROP ROLE IF EXISTS tesseract_audience_writer;   -- must follow the DROP FUNCTION above

-- Last: 90- deliberately leaves this commented, because the policies that
-- reference it must be restored first. Dropping it here completes the revert.
DROP FUNCTION IF EXISTS public.can_read_asset_contribution(uuid);
```

**Order is load-bearing.** Functions before the role (`DROP ROLE` fails while
it owns objects), and `can_read_asset_contribution` after `90-` has replaced
the five policies that call it.

Re-running the baseline suites should return **9/7** and **4/10** — which is
itself the proof that the rollback is complete.

**Reverting reopens the exposure.** That is what reverting means here. If the
app has already shipped, roll it back too, or audience changes will fail
against a missing RPC.

---

## 5. Stop points

| Step | Stop if |
|---|---|
| 2 | either suite passes more than its required baseline |
| 3, 4 | any error — the transaction rolls back; report before retrying |
| 5 | audience assertion 2 fails, or either suite is not 16/0 and 14/0 |
| 6 | any of the seven checks mismatches |

---

## 6. Final verification of the two safety claims

### Fixtures cannot survive — verified against the files, not the pattern

| | visibility suite | audience suite |
|---|---|---|
| `DO $$ … $$;` blocks | 1 | 1 |
| `COMMIT` / `ROLLBACK` inside | **0** | **0** |
| statements outside the block | `DROP TABLE`, `CREATE TEMP TABLE`, final `SELECT` | same |
| cleanup `DELETE`/`UPDATE` | 14 | 10 |
| `EXCEPTION WHEN` handlers | 18 | 13 |

Three failure modes, all safe:

1. **Success** — cleanup runs at the end of the same block.
2. **Caught assertion failure** — `BEGIN … EXCEPTION` is a *subtransaction*;
   only it rolls back, the block continues, cleanup still runs.
3. **Uncaught error** — fixture setup, an FK violation during cleanup, a
   statement timeout, a dropped connection. The `DO` is **one statement**, so
   its implicit transaction aborts and every fixture row disappears with it.
   There is nothing left to clean up.

The nested blocks added for assertions 15/16 and audience 14 have **no**
exception handler, which is the safer configuration: an error there propagates
and forces the full rollback rather than being swallowed.

One trigger-created row was checked specifically: audience assertion 2's
`UPDATE` fires `contribution_history_trigger`, which inserts into
`asset_contribution_history`. Both suites delete from that table in cleanup —
confirmed present, not assumed.

**The one condition.** This rests on each file being its own statement batch
under autocommit. `psql -f` and the Supabase SQL Editor both satisfy it.
**Do not wrap either suite in an explicit `BEGIN;`** — a transaction committed
despite an earlier error would defeat the guarantee.

### Rollback restores exactly, and touches no data

`10-` creates five policies; `90-` recreates the same five, with the pre-fix
text taken verbatim from preflight A1 and A3c — not reconstructed.

**No irreversible effect on data.** Neither file reads or writes a
contribution, visibility value, target row, timestamp or audit record. There
is nothing to back up beyond schema, and nothing to backfill on revert.

Three dependencies, all handled in §4:

- **`can_read_asset_contribution` is left behind** by a bare `90-` run — the
  drop is commented there deliberately, because the policies calling it must
  be restored first. Harmless if left (nothing references it), but §4 now
  drops it last for a complete revert. *This was missing from the §4 list and
  has been added.*
- **`90-` does not revert `20-`.** Separate teardown, with `DROP ROLE` after
  `DROP FUNCTION` or it fails on owned objects.
- **If the app has shipped, roll it back too.** Without the RPC,
  `setContributionAudience` throws "function does not exist" — loudly now,
  which is the new behaviour working, but audience changes stop.

---

## Approval requested

To execute steps 1–8 against production: the two SQL files, the four suite
runs that write and roll back synthetic fixtures, and the app deploy.

**No existing research, contribution, visibility value or audit record is read
or modified at any point.**
