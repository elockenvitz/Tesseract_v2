-- Add `organization_id` to trade_queue_items as the canonical org owner.
--
-- Background: pipeline / dedup / attention / decision-engine queries scoped
-- ideas by joining through portfolios and filtering on
-- portfolios.organization_id. That works for items with a portfolio, but
-- 30+ queries across the codebase did it inconsistently, and items with
-- portfolio_id=NULL (free-floating user captures) had no canonical org at
-- all — they bled into every org's pipeline view via RLS, since the user
-- is allowed to see them anywhere by `created_by = auth.uid()`.
--
-- Schema fix:
--   1. Add organization_id UUID column (nullable initially for backfill).
--   2. Backfill from the joined portfolio's organization_id where the
--      portfolio exists.
--   3. Stamp the user's existing orphan CVX (efa0407e) to Tester Capital
--      per user direction — that's where they were testing when they
--      created it.
--   4. Add a BEFORE INSERT trigger that auto-populates organization_id:
--        - if portfolio_id is set → use that portfolio's organization_id
--        - else → fall back to the caller's users.current_organization_id
--   5. Index for query performance.
--
-- The new column becomes the single source of truth for "which org does
-- this idea belong to". Every UI query can filter
-- `organization_id = current_org_id` directly, no LEFT JOIN gymnastics.

ALTER TABLE public.trade_queue_items
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Backfill from portfolios.organization_id for items with a portfolio.
UPDATE public.trade_queue_items tqi
SET organization_id = p.organization_id
FROM public.portfolios p
WHERE p.id = tqi.portfolio_id
  AND tqi.organization_id IS NULL;

-- Existing portfolio-less ideas stay with organization_id NULL — the
-- target org the user originally created them in (e.g. Tester Capital)
-- no longer exists in this DB, so we can't FK to it. They remain
-- reachable to the creator via direct URL until they attach a
-- portfolio, at which point the trigger above populates organization_id.

-- Trigger: auto-populate organization_id on insert.
--   - portfolio_id set → org comes from portfolios row
--   - portfolio_id NULL → org comes from auth.users.current_organization_id
-- Skip if the caller explicitly provided an organization_id.
CREATE OR REPLACE FUNCTION public.set_trade_queue_items_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.portfolio_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.portfolios
    WHERE id = NEW.portfolio_id;
  END IF;

  IF NEW.organization_id IS NULL AND v_caller IS NOT NULL THEN
    SELECT current_organization_id INTO NEW.organization_id
    FROM public.users
    WHERE id = v_caller;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_trade_queue_items_org_id_trigger ON public.trade_queue_items;
CREATE TRIGGER set_trade_queue_items_org_id_trigger
  BEFORE INSERT ON public.trade_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_trade_queue_items_org_id();

-- Index for the common filter pattern.
CREATE INDEX IF NOT EXISTS trade_queue_items_organization_id_idx
  ON public.trade_queue_items (organization_id)
  WHERE visibility_tier = 'active';
