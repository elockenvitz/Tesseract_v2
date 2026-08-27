# P0 staging validation — status: BLOCKED at Phase 1

Attempted execution of `docs/audit/p0-staging-execution-plan.md` on 2026-08-26.

**Phases 2–5 were not executed and no results are reported for them.** Phase 1
cannot be completed with the tooling available on this machine. What follows is
the blockage, what was established read-only against production instead, and two
corrections to earlier figures.

---

## 1. Phase 1 — staging fidelity assessment: CANNOT BE ESTABLISHED

### The staging project exists but is paused

| Project | Ref | Status |
|---|---|---|
| Tesseract (production) | `wfcebe…` | `ACTIVE_HEALTHY` |
| Tesseract-staging | `pdajkw…` | **`INACTIVE`** (paused, created 2026-05-22) |

### Two independent blockers

**Blocker 1 — no Postgres client tooling.**

| Tool | State |
|---|---|
| `psql` | not installed |
| `pg_dump` | not installed |
| `docker` | not installed (so `supabase db dump`, which runs pg_dump in a container, cannot work either) |
| `supabase` CLI | 2.101.0 present |

**Blocker 2 — no Postgres-protocol credentials.** The only credential available
is the Supabase **Management API personal access token** in `.mcp.json`. That is
an HTTPS API token, not a database password: it can execute SQL through
`POST /v1/projects/{ref}/database/query`, but it cannot drive `pg_dump`, and no
direct connection string for either project exists in `.env.local` or the
environment.

### Why the workaround was rejected rather than attempted

The Management API can run SQL against both projects, so it is technically
possible to hand-roll a schema transfer with catalog queries. That was not done,
because it produces precisely the artefact the plan warns against
(`p0-staging-execution-plan.md` §1): a hand-patched approximation whose
before/after result would carry no information about the interaction this change
actually risks — a narrowed grant against pre-existing row policies, seven
`SECURITY DEFINER` writers, and (see §4) **902** consuming policies. A green run
on an approximate clone would be worse than no run, because it would be recorded
as a pass.

**Fidelity axes (a)–(d): not assessed — there is no staging database to assess.**
The production side of each axis is captured in §3 so the comparison is a diff
rather than a fresh investigation once staging exists.

### What unblocks it

1. Install PostgreSQL client tools (`pg_dump`, `psql`) ≥ the server major
   version, **or** Docker so `supabase db dump` works.
2. Retrieve both direct connection strings from Supabase → Settings → Database
   (production for the dump, staging for the restore). These are DB passwords and
   are not derivable from the Management token.
3. Restore the staging project (Dashboard, or
   `POST /v1/projects/pdajkw…/restore`). Deliberately not done here: it is an
   infrastructure state change on a live cloud account, and on its own it does
   not unblock anything while 1 and 2 are outstanding.

Then `p0-staging-execution-plan.md` runs start to finish unchanged.

---

## 2. Phases 2–5: NOT EXECUTED

| Phase | Status |
|---|---|
| 2 — BEFORE gate | **not run** — requires staging |
| 3 — apply the three migrations | **not run** |
| 4 — AFTER gate + `verify.sql` | **not run** — except item 6, see §3 |
| 5 — application smoke tests | **not run** — requires a staging app target |

The BEFORE gate must never be run against production: it is an exploit
demonstration that creates organizations and mutates a real user's row. Its whole
purpose is to *succeed at breaching the tenant boundary*.

---

## 3. What was established read-only against production instead

All via `POST /database/query`, `SELECT` only, catalog metadata and counts —
no user-generated investment data read.

### 3.1 `verify.sql` item 6 — stranded count: **0** ✅

| | |
|---|---|
| Users whose `current_organization_id` has no active membership | **0** |
| Users with a current org set | 24 |
| Users with no active membership anywhere (correctly org-less) | 2 |
| Total users | 26 |

**Layer A strands nobody.** This is the outage check, it is a production-side
number, and it must be re-run immediately before any deployment — a membership
deactivated in the interval changes it.

### 3.2 Test preconditions — all satisfied ✅

Every table and column both SQL test files touch exists in production with the
expected name: `organizations(id,name,slug)`,
`organization_memberships(organization_id,user_id,status,is_org_admin,expires_at)`,
`portfolios(name,organization_id)`, `portfolio_holdings(portfolio_id,asset_id)`,
`allocation_periods(name,start_date,end_date,organization_id)`.

`public.users` has exactly 14 columns:

```
coverage_admin, created_at, current_organization_id, email, first_name,
full_name, id, is_active, is_pilot_user, last_name, pilot_progress,
timezone, updated_at, user_type
```

which reconciles exactly with `20260826100100`: 7 granted + 6 withheld + 1
generated (`full_name`). **No column named in the allowlist is missing, and no
column exists that the migration failed to classify.**

This closes the risk flagged when the tests were written — that they had never
been executed and might fail for a schema-mismatch reason, corrupting the before
gate. They will fail, if they fail, for behavioural reasons.

### 3.3 The two row policies the guard depends on — both real ✅

`Users can update their own profile` — `authenticated`, USING and WITH CHECK both
`auth.uid() = id`. Confirms P0-1's row scope: any column of your own row.

`Org admins can update coverage_admin for org members` — exists, with both USING
and WITH CHECK, shaped exactly as `20260826100200` mirrors it:

```sql
EXISTS (SELECT 1 FROM organization_memberships om1
        JOIN organization_memberships om2 ON om1.organization_id = om2.organization_id
        WHERE om1.user_id = auth.uid() AND om1.is_org_admin = true
          AND om1.status = 'active' AND om2.user_id = users.id)
```

Two consequences: coverage-admin test **[4][C] should PASS, not WARN**, on a
faithful clone — a WARN there would mean the clone is not faithful. And it
confirms `p0-writer-review.md` §4.2 from the source: `om1.status` is checked,
`om2.status` is not.

### 3.4 Writer inventory — **complete at seven** ✅

A catalog sweep found 12 functions mentioning the column; narrowing to actual
assignment leaves exactly the seven in `p0-writer-review.md`
(`set_current_org`, `morph_switch_org`, `morph_restore_org`,
`maintain_current_org_on_membership_change`, `erase_user_personal_data`,
`auto_accept_pending_invites`, `bootstrap_organization`). The other five —
`create_group_conversation`, `get_or_create_direct_conversation`,
`start_morph_session`, `end_morph_session`, `ensure_pilot_scenario_for_user` —
read the column, they do not write it.

**All twelve are `SECURITY DEFINER` owned by `postgres`.** So Layer C's exemption
(`current_user NOT IN ('authenticated','anon')`) applies to every one, and the
guard cannot break any of them. This is the single most important thing that
could have gone wrong with Layer C, and it does not.

---

## 4. Two corrections to earlier figures

Both come from comparing production against the migration replayer, and both
are the `production-verification-pack.md` §8.1 **UNSAFE** branch: the repo-derived
lists are a **floor**, not a ceiling.

| Measure | Replayed from migrations | **Live production** |
|---|---|---|
| Policies in `public` | 473 | **902** |
| Tables carrying policies | 147 | **284** |
| Unconditionally permissive policies | 88 | **123** |
| Tables with a permissive policy | 44 | **73** |
| Permissive policies on the `public` role | 6 | **20** |

So `platform-readiness-2026-08.md` §P0-2 understates the exposure by roughly
40%, and §P0-5's drift is worse than measured: the repository describes about
half the policy surface, not most of it. The finding is unchanged in kind; the
number is larger. **`pg_policies` is the authoritative inventory for remediation,
not `scripts/audit/policy-state.mjs`** — the script's value is diffing intent
against reality, not enumerating reality.

Also incidental, and consistent with what was already reported:
`bootstrap_organization` pins `search_path`; `auto_accept_pending_invites` still
does not.

---

## 5. Recommendation: **DO NOT DEPLOY**

Not because anything is wrong with `d516136`. Everything checkable without a
database checks out, and §3.4 removes the largest remaining doubt about Layer C.

Do not deploy because **the validation gate has not been run**, and the gate is
the point. The change alters an ACL and installs a trigger on the table every
authenticated request touches; a production apply with no before/after evidence
is exactly the practice `docs/CONTRIBUTING.md` §5 exists to prevent.

### The alternative, if the blockage cannot be cleared soon

`p0-staging-execution-plan.md` §5 option 3 remains available and is a legitimate
engineering decision rather than a shortcut: **deploy Layer A
(`20260826100000`) alone.**

- It is the layer that closes the vulnerability, including for values that are
  already wrong.
- It is one `CREATE OR REPLACE FUNCTION` and reverts in one statement.
- It changes no grants and installs no trigger, so it cannot produce a
  `permission denied for column` outage — the failure mode Phase 5 exists to
  catch does not apply to it.
- §3.1 shows `stranded = 0`, so it strands nobody today.

Layers B and C would then wait for staging. This trades defence-in-depth for
speed and should be recorded as a deliberate acceptance of reduced validation,
with the stranded count re-checked immediately before applying.

**My recommendation between the two: clear the blockage and run the plan.** It is
a day of setup, the vulnerability has existed for months rather than hours, and
the staging environment is needed for every remediation after this one — the 123
permissive policies in §4 are the next queue and they are far harder to validate
than this change.
