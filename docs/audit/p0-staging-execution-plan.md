# P0 staging execution plan

How to validate `d516136` (`20260826100000` / `…100100` / `…100200`) against a
database that resembles production closely enough for the result to mean
something.

**Do not deploy to production from this document.** It ends at a green staging
run and a go/no-go.

---

## 1. Why the obvious approach is not good enough

`docs/CONTRIBUTING.md` §"Migrations & database changes" says to apply migrations
to staging with `scripts/apply-migrations-to-staging.mjs`, which replays the 279
files in `supabase/migrations/`. **For this change that produces a false
negative, and it is worth being precise about why.**

`docs/audit/platform-readiness-2026-08.md` §P0-5 measured the gap: 134 tables and
50 client-callable RPCs exist in production and in no migration. The absences
land on exactly what these three migrations touch:

| Object these migrations depend on | Created by a repo migration? |
|---|---|
| `public.users` (the table being re-granted) | **no** |
| `organization_memberships` (what Layer A validates against) | **no** |
| `Users can update their own profile` (the row policy Layer B narrows) | **no** |
| `Org admins can update coverage_admin for org members` (mirrored by Layer C) | **no** |
| `set_current_org()`, `auto_accept_pending_invites()`, `bootstrap_organization()` | **no** |
| `maintain_current_org_on_membership_change()` | **no** |
| The 186 consuming policies whose NULL-handling Layer A relies on | ~40% |
| `on_auth_user_created` on `auth.users` (creates `public.users` rows) | **no** |

A database built only from the repo would not have `public.users` at all, so
`20260826100100` would fail on the first `REVOKE`. If it were hand-patched into
existence, the run would still prove nothing: the whole risk in this change is
the *interaction* between a narrowed grant, pre-existing row policies, six
pre-existing `SECURITY DEFINER` writers, and 186 consuming policies — none of
which the repo describes.

**So staging must be built from production's schema, not from the repository's.**

---

## 2. Choosing how to build it

Three options. Recommendation: **Option A**, with Option B as the higher-fidelity
alternative if you want to retire `docs/audit/platform-readiness-2026-08.md` P1-10
at the same time.

### Option A — schema-only `pg_dump` from production into a fresh project ✅ recommended

Fastest, fully inspectable, no production risk (read-only against prod), and the
dump file is itself the schema baseline that P0-5 asks for.

Limits, stated up front: it copies `public` (and `storage` if asked) but not the
managed `auth` schema, so the `auth.users` trigger has to be carried over
separately — §3 step 4 does that explicitly.

### Option B — restore a PITR/physical backup into a new project

Highest fidelity: every schema, every grant, every trigger, and real data
distributions. Also constitutes the first tested restore this project has ever
performed, which closes P1-10.

Cost: slower, and it puts **real customer data** in a second place. If you take
this route, treat the staging project as production for access purposes, or run
`scripts/erase-organization.mjs` against all but one org immediately after the
restore.

### Option C — Supabase Branching ⚠️ verify before relying on it

Ergonomically the nicest. **Check first whether your branch is seeded from
`supabase/migrations/`** — on the default configuration it is, which reintroduces
exactly the problem in §1. If branching can be pointed at a schema dump instead,
it becomes Option A with better tooling.

---

## 3. Procedure (Option A)

Every command is annotated with what it must produce. Stop at the first surprise.

### Step 0 — Prerequisites

```bash
# Direct connection string, from Supabase dashboard → Settings → Database.
# NOT the Management API token: pg_dump needs a Postgres connection.
export PROD_DB_URL='postgresql://postgres:<pw>@db.<prod-ref>.supabase.co:5432/postgres'
export STG_DB_URL='postgresql://postgres:<pw>@db.<stg-ref>.supabase.co:5432/postgres'

pg_dump --version    # must be >= the server's major version; check with:
psql "$PROD_DB_URL" -c 'select version();'
```

If the staging project from `docs/CONTRIBUTING.md` is paused, resume or recreate
it now. Prior session notes record its host as non-resolving — assume it needs
recreating rather than that it is merely asleep.

### Step 1 — Capture production's schema (read-only)

```bash
pg_dump "$PROD_DB_URL" \
  --schema-only \
  --schema=public \
  --schema=storage \
  --no-owner \
  --quote-all-identifiers \
  -f prod-schema.sql
```

**`--no-acl` must NOT be passed.** Layer B *is* an ACL change; a dump without
privileges would make the before/after gate meaningless. `--no-owner` is safe and
desirable — objects become owned by the restoring role (`postgres` on staging),
which is what production has.

Sanity-check the dump before using it:

```bash
grep -c 'CREATE POLICY'  prod-schema.sql   # expect ~473+ (repo replay said 473)
grep -c 'CREATE FUNCTION' prod-schema.sql  # expect well above the repo's 207
grep -n 'CREATE TABLE "public"."users"' prod-schema.sql          # must exist
grep -n 'GRANT.*ON TABLE "public"."users"' prod-schema.sql       # must exist
grep -c 'current_org_id'  prod-schema.sql                        # must be > 100
```

Commit `prod-schema.sql` nowhere with credentials in it — it has none, but check
`grep -iE 'password|secret|key' prod-schema.sql` before storing it. It is the
right artifact to become the P0-5 baseline in a later PR.

### Step 2 — Load into staging

```bash
psql "$STG_DB_URL" -v ON_ERROR_STOP=1 -f prod-schema.sql 2>&1 | tee restore.log
grep -iE '^(ERROR|FATAL)' restore.log
```

Expect some benign noise: extensions already present, `auth`/`storage` objects
that the platform pre-creates. **Not benign:** any error mentioning `users`,
`organization_memberships`, `current_org_id`, `POLICY`, or `GRANT`. Resolve those
before continuing — a missing grant is a silently wrong before/after gate.

### Step 3 — Verify fidelity on the axes that matter

Do not proceed on the assumption that the restore worked. Run these on **both**
databases and diff:

```sql
-- (a) policy population
SELECT count(*) AS policies, count(DISTINCT tablename) AS tables
FROM pg_policies WHERE schemaname = 'public';

-- (b) the grants Layer B changes
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='users'
  AND grantee IN ('authenticated','anon') ORDER BY 1,2;

-- (c) the writers from docs/audit/p0-writer-review.md §5
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('set_current_org','morph_switch_org','morph_restore_org','current_org_id',
  'maintain_current_org_on_membership_change','erase_user_personal_data',
  'auto_accept_pending_invites','bootstrap_organization','is_platform_admin')
ORDER BY 1;

-- (d) row policies on users, verbatim
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='users' ORDER BY cmd;
```

**(a), (b), (c) and (d) must match production exactly.** If they do not, the
staging run cannot clear this change and you should switch to Option B.

### Step 4 — Restore the `auth.users` trigger (the one `pg_dump --schema=public` misses)

`supabase/tests/org-governance.sql:15` and the new coverage-admin test both rely
on `on_auth_user_created` creating `public.users` rows. It lives on `auth.users`,
which the dump did not include.

```sql
-- On PRODUCTION (read-only) — capture the definition:
SELECT pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal;

-- On STAGING — confirm it is absent, then apply the definition above verbatim.
```

Then prove it: insert one `auth.users` row on staging and confirm a
`public.users` row appears; delete it again.

### Step 5 — Seed minimal synthetic data

```bash
node scripts/seed-staging.mjs
```

Enough for the app to render. The SQL gates create their own fixtures.

### Step 6 — THE BEFORE GATE (mandatory)

Migrations **not yet applied**.

```bash
psql "$STG_DB_URL" -f supabase/tests/tenant-boundary-p0.sql 2>&1 | tee before.log
```

**REQUIRED RESULT: the run FAILS**, ending in
`P0 TENANT BOUNDARY TEST FAILED: N assertion(s) failed`, and `before.log`
contains at minimum:

```
FAIL [2]  BYPASS OPEN — set current_organization_id to a non-member org
FAIL [6]  stale membership still resolves to …
FAIL [13] is_active was client-writable
FAIL [14] a user granted themselves coverage_admin
```

**If it passes here, STOP.** A pass before remediation means one of: the
migrations were already applied to this database, the restore did not carry the
production grants, or the test is not exercising what it claims. All three
invalidate the after-gate. Diagnose before continuing — this step exists
precisely to catch a staging environment that cannot detect the bug.

Because the `DO` block raises at the end, the whole statement rolls back;
`tenant-boundary-p0.sql` leaves nothing behind on a failing run, including the
borrowed user's restored values.

Also capture the pre-state for the coverage-admin file:

```bash
psql "$STG_DB_URL" -f supabase/tests/tenant-boundary-p0-coverage-admin.sql 2>&1 | tee before-ca.log
```

Expect `FAIL [1][A]` at minimum. Its fixtures are created by statements *outside*
the `DO` block, so a failing run leaves them behind — re-run the cleanup block at
the bottom of that file before proceeding.

### Step 7 — RESOLVED 2026-08-26 — invite matching reads `auth.users.email`

**This step is complete; it does not need running again.** See
`docs/audit/p0-invite-identity-resolution.md`. The allowlist stands as written.
The original instructions are kept below for provenance.

#### (resolved) Resolve the blocking question from the writer review

Before applying anything, run `docs/audit/p0-writer-review.md` §3.4 query 1
against **production**:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('auto_accept_pending_invites','accept_org_invite');
```

- Matches `auth.users.email` → proceed unchanged.
- Matches `public.users.email` → **stop and amend `20260826100100`** to drop
  `email` from the `GRANT UPDATE` allowlist before going further. Deploying the
  allowlist as written would leave a working escalation path.

### Step 8 — Apply the three migrations, in order

```bash
psql "$STG_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260826100000_p0_current_org_id_validates_membership.sql \
  -f supabase/migrations/20260826100100_p0_users_authority_column_grants.sql \
  -f supabase/migrations/20260826100200_p0_users_authority_column_guard.sql
```

Order matters. Layer A first means that if you stop midway, the read is already
failing closed.

### Step 9 — THE AFTER GATE (mandatory)

```bash
psql "$STG_DB_URL" -f supabase/tests/tenant-boundary-p0.sql 2>&1 | tee after.log
psql "$STG_DB_URL" -f supabase/tests/tenant-boundary-p0-coverage-admin.sql 2>&1 | tee after-ca.log
psql "$STG_DB_URL" -f supabase/tests/tenant-boundary-p0-verify.sql 2>&1 | tee verify.log
```

**REQUIRED:**
- `after.log` → `RESULTS: 17 passed, 0 failed out of 17 assertions`, no exception.
  Assertions [3.1]-[3.4] are the end-to-end exploit chain added after the BEFORE
  run on 2026-08-26; they must go from four FAILs to four PASSes.
- `after-ca.log` → `9 passed, 0 failed`. Warnings are permitted and must be read:
  each names a real behaviour documented in `p0-writer-review.md` §4. A `WARN [4][C]`
  is **not** acceptable on a faithful staging clone — it means the org-admin row
  policy did not come across, i.e. step 3(d) was not actually verified.
- `verify.log` → items 1, 2 return zero rows; item 3 lists exactly
  `coverage_admin, email, first_name, last_name, pilot_progress, timezone, user_type`;
  item 4 `validates_membership = true`; item 5 one row with `tgenabled = O`.

### Step 10 — Non-regression: run the whole existing SQL suite

These are the tests that would notice if Layer A's NULL broke an unrelated
policy — the largest untested risk in this change.

```bash
for f in supabase/tests/*.sql; do
  echo "── $f"; psql "$STG_DB_URL" -f "$f" 2>&1 | grep -E 'FAIL|PASS|ERROR' | tail -5
done
```

`multi-org-isolation.sql` is the important one: it exercises org scoping across
many tables and will surface a policy that Layer A's NULL turned from
allow-to-deny.

### Step 11 — Application smoke tests

Point a local dev server at staging (`.env.local` → staging URL + anon key) and
exercise **every write site the ratchet enumerates**, because each one is a
column in the allowlist and a `permission denied for column` is the failure mode
this change creates.

| # | Flow | File | Column | Expected |
|---|---|---|---|---|
| 1 | Sign up a new user | `hooks/useAuth.ts:78`, `contexts/AuthContext.tsx:48` | `id, email, first_name, last_name` (INSERT) | profile row created; no permission error |
| 2 | Email sync on login | `hooks/useAuth.ts:116` | `email` | silent success |
| 3 | Change timezone in Settings | `pages/SettingsPage.tsx:149` | `timezone` | saves and persists |
| 4 | Onboarding user type | `components/onboarding/SetupWizard.tsx:500` | `user_type` | wizard completes |
| 5 | Pilot progress advances | `hooks/usePilotProgress.ts:197` | `pilot_progress` | banner advances |
| 6 | Ops pilot panel edit | `pages/ops/OpsPilotPanel.tsx:154` | `pilot_progress` | saves |
| 7 | **Org admin toggles coverage_admin** | `pages/OrganizationPage.tsx:2573` | `coverage_admin` | **saves** — the flow Layer C must not break |
| 8 | Non-admin cannot see//use that toggle | same | — | UI gates it; DB rejects if forced |
| 9 | **Switch organisation** | `contexts/OrganizationContext.tsx:240` | via `set_current_org()` | switches; data changes to the new org |
| 10 | Self-heal a stale org pointer | `contexts/OrganizationContext.tsx:147` | via `set_current_org()` | recovers rather than showing an empty app |
| 11 | **Morph as another user** (platform admin) | `hooks/useMorphSession.ts` | via `morph_switch_org()` | header identity *and* org switch |
| 12 | Unmorph | same | via `morph_restore_org()` | returns to the admin's own org |
| 13 | **Deactivate a member, then load as them** | `OrgPeopleTab` + login | — | app shows no-org state, not another org's data |
| 14 | Multi-org user switches back and forth | org switcher | — | both orgs reachable, no bleed |

Flows 7, 9, 11, 13 are the ones that can only fail *because of this change*. 13
is the offboarding case Layer A exists for and is the most valuable manual check
in the list.

### Step 12 — Front-end guards

```bash
npm run guard:unit    # includes src/lib/security ratchet + org-scope guards
npm run guard:types
npm run guard         # full, once, at the end
```

### Step 13 — Go / no-go

Ship only if **all** hold:

- [ ] Step 3 fidelity checks (a)–(d) matched production
- [ ] Step 6 BEFORE gate **failed**, naming assertions 2, 6, 13, 14
- [ ] Step 7 invite-matching question answered `auth.users.email`, or the
      allowlist amended
- [ ] Step 9 → 14/14, 9/9, and every `verify.sql` expectation met
- [ ] Step 9 produced no `WARN [4][C]`
- [ ] Step 10 existing suite no worse than its pre-migration baseline
- [ ] Step 11 flows 7, 9, 11, 13 pass by hand
- [ ] Step 12 green
- [ ] `verify.sql` item 6 run against **production** shows `stranded = 0`

That last one is the outage check, and it belongs to production rather than
staging: it is the number that says whether Layer A strands a live user. The
commit measured 0 at authoring time. Re-measure immediately before deploying —
a membership deactivated in the interval changes the answer.

---

## 4. Rollback

Layers B and C are cleanly reversible; Layer A is reversible but should be last
out, because it is the one closing the read.

```sql
-- C
DROP TRIGGER IF EXISTS trg_enforce_user_authority_columns ON public.users;
-- B  (restores the pre-change grants exactly)
GRANT INSERT, UPDATE, DELETE ON public.users TO authenticated;
-- A  (only if A is the proven cause; this reopens the bypass)
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_organization_id FROM users WHERE id = auth.uid();
$$;
```

Do not paste this into production speculatively. Reverting A restores a live
cross-tenant read; if A is the problem, the correct response is almost always to
fix the stranded memberships instead.

---

## 5. If a faithful staging clone cannot be built

Then say so and do not substitute a repo-built database for one. The fallback,
in descending order of confidence:

1. Option B (PITR restore) — slower, higher fidelity, closes P1-10 too.
2. A **read-only** rehearsal on production: run `tenant-boundary-p0-verify.sql`
   items 6 and 7, plus §5 of `p0-writer-review.md`, and confirm `stranded = 0`.
   This tells you the change will not strand anyone. It does **not** tell you the
   bypass closes, and it must not be recorded as though it did.
3. Deploy Layer A alone, behind a short window, with `stranded` monitored. It is
   the layer that fixes the vulnerability, it is a single `CREATE OR REPLACE`,
   and it reverts in one statement. Layers B and C then follow once staging
   exists. This is a real option — but it is a decision to accept less
   validation, and should be recorded as one rather than arrived at by default.
