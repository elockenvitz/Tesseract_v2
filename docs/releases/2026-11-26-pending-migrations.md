# The three pending migration statements

Production is `2f704873`. These three migration files are in the repository and
are **not applied**. Nothing here applies them; this is the review a human
needs before approving each statement.

Every "production now" column was read from the live database with a read-only
query (`transaction_read_only = on`, `supabase_read_only_user`), not inferred
from the migration ledger — which cannot be trusted here, because 308 of 370
repository migrations are absent from `supabase_migrations` while their objects
plainly exist.

## Summary

| Order | File | Effect on production | Risk |
| --- | --- | --- | --- |
| — | `20261005210000_mark_pilot_progress_atomic.sql` | **none, already applied** | none; applying is a no-op |
| 1 | `20261120010000_pilot_seed_freezes_reasoning.sql` | replaces one seed function | low; affects newly seeded pilot orgs only |
| 2 | `20261125120000_terms_acceptances.sql` | new table, 2 functions, 2 policies, 2 indexes | low while legal publication stays gated |

There is no ordering dependency **between** them. They touch disjoint objects.
The numbering above is a recommended sequence by increasing blast radius, not a
constraint.

---

## 1. `20261005210000_mark_pilot_progress_atomic.sql` — already in production

- **sha256** `19c3aa691b7eee2a06f2b54feeab741a1472301fc581c6d20395f5108e3d26e9`
- **bytes** 5882
- **statements** 1 `CREATE OR REPLACE FUNCTION`, 2 `REVOKE ALL ON FUNCTION`,
  1 `GRANT EXECUTE ON FUNCTION`, 1 `COMMENT ON FUNCTION`

**Production now:** `public.mark_pilot_progress(p_key text, p_value text)`
exists and matches the migration in every respect that was checked:

| Property | Migration | Production |
| --- | --- | --- |
| returns | `jsonb` | `jsonb` |
| language | `sql` | `sql` |
| volatility | `VOLATILE` | `v` (volatile) |
| security | `SECURITY DEFINER` | `prosecdef = true` |
| search_path | `SET search_path TO 'public'` | `search_path=public` |
| EXECUTE to `authenticated` | granted | **true** |
| EXECUTE to `anon` | revoked | **false** |
| EXECUTE to `PUBLIC` | revoked | **false** |

The body was compared line by line against `pg_get_functiondef`. It is the same
statement, including the set-once `CASE`, the `WHERE id = auth.uid()` guard and
the `RETURNING pilot_progress`.

**Dependencies:** `public.users.pilot_progress`, `auth.uid()`. Both present.

**Verdict:** applying this changes nothing. It is worth applying only to make
the ledger honest. There is no window in which production misbehaves, which is
why PR #353 could merge the frontend that calls it.

---

## 2. `20261120010000_pilot_seed_freezes_reasoning.sql`

- **sha256** `d88c1a3ff15d4362634e7af3494f724df21f00612630fcaf24f7ebfe4a358468`
- **bytes** 7885
- **statements** 1 `CREATE OR REPLACE FUNCTION`

**What it changes:** `ensure_pilot_decision_request_for_user(p_user_id uuid)`.
Today the seed inserts a `decision_requests` row and leaves
`proposal_version_id` NULL, so the one request a pilot org is seeded with has
no frozen reasoning behind it. The replacement writes the version in the same
plpgsql block, so either both rows exist or neither does.

**Production now:** the function exists with the **old** body. Confirmed
directly: `position('proposal_version_id' in pg_get_functiondef(...)) > 0` is
`false`.

**Dependencies**, all confirmed present: `decision_requests`,
`pilot_scenarios`, `portfolios`, `trade_proposals`,
`trade_proposal_versions`, `trade_queue_items`.

**Blast radius:** `CREATE OR REPLACE` on one function. It does not backfill, so
pilot orgs already seeded keep their unfrozen request; only orgs seeded after
it runs get the fix. Rollback is re-applying the previous definition, which is
recoverable from git history.

**Why it is not urgent, and not ignorable:** `isPilotExampleRequest` marks every
non-tutorial request as an example while a pilot has not graduated, and nothing
on an example can be accepted. That protection ends at graduation —
`effectiveIsPilot` is `hasGraduated ? false : isPilot` — so the seeded request
becomes actionable the moment a pilot graduates. **Apply before graduating any
pilot org.**

---

## 3. `20261125120000_terms_acceptances.sql`

- **sha256** `7bd85a2504e1ee1132e0d725808025163db739c4b17290e5430aebee4c7a5660`
- **bytes** 17570
- **statements** 1 `CREATE TABLE IF NOT EXISTS`, 2 `ALTER TABLE`, 2
  `CREATE INDEX IF NOT EXISTS`, 2 `CREATE OR REPLACE FUNCTION`, 2
  `DROP POLICY IF EXISTS` + 2 `CREATE POLICY`, 2 `GRANT EXECUTE`,
  1 `GRANT SELECT ON TABLE`, 4 `REVOKE ALL ON FUNCTION`, 2
  `REVOKE ALL ON TABLE`, 3 `COMMENT ON`

**Production now: none of it exists.** Confirmed by count:

| Object | In production |
| --- | --- |
| table `terms_acceptances` | **absent** |
| function `record_terms_acceptance` | **absent** |
| function `is_active_org_admin_of` | **absent** |
| policies `terms_acceptances_select_own`, `..._select_org_admin` | absent (no table) |
| indexes `terms_acceptances_user_document_idx`, `..._org_idx` | absent (no table) |

**Dependencies**, confirmed present: `organizations`,
`organization_memberships`, `current_org_id()` (SECURITY DEFINER, no args),
`auth.uid()`. The `legal_documents` string in this file is a **comment**
referring to the `LEGAL_DOCUMENTS` constant in `src/legal/documents.ts`, not a
table — there is no database dependency on it.

**Internal order matters and the file already has it right:** the new
`is_active_org_admin_of` helper is created before the policy that calls it.

**Tenant posture to review before approving** (standing rule 5): the table
carries an explicit `organization_id`; RLS is enabled with `select_own` scoped
to `auth.uid()` and `select_org_admin` scoped through the new definer helper;
writes go only through `record_terms_acceptance`, with `REVOKE ALL ON TABLE`
from the client roles and `GRANT SELECT` only. **A reviewer should confirm
there is an INSERT/UPDATE/DELETE posture for all four verbs and a cross-org
regression test before this is applied**, because the standing rule asks for
all four and this review only verified that two SELECT policies exist.

**Blast radius:** additive. No existing object is altered. Not applying it
leaves the acceptance path dead, which is the current state and is safe:
`TermsAcceptance` has no call site and `fetchOutstandingAcceptances` returns
early unless a document is `approved`, and all five are `draft`.

**Rollback:** `DROP TABLE public.terms_acceptances` plus dropping the two
functions — but only while the table holds no acceptance records. Once a real
acceptance is recorded it is evidence, and dropping it destroys the only proof
of what a user agreed to. **After the first live acceptance this migration is
effectively irreversible.**

---

## Not approved here

Nothing in this document is an approval. Each statement needs explicit human
sign-off, applied outside MCP, and never with `supabase db push`.
