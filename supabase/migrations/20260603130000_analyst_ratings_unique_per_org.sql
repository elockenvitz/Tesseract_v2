-- Relax the analyst_ratings uniqueness from (asset_id, user_id) to
-- (asset_id, user_id, organization_id). One rating per user per asset
-- PER ORG — so a user can rate AAPL differently in two different orgs
-- they belong to.
--
-- Implemented as a partial unique index instead of a constraint because
-- we need to handle the NULL-org case: pre-migration rows with
-- organization_id IS NULL can coexist freely (they're orphans from
-- before the column existed). New rows always carry an org via the
-- BEFORE INSERT trigger.

ALTER TABLE public.analyst_ratings
  DROP CONSTRAINT IF EXISTS analyst_ratings_asset_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS analyst_ratings_asset_user_org_unique
  ON public.analyst_ratings (asset_id, user_id, organization_id)
  WHERE organization_id IS NOT NULL;
