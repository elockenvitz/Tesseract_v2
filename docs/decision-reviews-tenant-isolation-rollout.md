# decision_reviews tenant isolation — rollout plan

**Status: proposed. Nothing has been applied to production.**

Confirmed against live production (`wfcebeagznzgeuyysbnt`) by reading the
catalog read-only — not inferred from migrations, which in this repository
routinely disagree with production.

---

## The finding

```
decision_reviews_select_authenticated  SELECT  authenticated  qual = "true"
```

The only SELECT policy on the table. Permissive policies OR together, so one
predicate of `true` was the whole read boundary: every authenticated user in
every one of production's 28 organizations could read every row.

A second defect on the same table: `decision_reviews_insert_self` checked only
`reviewed_by = auth.uid()`, and `decision_id` is unconstrained TEXT with a
UNIQUE index. A user in org A could insert a row claiming any org B decision,
and because UPDATE required `reviewed_by = auth.uid()`, the rightful reviewer
was then **permanently unable to save their own review** — the client upserts
on `decision_id`, so the conflict resolves to an UPDATE that RLS refuses.

**Exposure today:** 7 rows, 3 reviewers, 4 organizations. `process_note` — the
PM's free-text rationale, the sensitive field — is NULL on all 7. That is not
mitigation: it is a function of the UI not writing it yet.

---

## What the change does

| | |
|---|---|
| `organization_id` | New nullable column. **Derived server-side** by the `decision_reviews_owner` trigger; a client-supplied value is discarded. |
| `decision_review_portfolio(text)` | Resolves the polymorphic `decision_id` across `trade_queue_items`, `decision_requests`, `portfolio_trade_events`. NULL when unresolvable. |
| `can_review_decision(text)` | Org membership of the portfolio owning that decision. |
| SELECT | `organization_id IS NOT NULL AND is_member_of_org(organization_id)` |
| INSERT | `reviewed_by = auth.uid() AND can_review_decision(decision_id)` |
| UPDATE | both of the above |
| DELETE | still no policy — unchanged, already denied |
| Grants | `anon` and `PUBLIC` revoked (previously inert but present) |

**Quarantine.** `organization_id IS NULL` is the quarantine state. Every policy
requires it non-null, so the six unresolvable historical rows are invisible to
all tenant-facing queries while remaining fully intact for `service_role` and
for later, evidence-based reassignment. Nothing is deleted. No owner is
guessed.

**New rows cannot be quarantined.** The trigger raises if a decision resolves
to no portfolio. A quarantined row is a historical artefact being preserved; a
*new* one would be invisible to everyone while holding the UNIQUE lock on a
`decision_id` — which is the squat.

---

## Two deliberate judgement calls

**1. Write authorization is org-level, not portfolio-level.** The tighter
choice is `user_is_portfolio_member`, which the `portfolio_trade_events`
policies use. It reads `portfolio_members` — a **third** membership table
alongside `portfolio_team` and `portfolio_memberships`, and this product has a
documented defect where a collaborator in one is absent from another. Scoping
writes on the sparsest of three risks locking legitimate reviewers out, which
is the failure this work is explicitly required to avoid. Org membership is
populated and is sufficient to close the attack, which crossed an organization
boundary. **Tightening is one line once `portfolio_members` coverage is
measured** — listed below as a follow-up, not assumed.

**2. Only the original reviewer can edit a review.** Unchanged from today
(`reviewed_by = auth.uid()` on UPDATE). A second PM in the same org cannot
amend a colleague's review. This is pre-existing product behaviour, not a
regression, and not caused by a malicious row — but it is now worth a decision,
because the quarantine makes it more visible.

---

## Preflight — run and keep the output

`scripts/sql/decision-reviews/verify.sql` §1–2. Expected before:

| Check | Expected |
|---|---|
| Total rows | **7** |
| Resolvable to a parent | **1** |
| Unresolvable | **6** |
| SELECT policies with `qual = true` | **1** |
| `anon` grants | present |

§2c prints every row with the owner it *would* be given and a
`backfill` / `QUARANTINE` disposition. **That output is the backfill
evidence** — it must be captured before applying, and the quarantine list
reviewed by a human, because those six rows become invisible.

---

## Apply

1. **Branch database first.** Apply the migration, then run `verify.sql`
   §3–6 in full, with `-v user_a=… -v user_b=… -v decision_a=…` for two real
   users in two different organizations. §6 covers, each raising on failure:
   same-tenant authorized SELECT · cross-tenant SELECT denial · cross-tenant
   INSERT denial · cross-tenant UPDATE denial · cross-tenant **upsert** denial
   (the client's actual write shape) · historical orphan quarantine · the
   rightful reviewer is **not** blocked.
2. **Production**, in a transaction (the migration is already wrapped in
   `BEGIN`/`COMMIT`).
3. **Immediately after:** `verify.sql` §3–5. Expected: total 7, owned 1,
   quarantined 6; zero rows where the stamped org differs from the derived
   one; no `true` predicate; no `anon`/`PUBLIC` grant.
4. **Refresh the security inventory**, then run `npm run guard:policies`. The
   ratchet entry for `decision_reviews` has been removed, so a stale inventory
   still showing `qual = true` will fail the guard — correctly. Refresh
   *after* deployment, not before.

## Post-deployment smoke tests

- Outcomes → Decision Quality: a review in your own org still reads and saves.
- The six quarantined decisions show **no** review and return to the review
  queue. `has_decision_review` flips false for them, which demotes those
  Outcomes rows from `resolved` to `evaluate`. **This is the visible product
  regression and needs sign-off** — those rows were always attributing to a
  dangling string.
- `usePilotScenarioStatus` reports the pilot reflection step incomplete for
  any affected scenario.
- Check error logs for `check_violation` from `decision_reviews_set_owner`: a
  burst means legitimate reviews are hitting unresolvable decisions, i.e. the
  resolver is missing a parent table.

## Rollback

`20261009120001_…_DOWN.sql.rollback`, applied by hand. Deliberately not a
`.sql` file — `supabase/migrations` is applied in filename order and a
down-migration there would run forward.

It restores **access, not data state**: `organization_id` stays, populated.
Dropping it would discard the only provenance this work established, and
re-running forward after a rollback is then safe and idempotent. The `anon`
grant is not restored.

**Rolling back re-opens the cross-tenant read.** It exists so the path is
takeable under pressure, not because reverting is an acceptable resting state.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Six rows become invisible | **Expected, needs sign-off** | Preserved, not deleted; §2c is the list; reversible |
| Org-level write scope is looser than portfolio-level | Medium | Closes the cross-tenant attack; tightening is one line once `portfolio_members` coverage is known |
| Resolver misses a fourth parent table | Medium | Trigger raises loudly rather than creating an orphan; watch for `check_violation` |
| `trade_queue_items.portfolio_id` is nullable | Low | A portfolio-less idea genuinely has no owner; reviews on one are refused rather than orphaned |
| Guard fails after deploy on a stale inventory | Low | Refresh step is ordered in Apply |
| SECURITY DEFINER functions | Low | Both return only a boolean or a portfolio id, never row contents; `search_path` pinned; `anon` revoked |

## Not in scope

- `decision_reviews` is **not** wired into the Asset Snapshot. Asset Page 2.0
  stays paused.
- The 6 orphans are not reassigned. That needs evidence this change cannot
  manufacture.
- `tenant-boundary-lint.mjs` stays out of CI — it needs a service-role key.
  Only the credential-free policy guard was wired in.
