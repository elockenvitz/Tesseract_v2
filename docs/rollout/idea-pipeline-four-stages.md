# Idea Pipeline: four-stage rollout

Expand → deploy → contract. Each step is safe on its own, and at no point do
the database and the running application disagree.

## Order of operations

| # | Action | Reversible? |
|---|---|---|
| 1 | Apply `20260928120000_idea_pipeline_expand.sql` | Effectively yes — purely additive |
| 2 | Verify (queries below) | — |
| 3 | Deploy the branch build | Yes — roll back to the previous build |
| 4 | Soak. Watch for legacy writes (query below) | — |
| 5 | Apply `20260928130000_idea_pipeline_contract.sql` | **No** |
| 6 | Later cleanup: remove `LEGACY_STAGE_MAP`, drop `trade_stage` | — |

Step 5 is the only irreversible one, and it is the only step that requires the
previous step to be complete. Everything before it can be paused or rolled
back.

## Safety matrix

| Database | Old app (pre-four-stage) | New app (this branch) |
|---|---|---|
| **pre-expand** | ✅ safe — today's production | ❌ **breaks**: writes `ready_to_recommend`, which the enum rejects |
| **expanded** | ✅ safe — every legacy label still a member, no row rewritten, no default added | ✅ safe — canonical labels accepted; legacy rows normalise on read |
| **contracted** | ❌ **breaks**: writes `deciding`, which the enum no longer has | ✅ safe — every row canonical |

The expanded row is the point: both builds are correct against it
simultaneously, so the deploy is ordinary rather than a coordinated outage.

Asserted mechanically in `supabase/tests/pipeline/05_expand.sql`, assertions
2 and 3 — legacy writes accepted, canonical writes accepted, on the same
schema.

## Verification queries

**After step 1 (expand).** Expect 15, and 0.

```sql
SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'trade_stage';                                   -- 15

SELECT count(*) FROM trade_queue_items WHERE stage_migrated_from IS NOT NULL;  -- 0
```

**Before step 5 (contract) — the human prerequisite.** No SQL check can tell
whether an old instance is still serving traffic. This detects one by the
labels it leaves behind. Expect 0, sustained.

```sql
SELECT count(*) FROM trade_queue_items
 WHERE stage::text IN ('aware','investigate','deep_research','thesis_forming',
                       'ready_for_decision','idea','discussing','working_on',
                       'modeling','simulating','deciding')
   AND updated_at > now() - interval '1 hour';
```

A non-zero result means something is still writing legacy stages. Find it
before contracting — the migration will happily rewrite those rows and the
writer will then start failing.

**After step 5.** Expect `idea_stage` twice, and 0.

```sql
SELECT c.relname, format_type(a.atttypid, a.atttypmod)
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
 WHERE a.attname = 'stage' AND c.relname IN ('trade_queue_items','trade_idea_portfolios');

SELECT count(*) FROM trade_queue_items WHERE stage_migrated_from IS NULL;
```

---

# Manual smoke checklist — one real pilot org

Run after step 3 (new build on the expanded database). The point of running it
there rather than after contract is that the expanded state is the one with
mixed data, which is where anything is going to go wrong.

## Pipeline movement

- [ ] Move an idea **Exploring → Researching**. No gate, moves immediately.
- [ ] Move it **Researching → Developing**. No gate.
- [ ] Move it **Developing → Ready to Recommend** with the thesis blank.
      → refused, naming what is missing ("Why now (rationale)", "Trade thesis").
- [ ] Fill both, move again. → succeeds.
- [ ] Move it **backwards** to Researching. → always allowed, never gated.
- [ ] Find an idea created **before** the deploy (legacy stage in the DB) and
      confirm it appears in a sensible column rather than vanishing or piling
      into Exploring. This is the normalization boundary doing its job.

## Recommendation handoff

- [ ] From Ready to Recommend, **Submit Recommendation**.
- [ ] It appears in the **Decision Inbox**.
- [ ] **The idea's stage does not change.** It stays at Ready to Recommend.
      This is the behaviour the whole change exists to produce; if the card
      moves, something still auto-advances.

## Attention feed — Approve / Reject

These previously wrote a terminal status with no decision behind it.

**With a submitted recommendation:**
- [ ] Approve succeeds.
- [ ] The idea shows an outcome, and the audit trail records **who** did it —
      Reject previously recorded no actor at all.

**Without a submitted recommendation:**
- [ ] Approve is **refused**, with: *"No recommendation has been submitted for
      this idea, so there is no decision to record an outcome against."*
- [ ] The card does **not** appear to succeed and then revert.

> If refusing here feels wrong in use — if the Attention feed is genuinely
> where PMs expect to approve things that were never formally submitted —
> that is a product question about whether the feed should offer a
> *Submit and approve* action, not a reason to restore the bypass. Report it;
> do not loosen the invariant.

## Drag to a terminal column

- [ ] Drag an **undecided** idea onto Executed / Rejected.
      → refused; no outcome written; the card returns to where it was; the
      message explains why.

## Simulation promotion

- [ ] Promote a variant from a simulation to the Trade Book.
      → succeeds. This path creates the `accepted_trades` row first, which is
      its decision evidence, so the gate must not block it.
- [ ] **Create Trade List** with a mix of decided and undecided linked ideas.
      → the list is created; the toast says how many ideas were *not* marked
      executed. Silence here would be the old bug.

## Snooze

- [ ] Open an idea, **Snooze** it with a date.
- [ ] The sheet says *Snooze*, not *Defer*, when no portfolio is selected.
- [ ] `revisit_at` is set; **no outcome is written**; the idea stays active and
      non-terminal (it must not vanish from the live pipeline).
- [ ] With a portfolio selected the same sheet still says **Defer
      Recommendation** — that one is a real decision and is unchanged.

## Revert

- [ ] Accept a recommendation, then **Revert** the accepted trade.
- [ ] The decision request returns to **pending**.
- [ ] The idea's outcome is **cleared** — it no longer reads Executed.
- [ ] The idea is not outcome-eligible while reopened (try recording one).
- [ ] Decide it again. → succeeds. Before this change the overwrite guard made
      a reverted idea permanently undecidable.

## Provisioning

- [ ] Create a **new pilot org**. Demo ideas appear.
      They will carry legacy stages until contract, which is expected — check
      they render in sensible columns, not all in Exploring.
- [ ] Repeat after contract. Demo ideas appear with canonical stages.
      This is the path that swallows its own errors, so "no demo data" is the
      failure signature rather than an error message.
