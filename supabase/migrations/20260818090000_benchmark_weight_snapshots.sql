/**
 * Provenance for benchmark weights.
 *
 * portfolio_benchmark_weights already carried `source` and `as_of_date` but no
 * way to say WHAT KIND of source, and nowhere to record the weight sum. Without
 * the sum a later reader cannot tell whether the rejection rule was applied or
 * merely believed — the same gap that made analyst_price_targets unverifiable.
 *
 * The sum belongs to the snapshot, not to each row, so the snapshot is its own
 * table. It is stored UNROUNDED (99.9775, not 100) precisely so it can be
 * checked.
 *
 * source_type exists because SPY is not the S&P 500. It is a fund tracking the
 * index, with its own cash drag, rebalance lag and as-of date, and presenting
 * its weights as "the benchmark" would be the same error as normalising a
 * probability distribution that does not sum to 100.
 *
 * Applied to production 2026-08-18. Verified: table exists, snapshot_id column
 * present, and ZERO policies lacking an organization predicate.
 */

BEGIN;

CREATE TABLE public.benchmark_weight_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    uuid NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  index_name      text NOT NULL,
  source          text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('etf_proxy','licensed_benchmark')),
  as_of_date      date NOT NULL,
  weight_sum      numeric NOT NULL,
  holdings_count  integer NOT NULL CHECK (holdings_count > 0),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Rejected, never rounded up. A snapshot outside this band is a bad file.
  CONSTRAINT weight_sum_is_plausible CHECK (weight_sum BETWEEN 99.0 AND 101.0),
  CONSTRAINT one_snapshot_per_source_per_day UNIQUE (portfolio_id, source, as_of_date)
);

CREATE INDEX benchmark_weight_snapshots_portfolio_asof
  ON public.benchmark_weight_snapshots (portfolio_id, as_of_date DESC);

ALTER TABLE public.portfolio_benchmark_weights
  ADD COLUMN snapshot_id uuid REFERENCES public.benchmark_weight_snapshots(id) ON DELETE CASCADE;

ALTER TABLE public.benchmark_weight_snapshots ENABLE ROW LEVEL SECURITY;

-- Org predicate ANDed across the whole policy, never OR-ed into a branch.
CREATE POLICY "Org members can view benchmark snapshots"
  ON public.benchmark_weight_snapshots FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Org members can insert benchmark snapshots"
  ON public.benchmark_weight_snapshots FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

COMMIT;

-- Verification (asserts negatives):
--   select count(*) from pg_policies where tablename='benchmark_weight_snapshots'
--     and coalesce(qual,'')||coalesce(with_check,'') not like '%organization_id%';
--   -- expect 0
