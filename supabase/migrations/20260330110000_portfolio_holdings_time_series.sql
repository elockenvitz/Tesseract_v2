-- Portfolio Holdings Time Series
--
-- Nightly holdings uploads append to a daily time series.
-- If no upload occurs for a day, a carry-forward function copies the previous day's snapshot.
--
-- Tables:
--   portfolio_holdings_snapshots — one row per portfolio per day (metadata)
--   portfolio_holdings_positions — one row per asset per snapshot (the actual positions)
--
-- Flow:
--   1. External upload (CSV, API, custodian feed) → inserts snapshot + positions
--   2. pg_cron runs carry_forward_holdings() nightly → copies previous day for portfolios with no upload
--   3. portfolio_trade_events can be derived by diffing consecutive snapshots

-- ============================================================
-- 1. Snapshots (one per portfolio per day)
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_holdings_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual_upload'
    CHECK (source IN ('manual_upload', 'api_sync', 'custodian_feed', 'carry_forward', 'reconciliation')),
  total_market_value NUMERIC,
  total_positions INTEGER DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(portfolio_id, snapshot_date)
);

ALTER TABLE portfolio_holdings_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read holdings snapshots"
  ON portfolio_holdings_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert holdings snapshots"
  ON portfolio_holdings_snapshots FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update holdings snapshots"
  ON portfolio_holdings_snapshots FOR UPDATE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_holdings_snapshots_portfolio_date
  ON portfolio_holdings_snapshots(portfolio_id, snapshot_date DESC);

-- ============================================================
-- 2. Positions (one per asset per snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_holdings_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES portfolio_holdings_snapshots(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  shares NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC,
  market_value NUMERIC,
  cost_basis NUMERIC,
  weight_pct NUMERIC,
  sector TEXT,
  asset_class TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(snapshot_id, symbol)
);

ALTER TABLE portfolio_holdings_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read holdings positions"
  ON portfolio_holdings_positions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert holdings positions"
  ON portfolio_holdings_positions FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_holdings_positions_snapshot
  ON portfolio_holdings_positions(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_holdings_positions_portfolio_symbol
  ON portfolio_holdings_positions(portfolio_id, symbol);

CREATE INDEX IF NOT EXISTS idx_holdings_positions_asset
  ON portfolio_holdings_positions(asset_id);

-- ============================================================
-- 3. Carry-forward function
-- ============================================================

-- For each portfolio that had a snapshot yesterday but not today,
-- copy yesterday's snapshot (marked source='carry_forward').
CREATE OR REPLACE FUNCTION carry_forward_holdings(p_target_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_prev_date DATE;
  v_portfolio RECORD;
  v_new_snapshot_id UUID;
BEGIN
  -- Find the most recent business day before target
  v_prev_date := p_target_date - INTERVAL '1 day';

  -- Loop through portfolios that have a snapshot on prev_date but NOT on target_date
  FOR v_portfolio IN
    SELECT DISTINCT prev.portfolio_id, prev.id AS prev_snapshot_id, prev.total_market_value, prev.total_positions
    FROM portfolio_holdings_snapshots prev
    WHERE prev.snapshot_date = v_prev_date
      AND NOT EXISTS (
        SELECT 1 FROM portfolio_holdings_snapshots cur
        WHERE cur.portfolio_id = prev.portfolio_id
          AND cur.snapshot_date = p_target_date
      )
  LOOP
    -- Create carry-forward snapshot
    INSERT INTO portfolio_holdings_snapshots (portfolio_id, snapshot_date, source, total_market_value, total_positions)
    VALUES (v_portfolio.portfolio_id, p_target_date, 'carry_forward', v_portfolio.total_market_value, v_portfolio.total_positions)
    RETURNING id INTO v_new_snapshot_id;

    -- Copy positions from previous snapshot
    INSERT INTO portfolio_holdings_positions (snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value, cost_basis, weight_pct, sector, asset_class)
    SELECT v_new_snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value, cost_basis, weight_pct, sector, asset_class
    FROM portfolio_holdings_positions
    WHERE snapshot_id = v_portfolio.prev_snapshot_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. pg_cron job for nightly carry-forward
-- ============================================================
-- Runs at 6:00 AM UTC daily. Portfolios with real uploads will already
-- have a snapshot for the day; this only fills gaps.

-- Note: pg_cron must be enabled. If not available, this SELECT is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('carry-forward-holdings');
    PERFORM cron.schedule(
      'carry-forward-holdings',
      '0 6 * * *',
      $cron$SELECT carry_forward_holdings(CURRENT_DATE);$cron$
    );
  END IF;
END;
$$;
