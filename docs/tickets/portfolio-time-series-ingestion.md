# Making every portfolio a time series

Written 2026-08-18. Two ingestion gaps stand between the card surface and
"every portfolio is a time series, with historical active weights". Neither is
a UI problem. One needs no migration and is already scripted; the other needs a
migration and is **not applied** — the body is below, awaiting sign-off per
`docs/handoff.md` §5.6.

---

## 0. What is actually missing, measured

Read from production 2026-08-18, per organisation, because measured across the
whole database every number below is wrong — `Tech & Consumer Growth` is seeded
into 26 pilot orgs and a Management API query bypasses RLS and merges them.

| Input the feature needs | What exists |
|---|---|
| A daily close for every held name | 8 symbols cached; books hold 35–92 names, of which 5–7 are covered |
| A benchmark file per date | **7 rows, all SPY, all `as_of 2026-08-14`** — one file, copied once per portfolio |
| More than one holdings snapshot per book | 4 books in the entire database; the best has 4 dates, and 2 of those 4 are 1- and 2-name fragments |

`buildWeightSeries` already implements the rule this data cannot yet satisfy:
**shares carry forward, prices do not.** A day below 95% priced coverage is
skipped and reported rather than marked at stale prices, because carrying a
price forward corrupts the *denominator* and silently biases every other weight
in the book. Today that gate rejects every day, so the daily path renders
nothing — the correct output, not a defect.

---

## 1. Daily closes — no migration, script ready

`scripts/backfill-price-history.mjs`.

`price_history_cache` is already `UNIQUE (symbol, date)` and carries no
`organization_id`, which is right: a closing price is a market fact keyed by
symbol, not tenant data. So this is an INSERT-only backfill against an existing
table and re-running it is safe.

```
node scripts/backfill-price-history.mjs             # dry run, writes nothing
node scripts/backfill-price-history.mjs --apply     # writes
```

Needs `SUPABASE_SERVICE_ROLE_KEY`: it writes market data used by every
organisation, so it cannot run as a member of one.

It prints symbols requested, symbols fetched, rows written and failures, and
**exits non-zero if it produces zero rows against a non-empty symbol list** —
§4's rule, that an exit code is not evidence a check ran.

### The provider caveat, restated

Yahoo's chart endpoint is undocumented, unlicensed and internal to Yahoo
(§5b). It returns HTTP 200 with an HTML interstitial when it blocks you, which
is the same failure class as iShares and Invesco. The script therefore checks
the response is JSON before parsing, skips and reports anything that is not,
and stamps `source` on every row so a licensed feed can later be told apart
from this one without archaeology. `fetchDailyCloses` is the only function that
knows about the provider.

### To make it recurring

One call per held symbol per day, paced at 250ms. A nightly job after the US
close is the shape; it is not scheduled here because that is a deploy decision.

---

## 2. Historical benchmark weights — MIGRATION, NOT APPLIED

### Why it is blocked today

```
portfolio_benchmark_weights_portfolio_id_asset_id_key  UNIQUE (portfolio_id, asset_id)
```

One row per portfolio per asset. The table already has an `as_of_date` column
and a `snapshot_id` FK to `benchmark_weight_snapshots` — which already enforces
`UNIQUE (portfolio_id, source, as_of_date)` and is ready for history. The row
table is the only thing forbidding a second date.

**Historical active weight is impossible until this changes.** There is nothing
for a past portfolio weight to be active against.

### The migration, for sign-off

Not applied. Paste-ready.

```sql
BEGIN;

-- One row per portfolio per asset PER FILE. The existing constraint permits a
-- single benchmark date and is the only thing preventing history.
ALTER TABLE public.portfolio_benchmark_weights
  DROP CONSTRAINT portfolio_benchmark_weights_portfolio_id_asset_id_key;

-- as_of_date becomes part of identity, so it can no longer be null. Every
-- existing row carries 2026-08-14, so this backfills to nothing.
UPDATE public.portfolio_benchmark_weights
   SET as_of_date = '2026-08-14'
 WHERE as_of_date IS NULL;

ALTER TABLE public.portfolio_benchmark_weights
  ALTER COLUMN as_of_date SET NOT NULL;

ALTER TABLE public.portfolio_benchmark_weights
  ADD CONSTRAINT portfolio_benchmark_weights_portfolio_asset_asof_key
  UNIQUE (portfolio_id, asset_id, as_of_date);

-- Reads are "this portfolio, newest file" and then "this asset". Without this
-- index that becomes a scan once the table holds a year of daily files.
CREATE INDEX IF NOT EXISTS portfolio_benchmark_weights_portfolio_asof
  ON public.portfolio_benchmark_weights (portfolio_id, as_of_date DESC);

COMMIT;
```

**What it replaces:** `portfolio_benchmark_weights_portfolio_id_asset_id_key`,
a two-column unique constraint. Nothing else is dropped, and no data is
deleted — `as_of_date` is populated on every existing row already.

**Restore path:**

```sql
BEGIN;
ALTER TABLE public.portfolio_benchmark_weights
  DROP CONSTRAINT portfolio_benchmark_weights_portfolio_asset_asof_key;
DROP INDEX IF EXISTS public.portfolio_benchmark_weights_portfolio_asof;
ALTER TABLE public.portfolio_benchmark_weights
  ALTER COLUMN as_of_date DROP NOT NULL;
-- Only succeeds once duplicate (portfolio_id, asset_id) rows are removed, i.e.
-- after any history captured post-migration is deleted. That is the point:
-- reverting means giving up the history, and the constraint says so.
ALTER TABLE public.portfolio_benchmark_weights
  ADD CONSTRAINT portfolio_benchmark_weights_portfolio_id_asset_id_key
  UNIQUE (portfolio_id, asset_id);
COMMIT;
```

**Verification, asserting negatives:**

```sql
-- the old constraint is GONE, not merely that the new one exists
select count(*) from pg_constraint
 where conname = 'portfolio_benchmark_weights_portfolio_id_asset_id_key';
-- expect 0

-- two dates can now coexist for one (portfolio, asset)
select portfolio_id, asset_id, count(distinct as_of_date) d
  from public.portfolio_benchmark_weights group by 1,2 having count(distinct as_of_date) > 1;
-- expect rows AFTER a second file is loaded, none before
```

### The read sites that must be fixed FIRST

This is the part that turns a schema change into an outage if it is skipped.
Five call sites read `portfolio_benchmark_weights` with **no date predicate**,
and are accidentally correct only because the constraint guarantees one date:

| File | Line |
|---|---|
| `src/components/mobile/MobileDashboard.tsx` | ~438 — **fixed** |
| `src/components/dashboard/PortfolioWorkbench.tsx` | ~137 — **fixed** |
| `src/components/trading/TradeIdeaDetailModal.tsx` | ~954 — **fixed** |
| `src/pages/DecisionAccountabilityPage.tsx` | ~2630 — **fixed**, and it was the worst of them |
| `src/pages/SimulationPage.tsx` | ~1916 — **fixed** |

`DecisionAccountabilityPage` used `.maybeSingle()` on a bare
`(portfolio_id, asset_id)` pair. That does not merely pick an arbitrary date
once history exists — it **errors** on multiple rows, into a `catch` that
returns `null`, so every asset on an active-weight chart would have read as
off-benchmark with nothing logged anywhere. It now orders by `as_of_date` and
takes one row.

The moment history lands, each starts merging index files across dates. That is
`docs/handoff.md` §5c — the distinct-vs-current collapse, which already
inflated portfolio denominators by up to 36x in `usePortfolioLenses` and made
every conviction card emit **nothing** rather than something visibly wrong.
Live and unflagged for the life of that code.

`src/lib/holdings/latest-benchmark.ts` (`latestBenchmarkRows`) is the single
place that rule lives, mirroring `latestSnapshotRows`. It is a **no-op today**
— one date — which is exactly why it can land before the migration. The mobile
feed already uses it. **The other four must be converted before the migration
is applied**, and `scripts/holdings-collapse-audit.mjs` should be extended to
count benchmark query sites the same way it counts holdings ones, so this
cannot silently regress.

### Capturing the history

`benchmark_weight_snapshots` already records `index_name`, `source`,
`source_type` (`etf_proxy` vs `licensed_benchmark`), `as_of_date`,
`weight_sum` and `holdings_count`, with a CHECK that the sum lands between 99
and 101 — so a bad file is rejected rather than rounded. A capture job writes
one snapshot row plus its weight rows per file.

SSGA is the only issuer that serves this reliably; iShares and Invesco return
HTTP 200 with bot interstitials (§5b). Assume it can vanish, and keep
`source_type` honest — SPY is a fund tracking the S&P 500, not the index.

---

## 3. Order of work

1. ~~Convert the four remaining benchmark read sites.~~ **Done** — all five
   sites now use `latestBenchmarkRows` or order by `as_of_date`.
2. ~~Extend `holdings-collapse-audit.mjs`.~~ **Done** — `npm run guard:holdings`
   now reports `benchmark weight query sites` and fails on any read without a
   date rule. Proven by breaking the subject: removing the helper from
   `SimulationPage` fails the audit naming that line; restored.
3. Run the price backfill (`--apply`), confirm row counts rise per symbol.
   **Not run** — needs `SUPABASE_SERVICE_ROLE_KEY` and writes across every org.
4. **Sign off and apply** the migration in §2, with the negative verification.
5. Capture SSGA files on a schedule; each becomes a new `as_of_date`.
6. Only then does `WeightSeries` have a daily line to draw, and only then is a
   historical active weight computable at all.

Steps 1–2 are done and need no sign-off. Step 3 needs credentials. Step 4 needs
explicit per-migration sign-off (§5.6) and has not been given.
