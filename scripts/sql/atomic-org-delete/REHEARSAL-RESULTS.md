# Atomic organization delete — rehearsal results

Ran `scripts/sql/atomic-org-delete/rehearsal.sql` against production
(`wfcebeagznzgeuyysbnt`) on 2026-10-11, **re-run after the coverage
notification fix landed**. The script creates the RPC, exercises it, and ends
by raising deliberately — so the transaction **cannot commit**.

**The migration has not been applied. Production is unchanged.**
**Daniel Adam Capital and its records were not deleted.**

Everything is proved on a **synthetic organization created inside the
transaction**, so no real tenant is touched even transiently.

---

## Results — 7 of 7

```
--    fixture org 36e61870-725e-44c1-8bb2-382f5f52fb5e: 1 membership, 1 NO ACTION referent
OK A1  non-platform-admin refused (42501) — authorization not widened
OK A2  refused call changed nothing
OK A3  missing organization raises instead of silently passing
OK A4  delete refused (23503) and rolled back cleanly: org=1 membership=1 referent=1
OK A5  the OLD path leaves org=1 membership=0 — the shell this change prevents
OK A6  success path: organization deleted and memberships cascaded, no explicit delete
OK A7  anon has no EXECUTE; authenticated does
ORG DELETE REHEARSAL COMPLETE — ROLLING BACK (nothing committed)
```

## The failure injection was changed, and why that matters

The first version of this script injected A4's failure using the **coverage
notification bug** — a two-asset coverage change for a non-actor threw on
`notifications.context_id`. That bug was fixed and applied earlier the same
day, so the fixture stopped failing and **A4 would have passed vacuously**: an
assertion that "memberships survived" is trivially true if the delete never
endangered them.

This is exactly the defect class the repo warns about — a gate that stops
observing its subject while still reporting PASS — and it was introduced by
fixing an unrelated bug, which is how such couplings normally go unnoticed.

The failure is now injected by a table created **inside this transaction** with
an `ON DELETE NO ACTION` foreign key to `organizations`:

```sql
create table public._orgdel_blocker (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete no action
);
```

It depends on no app table, no trigger and no other lane's bug, and it cannot
silently stop reproducing. A4 now fails with `23503` (`foreign_key_violation`),
asserted by error class rather than by message text.

The app's own `decision_reviews` and `messages` were considered and rejected:
both are `ON DELETE NO ACTION` on `organizations`, but both stamp
`organization_id` from a trigger, so an injected row would not reliably land in
the fixture's organization.

## A4 and A5 are the proof, and neither works without the other

**A4** calls the new RPC on an organization whose delete is refused. Afterwards:
`org=1, membership=1, referent=1` — **nothing was lost.**

**A5** then runs the *old* two-statement client path against the same fixture.
The membership delete lands in its own subtransaction (PostgREST's behaviour),
the organization delete fails, and the result is `org=1, membership=0` — the
shell organization, reproduced on demand.

A4 alone proves nothing. A5 is what makes it a gate.

## Authorization is not widened

| check | result |
|---|---|
| A1 | `colin.e.knox@gmail.com`, not in `platform_admins`, refused with `42501` |
| A2 | after the refusal, `org=1, membership=1` — the refused call changed nothing |
| A7 | `anon` holds no `EXECUTE`; `authenticated` does |

The function re-checks `is_platform_admin()`, the same predicate as the
existing `"Platform admins can delete organizations"` DELETE policy.
`SECURITY DEFINER` bypasses RLS, so without that check the function would have
widened access — the check is what keeps the caller set identical.

`SECURITY DEFINER` is necessary rather than convenient: the cascade reaches
~60 tables whose own policies would each otherwise have to permit the caller's
delete. The decision is made once, at the top, on the predicate the table
policy already used.

## A6 — the success path

With the referent removed, the RPC deletes the organization and the memberships
**cascade**: `org=0, membership=0`, with no explicit membership delete
anywhere. That is the behavioural evidence that
`organization_memberships.organization_id ON DELETE CASCADE` already did this
job and the client's second statement was never needed.

A6 also asserts the RPC returns the deleted organization's id. It returns
`uuid` rather than `void` because a void-returning RPC does not resolve against
supabase-js's `rpc` overloads, and it gives callers something to assert.

## No residue

| check | expected | actual |
|---|---|---|
| blocker table left behind | 0 | 0 |
| synthetic org left behind | 0 | 0 |
| `delete_organization` in production | 0 | 0 |
| total organizations | 29 | 29 |
| Daniel Adam Capital still exists | 1 | 1 |
| Daniel Adam Capital coverage rows | 7 | 7 |
| `jefflockenvitz` memberships | 1 | 1 |
| coverage fix still applied | true | true |

## Next

Awaiting approval to apply `20261011140000`. On approval: apply, re-run A1-A7
against the committed state, reconcile
`supabase_migrations.schema_migrations` by INSERT, and open a focused PR.
