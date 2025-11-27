-- Seed Data for Asset Allocation and Target Date Fund features
-- Provides initial data for testing and demonstration

-- ============================================================================
-- ASSET CLASSES
-- ============================================================================

INSERT INTO asset_classes (name, description, sort_order, color, icon) VALUES
('US Equities', 'Domestic US stock exposure including large, mid, and small cap', 1, '#22c55e', 'trending-up'),
('International Developed', 'Non-US developed market equities (Europe, Japan, Australia)', 2, '#3b82f6', 'globe'),
('Emerging Markets', 'Developing market equities (China, India, Brazil, etc.)', 3, '#f59e0b', 'globe-2'),
('US Fixed Income', 'Domestic bonds including treasuries, corporates, and municipals', 4, '#8b5cf6', 'landmark'),
('International Fixed Income', 'Non-US bonds and emerging market debt', 5, '#06b6d4', 'banknote'),
('Real Assets', 'Real estate, commodities, infrastructure, and natural resources', 6, '#ef4444', 'building'),
('Alternatives', 'Hedge funds, private equity, private credit, and other alternatives', 7, '#ec4899', 'sparkles'),
('Cash', 'Money market, short-term instruments, and stable value', 8, '#6b7280', 'wallet');

-- ============================================================================
-- TARGET DATE FUNDS (12 funds: 2015-2070, every 5 years)
-- ============================================================================

INSERT INTO target_date_funds (name, target_year, fund_code, description, benchmark) VALUES
('Target Date 2015', 2015, 'TDF2015', 'For investors who retired around 2015. Conservative allocation focused on income and capital preservation.', 'S&P Target Date 2015 Index'),
('Target Date 2020', 2020, 'TDF2020', 'For investors who retired around 2020. Balanced allocation with focus on stability.', 'S&P Target Date 2020 Index'),
('Target Date 2025', 2025, 'TDF2025', 'For investors retiring around 2025. Transitioning toward more conservative positioning.', 'S&P Target Date 2025 Index'),
('Target Date 2030', 2030, 'TDF2030', 'For investors retiring around 2030. Balanced growth and income allocation.', 'S&P Target Date 2030 Index'),
('Target Date 2035', 2035, 'TDF2035', 'For investors retiring around 2035. Growth-oriented with moderate diversification.', 'S&P Target Date 2035 Index'),
('Target Date 2040', 2040, 'TDF2040', 'For investors retiring around 2040. Growth-focused allocation.', 'S&P Target Date 2040 Index'),
('Target Date 2045', 2045, 'TDF2045', 'For investors retiring around 2045. Aggressive growth allocation.', 'S&P Target Date 2045 Index'),
('Target Date 2050', 2050, 'TDF2050', 'For investors retiring around 2050. Aggressive growth allocation.', 'S&P Target Date 2050 Index'),
('Target Date 2055', 2055, 'TDF2055', 'For investors retiring around 2055. Maximum equity exposure for long-term growth.', 'S&P Target Date 2055 Index'),
('Target Date 2060', 2060, 'TDF2060', 'For investors retiring around 2060. Maximum equity exposure for long-term growth.', 'S&P Target Date 2060 Index'),
('Target Date 2065', 2065, 'TDF2065', 'For investors retiring around 2065. Maximum equity exposure for long-term growth.', 'S&P Target Date 2065 Index'),
('Target Date 2070', 2070, 'TDF2070', 'For investors retiring around 2070. Maximum equity exposure for long-term growth.', 'S&P Target Date 2070 Index');

-- ============================================================================
-- UNDERLYING FUNDS
-- ============================================================================

INSERT INTO tdf_underlying_funds (name, ticker, asset_class, sub_asset_class, expense_ratio) VALUES
-- Equity Funds
('US Large Cap Index Fund', 'USLC', 'Equity', 'US Large Cap', 0.0003),
('US Small Cap Index Fund', 'USSC', 'Equity', 'US Small Cap', 0.0005),
('US Mid Cap Index Fund', 'USMC', 'Equity', 'US Mid Cap', 0.0004),
('International Developed Markets Fund', 'INTL', 'Equity', 'International Developed', 0.0007),
('Emerging Markets Index Fund', 'EM', 'Equity', 'Emerging Markets', 0.0011),
-- Fixed Income Funds
('US Aggregate Bond Index Fund', 'AGG', 'Fixed Income', 'US Aggregate', 0.0003),
('Treasury Inflation Protected Securities', 'TIPS', 'Fixed Income', 'Inflation Protected', 0.0004),
('High Yield Corporate Bond Fund', 'HY', 'Fixed Income', 'High Yield', 0.0015),
('Short-Term Treasury Fund', 'STT', 'Fixed Income', 'Short Duration', 0.0003),
('International Bond Fund', 'INTB', 'Fixed Income', 'International', 0.0008),
-- Alternatives
('Real Estate Index Fund', 'REIT', 'Alternatives', 'Real Estate', 0.0012),
('Commodities Broad Index Fund', 'COMM', 'Alternatives', 'Commodities', 0.0025),
-- Cash
('Stable Value Fund', 'STBL', 'Cash', 'Stable Value', 0.0025),
('Money Market Fund', 'MMF', 'Cash', 'Money Market', 0.0010);

-- ============================================================================
-- SAMPLE ALLOCATION PERIOD
-- ============================================================================

INSERT INTO allocation_periods (name, start_date, end_date, status) VALUES
('Q4 2024', '2024-10-01', '2024-12-31', 'active');

-- ============================================================================
-- SAMPLE GLIDE PATH TARGETS (simplified - same for all TDFs based on years to retirement)
-- This creates targets for years 0-50 from retirement
-- ============================================================================

-- Function to create glide path targets
DO $$
DECLARE
  tdf_rec RECORD;
  years_away integer;
  equity_pct numeric;
  fi_pct numeric;
  alt_pct numeric;
  cash_pct numeric;
BEGIN
  FOR tdf_rec IN SELECT id, target_year FROM target_date_funds LOOP
    -- Calculate years to retirement from 2024
    years_away := tdf_rec.target_year - 2024;
    IF years_away < 0 THEN years_away := 0; END IF;

    -- Calculate allocation based on years to retirement
    -- Glide path formula:
    -- Far from retirement (40+ years): 90% equity
    -- Near retirement (0 years): 40% equity
    -- In retirement (-10 years): 30% equity

    IF years_away >= 40 THEN
      equity_pct := 90;
      fi_pct := 8;
      alt_pct := 2;
      cash_pct := 0;
    ELSIF years_away >= 30 THEN
      equity_pct := 85;
      fi_pct := 12;
      alt_pct := 3;
      cash_pct := 0;
    ELSIF years_away >= 20 THEN
      equity_pct := 75;
      fi_pct := 20;
      alt_pct := 5;
      cash_pct := 0;
    ELSIF years_away >= 10 THEN
      equity_pct := 60;
      fi_pct := 33;
      alt_pct := 5;
      cash_pct := 2;
    ELSIF years_away >= 0 THEN
      equity_pct := 45;
      fi_pct := 45;
      alt_pct := 5;
      cash_pct := 5;
    ELSE
      -- In retirement
      equity_pct := 30;
      fi_pct := 55;
      alt_pct := 5;
      cash_pct := 10;
    END IF;

    INSERT INTO tdf_glide_path_targets (
      tdf_id, years_to_retirement, equity_weight, fixed_income_weight, alternatives_weight, cash_weight
    ) VALUES (
      tdf_rec.id, years_away, equity_pct, fi_pct, alt_pct, cash_pct
    );
  END LOOP;
END $$;

-- ============================================================================
-- SAMPLE HOLDINGS SNAPSHOTS AND HOLDINGS
-- Create snapshots for the last 4 weeks for each TDF
-- ============================================================================

DO $$
DECLARE
  tdf_rec RECORD;
  snapshot_rec RECORD;
  fund_rec RECORD;
  snapshot_date_val date;
  week_offset integer;
  equity_target numeric;
  fi_target numeric;
  alt_target numeric;
  cash_target numeric;
  total_weight numeric;
  fund_weight numeric;
  snapshot_id uuid;
BEGIN
  FOR tdf_rec IN SELECT t.id, t.target_year, g.equity_weight, g.fixed_income_weight, g.alternatives_weight, g.cash_weight
                 FROM target_date_funds t
                 LEFT JOIN tdf_glide_path_targets g ON t.id = g.tdf_id
  LOOP
    equity_target := COALESCE(tdf_rec.equity_weight, 60);
    fi_target := COALESCE(tdf_rec.fixed_income_weight, 35);
    alt_target := COALESCE(tdf_rec.alternatives_weight, 3);
    cash_target := COALESCE(tdf_rec.cash_weight, 2);

    -- Create snapshots for last 4 weeks
    FOR week_offset IN 0..3 LOOP
      snapshot_date_val := CURRENT_DATE - (week_offset * 7);

      INSERT INTO tdf_holdings_snapshots (tdf_id, snapshot_date, snapshot_type, total_aum)
      VALUES (tdf_rec.id, snapshot_date_val, 'weekly', 1000000000 + (random() * 100000000))
      RETURNING id INTO snapshot_id;

      -- Add holdings based on glide path targets
      -- Equity holdings
      INSERT INTO tdf_holdings (snapshot_id, underlying_fund_id, weight, market_value)
      SELECT
        snapshot_id,
        id,
        CASE ticker
          WHEN 'USLC' THEN equity_target * 0.50  -- 50% of equity to large cap
          WHEN 'USMC' THEN equity_target * 0.15  -- 15% of equity to mid cap
          WHEN 'USSC' THEN equity_target * 0.10  -- 10% of equity to small cap
          WHEN 'INTL' THEN equity_target * 0.20  -- 20% of equity to intl developed
          WHEN 'EM' THEN equity_target * 0.05    -- 5% of equity to emerging
        END + (random() * 0.5 - 0.25),  -- Add small random variation
        0
      FROM tdf_underlying_funds
      WHERE asset_class = 'Equity';

      -- Fixed Income holdings
      INSERT INTO tdf_holdings (snapshot_id, underlying_fund_id, weight, market_value)
      SELECT
        snapshot_id,
        id,
        CASE ticker
          WHEN 'AGG' THEN fi_target * 0.60   -- 60% to aggregate
          WHEN 'TIPS' THEN fi_target * 0.15  -- 15% to TIPS
          WHEN 'HY' THEN fi_target * 0.10    -- 10% to high yield
          WHEN 'STT' THEN fi_target * 0.10   -- 10% to short term
          WHEN 'INTB' THEN fi_target * 0.05  -- 5% to intl bonds
        END + (random() * 0.3 - 0.15),
        0
      FROM tdf_underlying_funds
      WHERE asset_class = 'Fixed Income';

      -- Alternatives holdings
      INSERT INTO tdf_holdings (snapshot_id, underlying_fund_id, weight, market_value)
      SELECT
        snapshot_id,
        id,
        CASE ticker
          WHEN 'REIT' THEN alt_target * 0.70  -- 70% to REITs
          WHEN 'COMM' THEN alt_target * 0.30  -- 30% to commodities
        END + (random() * 0.1 - 0.05),
        0
      FROM tdf_underlying_funds
      WHERE asset_class = 'Alternatives';

      -- Cash holdings
      INSERT INTO tdf_holdings (snapshot_id, underlying_fund_id, weight, market_value)
      SELECT
        snapshot_id,
        id,
        CASE ticker
          WHEN 'STBL' THEN cash_target * 0.60  -- 60% to stable value
          WHEN 'MMF' THEN cash_target * 0.40   -- 40% to money market
        END + (random() * 0.05 - 0.025),
        0
      FROM tdf_underlying_funds
      WHERE asset_class = 'Cash';

    END LOOP;
  END LOOP;
END $$;

-- ============================================================================
-- SAMPLE TDF NOTES
-- ============================================================================

DO $$
DECLARE
  tdf_rec RECORD;
BEGIN
  FOR tdf_rec IN SELECT id, target_year FROM target_date_funds WHERE target_year IN (2025, 2030, 2040, 2050) LOOP
    INSERT INTO tdf_notes (tdf_id, title, content, note_type) VALUES
    (
      tdf_rec.id,
      'Q4 2024 Positioning Update',
      'Current positioning reflects our view that equity markets remain attractive despite elevated valuations. We are maintaining a slight overweight to US equities relative to the glide path target. Fixed income allocation is at target, with a preference for shorter duration given the yield curve dynamics.',
      'positioning'
    ),
    (
      tdf_rec.id,
      'Rebalancing Considerations',
      'The portfolio has drifted approximately 2% overweight equities due to strong market performance. Consider rebalancing to target weights in the coming quarter. Key considerations: tax implications, transaction costs, and market timing.',
      'rationale'
    );
  END LOOP;
END $$;

-- ============================================================================
-- SAMPLE OFFICIAL ALLOCATION VIEWS
-- ============================================================================

DO $$
DECLARE
  period_id uuid;
  asset_class_rec RECORD;
BEGIN
  SELECT id INTO period_id FROM allocation_periods WHERE name = 'Q4 2024';

  FOR asset_class_rec IN SELECT id, name FROM asset_classes LOOP
    INSERT INTO official_allocation_views (period_id, asset_class_id, view, rationale)
    VALUES (
      period_id,
      asset_class_rec.id,
      CASE asset_class_rec.name
        WHEN 'US Equities' THEN 'overweight'::allocation_view
        WHEN 'International Developed' THEN 'market_weight'::allocation_view
        WHEN 'Emerging Markets' THEN 'underweight'::allocation_view
        WHEN 'US Fixed Income' THEN 'market_weight'::allocation_view
        WHEN 'International Fixed Income' THEN 'underweight'::allocation_view
        WHEN 'Real Assets' THEN 'overweight'::allocation_view
        WHEN 'Alternatives' THEN 'market_weight'::allocation_view
        WHEN 'Cash' THEN 'strong_underweight'::allocation_view
      END,
      CASE asset_class_rec.name
        WHEN 'US Equities' THEN 'Strong earnings growth expectations and favorable monetary policy trajectory support continued overweight.'
        WHEN 'International Developed' THEN 'Mixed economic signals in Europe and Japan warrant neutral positioning.'
        WHEN 'Emerging Markets' THEN 'China growth concerns and geopolitical risks suggest caution.'
        WHEN 'US Fixed Income' THEN 'Current yield levels provide attractive income with improving total return potential.'
        WHEN 'International Fixed Income' THEN 'Currency headwinds and lower yields make this less attractive.'
        WHEN 'Real Assets' THEN 'Infrastructure spending and inflation protection characteristics remain supportive.'
        WHEN 'Alternatives' THEN 'Diversification benefits warrant continued allocation at target levels.'
        WHEN 'Cash' THEN 'Deploy excess cash into risk assets given attractive forward return expectations.'
      END
    );
  END LOOP;
END $$;
