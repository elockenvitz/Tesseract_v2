# Holdings lane — deferred items

The working-book lane is complete and frozen. This is what was deliberately
left, why, and what each item needs before it can be picked up. Written at the
freeze so the next person inherits decisions rather than archaeology.

Contract, operations and reader convergence are in migrations
`20260906120000` through `20260908100000` and `src/lib/holdings/working-book.ts`.

---

## 1. The daily holdings time series does not exist

`carry_forward_holdings()` is defined and scheduled by
`20260330110000_portfolio_holdings_time_series.sql`. **The cron job is not
registered in production.** `pg_cron` is installed, the migration's
conditional block did not take effect, and zero carry-forward snapshots have
ever been written.

The consequence is that `portfolio_holdings_snapshots` is not a history. It
holds 30 rows for 28 portfolios and exactly one portfolio has more than one
snapshot. It is a table of last uploads.

Two places in the code assert otherwise, and both are wrong today:

- `src/lib/signals/contract.ts` describes the price as "an upload-time mark
  carried forward nightly"
- `src/lib/signals/builders/activeRisk.ts` repeats it

**Not fixed here because it is a design question, not a defect.** Deciding it
means answering whether the product wants a daily series at all — which is a
question about what Outcomes, attribution and performance charts will need,
none of which are built. Resurrecting the job now would start accumulating
rows nobody reads, and deleting the function would foreclose a decision that
has not been made.

**What it needs:** a decision on daily history. If yes, register the job and
correct the two comments. If no, delete `carry_forward_holdings` and correct
the two comments. Either way the comments are wrong now.

---

## 2. `MIN_POSITIONS_FOR_WEIGHT = 5`

`src/lib/holdings/portfolio-context.ts`. Suppresses a "% of the book" claim on
a book with fewer than five positions.

The evidence originally cited for it — "Vision Fund 10K's latest snapshot
holds 2 positions" — was the dated-table collapse, not a small book. That book
always held 29 positions. The evidence is withdrawn; the rule is kept.

Measured against the working book, 2026-09-08, all production portfolios:

| positions | portfolios |
|---|---|
| 1 | 3 (100% CASH_USD) |
| 5 | 4 |
| 25+ | 30 |

Nothing sits between 2 and 4. The threshold today suppresses exactly the three
all-cash books and nothing else, so removing it would change no number a desk
can currently see.

**What it needs:** a product decision about concentrated books, not a
correctness review. Revisit when a real book with two to four positions exists.

---

## 3. `reconciliation_status = 'unmatched'` has two producers

Written by `markTradeUnmatched` when a holdings apply fails, and by
`reconcilePortfolioSnapshot` when a diff cannot account for a trade.

Investigated and found **not** to be a collision. Both mean "the book does not
reflect this trade", which is the only thing any reader does with the value.
They differ only in the shape of `reconciliation_detail`, and the status is
self-healing because reconciliation selects trades by `created_at` rather than
by status and overwrites what it finds.

**Not renamed** because a rename buys nothing and touches the Trade Book, the
reconciliation service and the Decision Accountability surface. Documented in
place instead.

**What it needs:** nothing, unless a reader appears that must tell the two
apart. Then the distinction belongs in `reconciliation_detail`, which already
carries it, rather than in a new status value.

---

## 4. `portfolio_holdings_superseded` is retained

The 28 rows the working-book collapse removed, kept so the one-way data change
is reversible and auditable.

**Do not drop it before the first production reconciliation cycle has been
observed.** It is the only copy of what the collapse discarded, and the
snapshot tables cannot substitute — they hold one row per portfolio and never
recorded the intermediate states.

**What it needs:** one full upload cycle in production, per organisation,
comparing book value before and after. The four affected books sit in four
different customer organisations, so an aggregate across the 26 pilot orgs
will show neither the damage nor the repair. Drop it after that.

---

## 5. Snapshot-semantics readers, kept on purpose

Two production readers still read `portfolio_holdings_positions`, and both are
correct to. Neither is an oversight and neither should be "converged" by
someone applying the working-book rule by reflex.

- **`useAssetPortfolioWeights`** — the custodian's own `weight_pct` as of
  their last file. A custodian weight and a derived weight are different
  numbers that answer different questions, and reconciling them is the point
  of having both. It is shown beside `useAssetLiveWeights` on the mobile asset
  page, which takes current shares from the working book and reprices them
  live.
- **`pro-forma-baseline-service` L0** — must be the last *reconciled* book so
  that L1 (pending trades) is the delta the book does not yet reflect.
  Sourcing L0 from `portfolio_holdings` would double-count every pending
  commitment, because the working book already has them applied.

Both carry a `SNAPSHOT SEMANTICS` header saying so.

---

## 6. Not deferred — done, recorded so it is not re-litigated

- One reduction, `workingBookRows`, replacing `latestSnapshotRows`,
  `currentRows`, `currentHoldings` and the portfolio-detail inline copy. A
  test in `holdings-parity.test.ts` fails if a second definition or any of the
  retired names reappears.
- `useHeldAssetIds`, `useAssetHoldings` and `useAssetLiveWeights` moved from
  snapshot history to the working book. The first was answering "held at any
  point in recorded history", so an exited name stayed on the Held side of a
  roster permanently.
- `guard:holdings` is inverted: a date predicate on `portfolio_holdings` fails
  the build, in TypeScript and in SQL function bodies.
