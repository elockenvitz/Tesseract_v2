-- ══════════════════════════════════════════════════════════════════════
-- Screen lists (Phase 1)
-- ══════════════════════════════════════════════════════════════════════
-- Adds a second, orthogonal axis to asset_lists:
--   • content_mode: 'manual' (rows curated by hand, today's behavior)
--                 | 'screen'  (rows computed from screen_criteria applied
--                              over the asset universe)
-- list_type ('mutual' | 'collaborative') continues to control sharing.
-- A screen can be either mutual or collaborative.
--
-- screen_criteria stores a filter tree. For Phase 1 this is a flat rule
-- list combined with AND; the jsonb shape is forward-compatible with
-- nested AND/OR groups we can add later.
--
-- NOTE: Phase 1 evaluates criteria client-side after fetching accessible
-- assets. A future phase may introduce a SECURITY DEFINER RPC that runs
-- the screen server-side for large universes.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE asset_lists
  ADD COLUMN content_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN screen_criteria jsonb;

ALTER TABLE asset_lists
  ADD CONSTRAINT asset_lists_content_mode_check
  CHECK (content_mode IN ('manual', 'screen'));

-- A screen must have criteria; a manual list must not.
-- (Enforced via trigger rather than CHECK so existing rows default cleanly.)
CREATE OR REPLACE FUNCTION enforce_asset_lists_content_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content_mode = 'screen' AND NEW.screen_criteria IS NULL THEN
    -- Allow NULL during initial create; the UI fills criteria before
    -- the list is usable. No-op here to keep creation flexible.
    RETURN NEW;
  END IF;

  IF NEW.content_mode = 'manual' AND NEW.screen_criteria IS NOT NULL THEN
    -- Clear criteria on manual lists to avoid drift
    NEW.screen_criteria := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_asset_lists_content_mode ON asset_lists;
CREATE TRIGGER trg_enforce_asset_lists_content_mode
  BEFORE INSERT OR UPDATE OF content_mode, screen_criteria ON asset_lists
  FOR EACH ROW
  EXECUTE FUNCTION enforce_asset_lists_content_mode();

-- Index for filtering lists by mode (used in the lists surface query)
CREATE INDEX IF NOT EXISTS idx_asset_lists_content_mode ON asset_lists(content_mode);

COMMENT ON COLUMN asset_lists.content_mode IS
  'How items in this list are determined: manual (curated) or screen (computed from screen_criteria).';
COMMENT ON COLUMN asset_lists.screen_criteria IS
  'Filter tree for screen lists. Shape: { combinator: "AND"|"OR", rules: Array<Rule|Group> }. NULL for manual lists.';
