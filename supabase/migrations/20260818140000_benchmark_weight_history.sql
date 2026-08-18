/**
 * Historical benchmark weights.
 *
 * `portfolio_benchmark_weights` already carried `as_of_date` and a
 * `snapshot_id` FK to `benchmark_weight_snapshots` — which enforces
 * UNIQUE (portfolio_id, source, as_of_date) and has been ready for history
 * since it was created. The row table was the only thing forbidding a second
 * date, via UNIQUE (portfolio_id, asset_id).
 *
 * Until this change a historical active weight was not merely unimplemented,
 * it was impossible: there was nothing for a past portfolio weight to be
 * active against. Measured before applying: 3,381 rows, 1 distinct as_of_date
 * (2026-08-14), 0 rows with a null date.
 *
 * ── Why the read sites were converted FIRST ───────────────────────────────
 *
 * Five call sites read this table with no date predicate and were accidentally
 * correct only because the old constraint guaranteed one date. Relaxing it
 * without fixing them would have made every one of them merge index files
 * across dates — `docs/handoff.md` §5c, the distinct-vs-current collapse that
 * already inflated portfolio denominators 36x and made conviction cards emit
 * nothing rather than something visibly wrong.
 *
 * All five now use `latestBenchmarkRows` or order by `as_of_date`, and
 * `npm run guard:holdings` fails on any new read without a date rule. The
 * worst of them, DecisionAccountabilityPage, used `.maybeSingle()` on a bare
 * (portfolio_id, asset_id) pair — which ERRORS on multiple rows into a catch
 * returning null, so every asset would have read as off-benchmark silently.
 *
 * See docs/tickets/portfolio-time-series-ingestion.md §2.
 * Applied to production 2026-08-18 with explicit sign-off.
 */

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

-- Verification (asserts negatives):
--   select count(*) from pg_constraint
--    where conname = 'portfolio_benchmark_weights_portfolio_id_asset_id_key';
--   -- expect 0: the OLD constraint is gone, not merely that a new one exists
--
--   select count(*) from portfolio_benchmark_weights where as_of_date is null;
--   -- expect 0
--
-- Restore path (discards any history captured after this point — that is the
-- point, and the constraint says so by refusing until duplicates are removed):
--   BEGIN;
--   ALTER TABLE public.portfolio_benchmark_weights
--     DROP CONSTRAINT portfolio_benchmark_weights_portfolio_asset_asof_key;
--   DROP INDEX IF EXISTS public.portfolio_benchmark_weights_portfolio_asof;
--   ALTER TABLE public.portfolio_benchmark_weights
--     ALTER COLUMN as_of_date DROP NOT NULL;
--   ALTER TABLE public.portfolio_benchmark_weights
--     ADD CONSTRAINT portfolio_benchmark_weights_portfolio_id_asset_id_key
--     UNIQUE (portfolio_id, asset_id);
--   COMMIT;
