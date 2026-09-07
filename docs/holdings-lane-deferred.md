# Holdings lane — deferred items

The holdings lane is complete. This is what was deliberately left, why, and
what each item needs before it can be picked up, so the next person inherits
decisions rather than archaeology.

| layer | where |
|---|---|
| Current working book | `20260907100000`, `src/lib/holdings/working-book.ts` |
| Transaction invariants | `20260908100000`, `scripts/holdings-book-concurrency.sh` |
| Event ledger, snapshots, daily close | `20260909100000`–`20260909100200` |

Three contract suites, run against a clean cluster with the whole chain
applied in order:

| suite | assertions |
|---|---|
| `supabase/tests/holdings-working-book.sql` | 22 |
| `supabase/tests/holdings-book-invariants.sql` | 16 |
| `supabase/tests/holdings-history.sql` | 24 |

---

## 1. ~~The daily holdings time series does not exist~~ — RESOLVED

Closed by the historical-ledger stage (migrations `20260909100000` through
`20260909100200`). `close_portfolio_books()` materialises every funded
portfolio's working book as an immutable snapshot each business day, and is
registered with pg_cron at 22:15 UTC on weekdays — 15 minutes after the
existing ingest jobs, so a close never records a book marked with yesterday's
prices.

It replaces `carry_forward_holdings()` rather than reviving it. Carry-forward
copied the last FILE forward, so a day whose only change was an executed trade
carried a book that did not include the trade. Materialising the working book
records what the desk actually held.

**Still outstanding, small:**

- `carry_forward_holdings` is left in place and unscheduled. It has never run
  in production and nothing depends on it; deleting a function in the same
  change that replaces it makes the replacement harder to review.
- `src/lib/signals/contract.ts` and `src/lib/signals/builders/activeRisk.ts`
  still describe the price as "an upload-time mark carried forward nightly".
  That is now nearly true and differently sourced, and both comments should
  say so.
- The close registers itself through the same guarded `DO` block that failed
  silently in 20260330110000. `supabase/tests/holdings-history.sql` exercises
  the function; **verify `cron.job` actually contains `close-portfolio-books`
  after the first deploy** rather than trusting the block ran.
- No market-holiday calendar. A holiday produces a snapshot identical to the
  previous close, which is honest and costs one row per portfolio.

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

---

## 7. Historical-ledger limitations, recorded at the point they were accepted

- **The ledger starts empty.** No backfill. For everything before
  `20260909100000` the provenance does not exist — the working book was
  overwritten in place, and the 28 rows in `portfolio_holdings_superseded` are
  all that survives. Manufacturing events from them would put invented
  authority into the one table whose value is that it was not invented.
- **`fx_rate_to_base` is 1 or NULL.** Every position this product books is
  USD, so the rate is known where it is 1 and honestly unknown otherwise.
  A real multi-currency book needs a rate source before the column means
  anything, and NULL is what says so.
- **`corporate_action` is a reserved event type.** Nothing writes it. Splits
  and spin-offs currently arrive as reconcile changes, which records the size
  change without recording why. Naming the type now costs nothing and makes
  the gap visible.
- **`manual_correction` has no UI.** The event type and the
  `corrects_event_id` link exist, and a correction is expressible today only
  through a direct call to the book operations.
- **`portfolio_trade_events` was not folded in.** It stays the mutable
  workflow object that carries rationale and decision links; the ledger is the
  immutable record of what moved. Deriving the first from the second is a
  later, separate change.
