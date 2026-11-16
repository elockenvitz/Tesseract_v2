# Runbook — `20261115120000_decision_review_typed_subject`

Status on 2026-11-15: **authored, reviewed, NOT APPLIED to any database.**
Its 12-assertion authorization suite has **not been executed anywhere.**

This document exists so that the gap between "the SQL is written" and "the SQL
is known to work" is not something a reader has to infer.

---

## 1. Why it has not been run, precisely

The brief required a nonproduction database. Every route to one was checked on
2026-11-15 and each is closed:

| Route | State | Why it does not work |
|---|---|---|
| Local Postgres via `supabase start` | **Blocked** | `docker --version` → `command not found`. The Supabase CLI (3.1.0) is installed but drives Docker, so there is nothing for it to start. |
| Local stack definition | **Blocked** | No `supabase/config.toml` in the repo. The project has never been linked for local development, so even with Docker there is no stack to bring up. |
| Supabase preview branch | **Blocked** | `list_branches` returns exactly one branch, `main`, whose `project_ref` **is production** (`wfcebeagznzgeuyysbnt`). There is no isolated database behind it. A persistent preview branch needs a paid plan, and creating one is a billable change to the account, not a test step. |
| The Supabase MCP tools | **Wrong target** | Pinned by `.mcp.json` to `--project-ref=<production>`. It cannot address the staging project at all. It is also a read-WRITE connection with no confirmation step for DDL — see §4. |
| Staging (`pdajkwtrrjcqnjsyvyqt`) via `scripts/security-suite.mjs` | **Credential-blocked** | This is the right target and the right runner. It needs `SUPABASE_ACCESS_TOKEN`, and the only token available here is the **account-wide** one in `.mcp.json`, which also reaches production. Loading an account-wide production credential into a shell command is not something to do on the model's own initiative. |
| Production | **Forbidden, correctly** | "Do not use production as a disposable fixture environment." The suite writes fixtures — organizations, users, reviews — and cleans them up afterwards. |

So the honest status is: **database-dependent verification is blocked on a
credential decision, not on missing work.** The SQL and the suite are ready to
run and the command is in §2.

## 2. The commands, for whoever holds the token

Run from the repo root. Staging first, and the suite **both before and after**
the migration — the before-run is what proves the suite observes something.

```bash
# 1. BEFORE. Assertions 4-11 must FAIL here. A clean pass before the
#    migration means the suite is not testing the migration.
SUPABASE_ACCESS_TOKEN=<token> node scripts/security-suite.mjs \
  decision-review-typed-subject pdajkwtrrjcqnjsyvyqt

# 2. Apply the migration to staging.
#    NOT `supabase db push` — see §3. Apply this one file.

# 3. AFTER. All 12 must PASS.
SUPABASE_ACCESS_TOKEN=<token> node scripts/security-suite.mjs \
  decision-review-typed-subject pdajkwtrrjcqnjsyvyqt
```

If the before-run passes everything, stop and treat the suite as broken rather
than the migration as unnecessary.

## 3. Do not use `supabase db push`

Two independent reasons:

1. Staging has no migration ledger, so a push would attempt the whole history.
2. `supabase/migrations/` contains five `*.rollback.sql` files. They end in
   `.sql`, so a glob-based runner applies them as forward migrations in name
   order — and `20261115120000_decision_review_typed_subject.rollback.sql`
   sorts immediately after the migration it reverses. A push would apply this
   change and then silently undo it.

Apply the single file. The rollback is
`20261115120000_decision_review_typed_subject.rollback.sql`, to be run only
deliberately.

## 4. What WAS verified, and what that is worth

Read-only, against production, without applying anything:

- **The resolver.** `decision_review_subject_type`'s logic was run as a plain
  SELECT over the 8 live `decision_reviews` rows: 2 resolve to `idea`, 6 to
  `unknown`. That is exactly the backfill the migration's `DO` block asserts,
  so the backfill and its self-check agree with the data.
- **The CHECK.** `decision_reviews_one_subject` was evaluated as an expression
  over 11 constructed cases: 11/11 correct, including each mislabelled pair.
- **Every column and table the DDL names exists**, checked against the live
  catalog rather than against the migration files — migrations do not describe
  this database.

What this is **not**: evidence of runtime authorization. Nothing here exercised
RLS, the grants, the BEFORE-write trigger, or the cross-organization denials.
Those are assertions 1-12 and they have not run. A static read of a policy is
not a test of it.

## 5. The frontend does not wait for this

Deliberate, and verified by test rather than by reading:

- Every `decision_reviews` read uses `select('*')` or names only columns that
  already exist. PostgREST fails an entire statement with 42703 on an unknown
  column, so naming `subject_type` anywhere would have taken the review panel
  and ACT AI's `get_decisions` out until the migration landed.
- The upsert payload names none of the four new columns.
- `useUpsertDecisionReview` falls back to the UI's own inference when
  `subject_type` is absent or `unknown`.

`src/hooks/__tests__/decision-review-subject-type.test.tsx` holds this in
place with a double that behaves like a pre-migration database: it returns
42703 for any statement naming a pending column. The double is itself tested
against a deliberately bad statement, so it cannot pass by doing nothing.

Consequence worth stating: because the reads are `select('*')`, the typed
columns start being used **the moment the migration is applied**, with no
second frontend deploy.

## 6. After applying

```sql
-- the backfill landed as predicted
select subject_type, count(*) from public.decision_reviews group by 1;
--  expected: idea 2, unknown 6

-- the new helpers are not reachable by a client
select has_function_privilege('anon',
  'public.decision_review_subject_type(text)', 'execute') as anon_can_execute,
       has_function_privilege('authenticated',
  'public.decision_review_subject_type(text)', 'execute') as authed_can_execute;
--  expected: false, false

-- one review per decision is still enforced
select conname from pg_constraint
 where conrelid = 'public.decision_reviews'::regclass and contype = 'u';
```
