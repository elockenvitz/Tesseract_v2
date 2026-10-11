# Atomic organization delete — rehearsal results

Ran `scripts/sql/atomic-org-delete/rehearsal.sql` against production
(`wfcebeagznzgeuyysbnt`) on 2026-10-11. The script creates the RPC, exercises
it, and ends by raising deliberately — so the transaction **cannot commit**.

**The migration has not been applied. Production is unchanged.**
**Daniel Adam Capital and its records were not deleted.**

Everything is proved on a **synthetic organization created inside the
transaction**, so no real tenant is touched even transiently.

---

## Results — 7 of 7

```
--    fixture org 831f246b-04aa-42bb-badd-2603586d65cf with 1 membership and 2 coverage rows
OK A1  non-platform-admin refused (42501) — authorization not widened
OK A2  refused call changed nothing
OK A3  missing organization raises instead of silently passing
OK A4  delete failed and rolled back cleanly: org=1 membership=1 coverage=2
      failure was: null value in column "context_id" of relation "notifications"
      violates not-null constraint
OK A5  the OLD path leaves org=1 membership=0 — the shell this change prevents
OK A6  success path: organization deleted and memberships cascaded, no explicit delete
OK A7  anon has no EXECUTE; authenticated does
ORG DELETE REHEARSAL COMPLETE — ROLLING BACK (nothing committed)
```

## A4 and A5 are the proof, and neither works without the other

**A4** calls the new RPC on an organization whose cascade aborts — the real
production failure, reproduced by giving the fixture two coverage rows held by
someone other than the actor. The delete raises, and afterwards
`org=1, membership=1, coverage=2`: **nothing was lost.**

**A5** then runs the *old* two-statement client path against the same fixture.
The membership delete lands in its own subtransaction (PostgREST's behaviour),
the organization delete fails, and the result is `org=1, membership=0` — the
shell organization, reproduced on demand.

A4 alone would prove nothing: an assertion that "memberships survived" passes
trivially if the delete never endangered them. A5 shows the danger is real on
that exact fixture, which is what makes A4 a gate rather than decoration.

## Authorization is not widened

| check | result |
|---|---|
| A1 | `colin.e.knox@gmail.com`, not in `platform_admins`, is refused with `42501` |
| A2 | after the refusal, `org=1, membership=1` — the refused call changed nothing |
| A7 | `anon` holds no `EXECUTE`; `authenticated` does |

The function re-checks `is_platform_admin()` explicitly, which is the same
predicate as the existing `"Platform admins can delete organizations"` DELETE
policy. `SECURITY DEFINER` bypasses RLS, so without that check the function
would have widened access — the check is what keeps the caller set identical.

`SECURITY DEFINER` is necessary rather than convenient: the cascade reaches
~60 tables whose own policies would each otherwise have to permit the caller's
delete. The authorization decision is made once, at the top, on the predicate
the table policy already used.

## A6 — the success path, and one teardown note

With the blocker cleared, the RPC deletes the organization and the memberships
**cascade**: `org=0, membership=0`, with no explicit membership delete
anywhere. That is the behavioural evidence that
`organization_memberships.organization_id ON DELETE CASCADE` already did this
job and the client's extra statement was never needed.

Clearing the fixture's coverage is itself a two-asset removal for another user,
so it trips the coverage-notification bug. The script drops the JWT first
(`set_config('request.jwt.claims','{}')`), which makes `auth.uid()` NULL and
causes `notify_coverage_removed_bulk` to return early — exactly how every
service-role and SQL-side write already avoids it today. That is fixture
teardown, not part of what A6 asserts.

## Interaction with the other two lanes

This change does **not** fix the coverage notification bug — A4's failure
message is that bug. The two are independent and deliberately separate:

- with only this change, a blocked delete fails **safely** instead of leaving a
  shell
- with only the coverage fix, the delete succeeds but a future unrelated
  failure would still strand an organization
- both are needed; neither waits on the other

## No residue

| check | expected | actual |
|---|---|---|
| synthetic org left behind | 0 | 0 |
| `delete_organization` exists in production | 0 | 0 |
| recipient's coverage rows | 0 | 0 |
| Xtina Capital memberships | 1 | 1 |
| Daniel Adam Capital still exists | 1 | 1 |
| Daniel Adam Capital coverage rows | 7 | 7 |
| total organizations | 29 | 29 |

## Next

Awaiting approval to apply `20261011140000`. On approval: apply, re-run A1-A7
against the committed state, reconcile
`supabase_migrations.schema_migrations` by INSERT, and open a focused PR.
