# Holdings working book — deployment contract

**Status**: code complete on `feat/holdings-working-book-contract` (6ecbf65).
**BLOCKED EXTERNALLY on migration execution.** Deliberately NOT integrated
into `qa/mobile-integration` — §2 says why, with the evidence.
**Assessed**: 2026-09-10, backlog closure.
**Companion**: `docs/holdings-lane-deferred.md` on that branch is the lane's
own deferred register and is not duplicated here.

---

## 1. What the lane is

Eleven migrations and roughly 6,500 lines. `portfolio_holdings` stops being a
dated snapshot table and becomes the working book: `UNIQUE (portfolio_id,
asset_id)`, one live row per position, no row meaning not held. On top of that
an immutable event ledger, snapshot revisions, and a daily close registered
with pg_cron.

It closes a real and measured defect: Mobile and Desktop disagreed by up to
49× on the same portfolio, because `currentRows` took the newest row per
position and `latestSnapshotRows` took every row on the newest date. Both were
correct readings of a dated table and they returned different books.

Four contract suites, 70 assertions, run against a clean cluster with the whole
chain applied in order.

---

## 2. Why it is NOT on qa/mobile-integration

**The application code reads a view that does not exist yet.**

`portfolio_book_snapshots_current` is created by
`20260910100000_holdings_current_revision_readers.sql`. It appears in no
migration on the integration baseline, so it does not exist in staging or
production. Six source files on the branch read it:

```
src/lib/services/pro-forma-baseline-service.ts
src/lib/services/trade-reconciliation-service.ts
src/hooks/mobile/useDerivedInsights.ts
src/pages/ops/OpsClientDetailPage.tsx
src/pages/ops/OpsDashboardPage.tsx
src/pages/ops/OpsHoldingsPage.tsx
```

Merging the application half without the schema half would break the pro-forma
baseline that Trade Lab simulations are built on, trade reconciliation, mobile
derived insights and three ops pages — each with a "relation does not exist"
at runtime, which is the failure that does not show up in a build or a unit
test.

So this lane is **atomic**: the migrations and the application code deploy
together or neither deploys. Integrating it into a QA baseline that runs
against an unmigrated database would make the baseline less trustworthy, not
more, which is the opposite of what an integration branch is for.

The branch must remain. It is not superseded and it is not abandoned.

---

## 3. Two findings from this assessment

### 3.1 The cron registration is not robust, and its compensating control does not exist

`20260909100200_holdings_daily_close.sql:147-171` registers
`close-portfolio-books` with pg_cron inside a guarded `DO` block. Its own
comment says:

> (20260330110000) used the same guarded shape and never took effect in
> production — pg_cron is installed and the job is absent. So this one reports
> what it did rather than assuming, and `supabase/tests/holdings-daily-close.sql`
> asserts the job exists rather than trusting that this block ran.

**That test file does not exist.** Nothing in `supabase/tests/` on that branch
references `close-portfolio-books` at all.

So the mechanism has the same shape as the one it names as having failed: if
`pg_cron` is absent the block raises a `WARNING`, the migration succeeds, and
no job is scheduled. A warning in migration output is not a control — it is a
line in a log nobody reads afterwards. The one thing that would have made it a
control was named in the comment and never written.

This is the repository's documented "gate cannot observe its own failure mode"
defect class, and it is worse than the usual instance because the comment
asserts the coverage exists.

**What it needs:** either write `supabase/tests/holdings-daily-close.sql`
asserting `cron.job` contains `close-portfolio-books` with the expected
schedule, or delete the claim from the migration comment. Not fixed here: it
must be executed against a cluster with the full chain applied to be worth
anything, and no such cluster is available from the integration worktree. It
is a one-file change for whoever runs the deploy.

**Until then, the post-deploy check in `docs/holdings-lane-deferred.md` §1 is
the only control**, and it is manual: verify `cron.job` actually contains the
job after the first deploy rather than trusting the block ran.

### 3.2 `workingBookRows` is safe on unmigrated data, which is easy to misread as "safe to ship early"

`src/lib/holdings/working-book.ts` reduces to one row per (portfolio, asset),
newest date winning, and is explicitly documented as a no-op on post-migration
data and a guard for hand-assembled inputs. It works correctly against the
current dated table too.

That property is real and it is not permission to merge the lane early. The
reduction is not what breaks; §2's missing view is. Recorded here because
"the reduction handles the old shape" is exactly the observation that would
justify a partial merge to somebody who had not checked the rest.

---

## 4. Post-deploy tasks, explicit

These are not TODOs in code. Each has an owner action and a completion test.

| # | Task | Done when |
|---|---|---|
| 1 | Verify the cron job registered | `SELECT * FROM cron.job WHERE jobname = 'close-portfolio-books'` returns one row with schedule `15 22 * * 1-5` |
| 2 | Observe one full reconciliation cycle | Book value compared before and after upload, **per organization** — the four affected books are in four different customer orgs, so an aggregate across the 26 pilot orgs shows neither damage nor repair |
| 3 | Drop `portfolio_holdings_superseded` | Only after (2). It is the only surviving copy of the 28 rows the collapse removed |
| 4 | Drop `carry_forward_holdings` | Left in place and unscheduled deliberately; delete once the close has run for a week |
| 5 | Correct two stale comments | `src/lib/signals/contract.ts` and `builders/activeRisk.ts` still describe the price as "an upload-time mark carried forward nightly", which is differently sourced now |

Items 2 and 3 require a production observation period and cannot be shortened.

---

## 5. Open product decisions in this lane

Both are recorded in `docs/holdings-lane-deferred.md` and neither blocks
deployment:

- **`MIN_POSITIONS_FOR_WEIGHT = 5`** suppresses a "% of the book" claim on
  books with fewer than five positions. Measured across all production
  portfolios, nothing sits between 2 and 4 positions, so today it suppresses
  exactly three all-cash books and nothing else. Revisit when a real book with
  two to four positions exists. Not a correctness question.
- **No market-holiday calendar.** A holiday produces a snapshot identical to
  the previous close: honest, and one row per portfolio. Inventing a calendar
  would put a US-equity assumption into the schema.
