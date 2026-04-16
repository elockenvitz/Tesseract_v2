-- Phase 0: Pro Forma Baseline + Reconciliation Lifecycle
--
-- Adds the minimal schema deltas needed for the new flow:
--   1. Per-portfolio staleness threshold (how many trading days of inactivity
--      before an unreconciled accepted_trade is flagged as stale).
--   2. Activity tracking on accepted_trades — `last_activity_at` is bumped on
--      update or on any comment insert; the 5-day staleness sweeper reads it.
--   3. Staleness flag column (set by the sweeper; flag only, not a status
--      change — PM decides whether to mark the row partial/unmatched).
--   4. Correction link — for post-reconciliation "I need to fix this" flows,
--      a new accepted_trade can point back to the one it corrects.
--   5. Optional execution deadline.
--   6. reconciliation_runs table — one row per holdings-file diff pass.
--
-- Execution-mode semantics: we reuse the existing `portfolios.holdings_source`
-- enum (`paper` | `manual_eod` | `live_feed`). `paper` = pilot (auto-reflect
-- on execute). `manual_eod` + `live_feed` = feed modes that require
-- reconciliation. No new execution_mode column.
--
-- Reconciliation status values: we reuse the existing CHECK on
-- `accepted_trades.reconciliation_status` (pending | matched | partial |
-- deviated | unmatched). No extension needed.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-portfolio staleness threshold
-- ---------------------------------------------------------------------------

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS reconciliation_inactivity_days integer NOT NULL DEFAULT 5;

ALTER TABLE portfolios
  DROP CONSTRAINT IF EXISTS portfolios_reconciliation_inactivity_days_check;
ALTER TABLE portfolios
  ADD CONSTRAINT portfolios_reconciliation_inactivity_days_check
  CHECK (reconciliation_inactivity_days > 0);

COMMENT ON COLUMN portfolios.reconciliation_inactivity_days IS
  'Trading-day inactivity window before a pending accepted_trade is flagged as stale. Resets on any activity.';


-- ---------------------------------------------------------------------------
-- 2. accepted_trades: activity + staleness + correction + expected-by
-- ---------------------------------------------------------------------------

ALTER TABLE accepted_trades
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS staleness_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS corrects_accepted_trade_id uuid,
  ADD COLUMN IF NOT EXISTS execution_expected_by timestamptz;

-- Backfill last_activity_at for existing rows with their latest touchpoint,
-- then enforce NOT NULL + default.
UPDATE accepted_trades
   SET last_activity_at = COALESCE(updated_at, created_at)
 WHERE last_activity_at IS NULL;

ALTER TABLE accepted_trades
  ALTER COLUMN last_activity_at SET NOT NULL,
  ALTER COLUMN last_activity_at SET DEFAULT now();

-- Correction FK (self-referential; set null on delete so we never cascade-destroy
-- a chain, even though we soft-delete via is_active).
ALTER TABLE accepted_trades
  DROP CONSTRAINT IF EXISTS accepted_trades_corrects_fk;
ALTER TABLE accepted_trades
  ADD CONSTRAINT accepted_trades_corrects_fk
  FOREIGN KEY (corrects_accepted_trade_id)
  REFERENCES accepted_trades(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN accepted_trades.last_activity_at IS
  'Last meaningful touch on this row. Bumped by trigger on UPDATE and on accepted_trade_comments INSERT. Used by the staleness sweeper.';
COMMENT ON COLUMN accepted_trades.staleness_flagged_at IS
  'Set by the staleness sweeper when the row crosses the portfolio inactivity threshold. Flag only — does NOT change reconciliation_status. PM decides whether to mark partial / unmatched / continue working.';
COMMENT ON COLUMN accepted_trades.corrects_accepted_trade_id IS
  'If this row is a post-reconciliation correction of another accepted_trade, points to the original. The original stays visible with a "corrected by →" link.';
COMMENT ON COLUMN accepted_trades.execution_expected_by IS
  'Optional soft deadline for execution. Informational only — does not auto-flag.';


-- ---------------------------------------------------------------------------
-- 3. Indexes for staleness sweeper + correction lookup + pro-forma baseline
-- ---------------------------------------------------------------------------

-- Sweeper query: "pending + active + oldest activity" per portfolio.
CREATE INDEX IF NOT EXISTS idx_accepted_trades_staleness
  ON accepted_trades (portfolio_id, last_activity_at)
  WHERE reconciliation_status = 'pending' AND is_active = true;

-- Correction chain lookup (rare but used in Trade Book row expansion).
CREATE INDEX IF NOT EXISTS idx_accepted_trades_corrects
  ON accepted_trades (corrects_accepted_trade_id)
  WHERE corrects_accepted_trade_id IS NOT NULL;

-- Pro-forma baseline query: "give me all pending L1 rows for this portfolio".
-- Hot read path on every Trade Lab render — worth the index.
CREATE INDEX IF NOT EXISTS idx_accepted_trades_pending_by_portfolio
  ON accepted_trades (portfolio_id)
  WHERE reconciliation_status = 'pending' AND is_active = true;


-- ---------------------------------------------------------------------------
-- 4. Activity-bump trigger on accepted_trades
-- ---------------------------------------------------------------------------
-- Any UPDATE bumps last_activity_at. We guard against self-loop by only
-- bumping when the field wasn't touched by the updater — if they explicitly
-- set it, we respect that.

CREATE OR REPLACE FUNCTION bump_accepted_trade_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_activity_at IS NOT DISTINCT FROM OLD.last_activity_at THEN
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accepted_trades_bump_activity ON accepted_trades;
CREATE TRIGGER trg_accepted_trades_bump_activity
  BEFORE UPDATE ON accepted_trades
  FOR EACH ROW
  EXECUTE FUNCTION bump_accepted_trade_activity();


-- ---------------------------------------------------------------------------
-- 5. Activity-bump trigger on accepted_trade_comments
-- ---------------------------------------------------------------------------
-- Any comment is activity. Bumps the parent trade's last_activity_at.

CREATE OR REPLACE FUNCTION bump_parent_accepted_trade_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE accepted_trades
     SET last_activity_at = now()
   WHERE id = NEW.accepted_trade_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accepted_trade_comments_bump_activity ON accepted_trade_comments;
CREATE TRIGGER trg_accepted_trade_comments_bump_activity
  AFTER INSERT ON accepted_trade_comments
  FOR EACH ROW
  EXECUTE FUNCTION bump_parent_accepted_trade_activity();


-- ---------------------------------------------------------------------------
-- 6. reconciliation_runs — one row per holdings-file diff pass
-- ---------------------------------------------------------------------------
-- holdings_upload_id is a nullable uuid placeholder. When we wire up the
-- `holdings_uploads` table in a future phase, we'll add the FK.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  holdings_upload_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  matched_count integer NOT NULL DEFAULT 0,
  partial_count integer NOT NULL DEFAULT 0,
  deviated_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_portfolio
  ON reconciliation_runs (portfolio_id, started_at DESC);

COMMENT ON TABLE reconciliation_runs IS
  'One row per holdings-file diff pass. Tracks how many pending accepted_trades were resolved into matched / partial / deviated / unmatched.';


-- ---------------------------------------------------------------------------
-- 7. RLS on reconciliation_runs
-- ---------------------------------------------------------------------------
-- Uses the existing user_is_portfolio_member() helper (see CLAUDE.md notes).

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_runs_select ON reconciliation_runs;
CREATE POLICY reconciliation_runs_select ON reconciliation_runs
  FOR SELECT
  USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS reconciliation_runs_insert ON reconciliation_runs;
CREATE POLICY reconciliation_runs_insert ON reconciliation_runs
  FOR INSERT
  WITH CHECK (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS reconciliation_runs_update ON reconciliation_runs;
CREATE POLICY reconciliation_runs_update ON reconciliation_runs
  FOR UPDATE
  USING (user_is_portfolio_member(portfolio_id));

-- No DELETE policy: runs are audit records, not deletable from the app.

COMMIT;
