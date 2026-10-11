# APPLIED — atomic organization delete

Applied to production (`wfcebeagznzgeuyysbnt`) on **2026-10-11** with explicit
approval.

Migration: `supabase/migrations/20261011140000_atomic_organization_delete.sql`
Ledger: recorded as version `20261011140000`.

**Daniel Adam Capital was not deleted.** It still exists, with its 7 coverage
rows intact and its 0 memberships — the shell state the old client path left
it in, preserved pending your decision.

**The client half is not live yet.** The SQL is applied, so the RPC exists; the
ops portal keeps using the old two-statement path until PR is merged and
Netlify deploys. Safe in either order: the RPC is additive, and the old path
still works — just unsafely.

---

## 1. Pre-flight

The function and its grants were proven identical to what the rehearsal
exercised, comments stripped and whitespace collapsed:

```
migration function sha256: 43c0a5cdd8673fa1acb660e5ec82b048a3b5534ba445740af2478227e1a8d2a9
rehearsed function sha256: 43c0a5cdd8673fa1acb660e5ec82b048a3b5534ba445740af2478227e1a8d2a9
migration grants   sha256: 303151ac081a14b05c1e7c5fad31b4e9f5558ace31a224601a54aed415d18e2e
rehearsed grants   sha256: 303151ac081a14b05c1e7c5fad31b4e9f5558ace31a224601a54aed415d18e2e
MATCH
```

Grants are hashed alongside the function because A7/Q7 assert on them.

## 2. Post-apply verification — 8 of 8

Writes run inside a transaction that ends by raising, so only the probes roll
back.

```
OK Q0  applied: (p_organization_id uuid) -> uuid, DEFINER, is_platform_admin(),
       search_path pinned, no explicit membership delete
OK Q1  non-platform-admin refused (42501)
OK Q2  refused call changed nothing
OK Q3  missing organization raises
OK Q4  delete refused (23503) and rolled back: org=1 membership=1 referent=1
OK Q5  the OLD path still leaves org=1 membership=0 — the gate observes its subject
OK Q6  success path: org deleted, memberships cascaded, returned the deleted id
OK Q7  anon has no EXECUTE; authenticated does
```

**Q4 and Q5 are the pair that matters.** Q4 calls the RPC on a fixture whose
delete is refused and shows `org=1, membership=1, referent=1` afterwards —
nothing lost. Q5 then runs the *old* two-statement path against the same
fixture and reproduces `org=1, membership=0`, the shell. Q4 alone would pass
trivially if the delete never endangered the memberships; Q5 is what makes it a
gate.

**Q0 caught a defect in its own first draft.** It asserted the function does
not delete memberships by grepping the whole definition for
`organization_memberships` — which matched the explanatory *comment* and failed
a correct function. Tightened to match a real
`DELETE FROM … organization_memberships` statement, plus a count assertion that
there is exactly one `DELETE FROM organizations`. Recorded rather than quietly
amended.

All fixtures are synthetic organizations created inside the transaction, so no
real tenant was touched even transiently.

## 3. The failure injection, and why it changed

The rehearsal originally injected Q4/A4's failure using the coverage
notification bug. That bug was fixed and applied earlier the same day, so the
fixture stopped failing and the assertion would have **passed vacuously**.

It is now injected by a table created inside the transaction carrying an
`ON DELETE NO ACTION` foreign key to `organizations`. It depends on no app
table, no trigger and no other lane's bug, and asserts on the error class
`23503` rather than on message text. `decision_reviews` and `messages` were
rejected as injections: both are `NO ACTION` on `organizations`, but both stamp
`organization_id` from a trigger, so an injected row would not reliably land in
the fixture's organization.

## 4. Authorization is unchanged

| check | result |
|---|---|
| `organizations` DELETE policy still `is_platform_admin()` | 1 row, unchanged |
| non-platform-admin calling the RPC | refused, `42501` |
| `anon` EXECUTE | false |
| `authenticated` EXECUTE | true |

The function re-checks `is_platform_admin()` explicitly because
`SECURITY DEFINER` bypasses RLS. Without that check it would have widened
access; with it, the set of callers who can delete an organization is exactly
what it was.

`SECURITY DEFINER` is necessary rather than convenient: the cascade reaches
~60 tables whose own policies would each otherwise have to permit the caller's
delete. The decision is made once, at the top, on the predicate the table
policy already used.

## 5. No residue

| check | expected | actual |
|---|---|---|
| `delete_organization` applied | 1 | 1 |
| blocker table left behind | 0 | 0 |
| probe orgs left behind | 0 | 0 |
| total organizations | 29 | 29 |
| `organizations` DELETE policy unchanged | 1 | 1 |
| Daniel Adam Capital still exists | 1 | 1 |
| Daniel Adam Capital coverage rows | 7 | 7 |
| Daniel Adam Capital memberships | 0 | 0 |
| ledger rows for today | 3 | 3 |

## 6. Ledger

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261011140000', 'atomic_organization_delete', null)
on conflict (version) do nothing;
```

`statements` NULL deliberately — the CLI did not run it. No SQL re-executed.
Three migrations recorded today: `20261011120000` (price_target_outcomes),
`20261011130000` (coverage notification), `20261011140000` (this).

## 7. RLS posture

**Unchanged.** One function was added. No table, policy, grant or column was
altered. The function narrows nothing and widens nothing.

## 8. Type ceiling

`MAX_REPO_ERRORS` 8653 → 8654. The new `supabase.rpc` call produces one
`TS2345` that **every** `rpc` call site in this repo already produces,
including the three RPCs `src/types/database.ts` claims are typed — that claim
is measurably false and is noted in the ceiling comment. One error of an
existing kind, raised knowingly rather than left as slack. `guard:types` PASS
with the card surface at 0.

## 9. Still outstanding

`Daniel Adam Capital` remains a shell: it exists, has 0 memberships, 7 coverage
rows and ~7,000 cascading rows including 2 committed `accepted_trades`.
Deleting it now works, but needs separate explicit approval and a decision on
the 7 rows that `ON DELETE SET NULL` would orphan rather than remove
(`trade_queue_items` 6, `asset_notes` 1).
