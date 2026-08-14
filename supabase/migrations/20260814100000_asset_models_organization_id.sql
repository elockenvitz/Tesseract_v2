/**
 * asset_models / model_versions get a canonical organization_id.
 *
 * Same pattern as 20260603140000 (notes) and 20260605120000 (quick thoughts):
 * a model belongs to the org it was built in, not to the user globally.
 *
 * Two things are being fixed here, and the second is the more serious.
 *
 * 1. Storage attribution. Phase 2 of org-scoping the `assets` bucket has to
 *    decide which org owns each uploaded object. asset_models carried only
 *    created_by and asset_id, and `assets` is the global security master —
 *    two firms researching the same ticker share that row — so neither
 *    column identifies a tenant. Without this column those files cannot be
 *    attributed and cannot be migrated.
 *
 * 2. No policy on this table has ever mentioned an organization.
 *
 *    20251230000002 shipped:
 *
 *      USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_models.asset_id))
 *
 *    asset_id is NOT NULL and references assets, so that predicate reduces to
 *    "the row exists" — it granted every row to everyone.
 *
 *    Production no longer runs that. The live policy is
 *
 *      USING ((created_by = auth.uid()) OR (is_shared = true))
 *
 *    renamed to "Users can view own and shared models" and applied outside
 *    the migrations directory, so the repo never recorded it. Better, but
 *    still not tenant-scoped: is_shared = true means any authenticated user
 *    of any of the 27 organizations can read that row. Both spellings are
 *    dropped below and replaced with an org-scoped equivalent that keeps the
 *    own/shared distinction the live policy was reaching for.
 *
 * ── On the backfill ───────────────────────────────────────────────────────
 *
 * Existing rows are only filled in where the answer is unambiguous: the
 * creator is an active member of exactly one organization. Where a creator
 * belongs to several, there is no way to recover which one they were in when
 * they uploaded, and users.current_organization_id is today's answer to a
 * question about the past. A wrong guess files one firm's model under
 * another firm's org, which is worse than leaving it unset — under the new
 * policy the wrong firm would be able to read it.
 *
 * Rows left NULL are invisible under the new policies until an admin sets
 * them. The verification queries at the bottom list them.
 */

-- ---------------------------------------------------------------------------
-- 1. Column, FK, index
-- ---------------------------------------------------------------------------

ALTER TABLE public.asset_models
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS asset_models_org_id_idx
  ON public.asset_models (organization_id) WHERE is_deleted IS NOT TRUE;

-- model_versions was created outside the migrations directory (it appears in
-- application code and in the tenant lint's FK-chain list, but no migration
-- defines it). Guard so this file is safe to run against an environment
-- where it does not exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'model_versions'
  ) THEN
    ALTER TABLE public.model_versions
      ADD COLUMN IF NOT EXISTS organization_id UUID
      REFERENCES public.organizations(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS model_versions_org_id_idx
      ON public.model_versions (organization_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Unambiguous backfill only
-- ---------------------------------------------------------------------------

-- asset_models: creator is an active member of exactly one org.
UPDATE public.asset_models m
SET organization_id = sole.organization_id
FROM (
  SELECT user_id, (array_agg(DISTINCT organization_id))[1] AS organization_id
  FROM public.organization_memberships
  WHERE status = 'active'
  GROUP BY user_id
  HAVING COUNT(DISTINCT organization_id) = 1
) sole
WHERE sole.user_id = m.created_by
  AND m.organization_id IS NULL;

-- model_versions: inherit from the parent model, which is exact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'model_versions'
  ) THEN
    EXECUTE $sql$
      UPDATE public.model_versions v
      SET organization_id = m.organization_id
      FROM public.asset_models m
      WHERE m.id = v.model_id
        AND v.organization_id IS NULL
        AND m.organization_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- asset_notes: 20260603140000 left pre-migration rows NULL because the
-- relation table carries no org. The same single-org-creator rule recovers
-- the unambiguous ones, which is also what makes their attachments
-- migratable in Phase 2.
UPDATE public.asset_notes n
SET organization_id = sole.organization_id
FROM (
  SELECT user_id, (array_agg(DISTINCT organization_id))[1] AS organization_id
  FROM public.organization_memberships
  WHERE status = 'active'
  GROUP BY user_id
  HAVING COUNT(DISTINCT organization_id) = 1
) sole
WHERE sole.user_id = n.created_by
  AND n.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Stamp organization_id on insert
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_model_org_id_from_caller()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_caller IS NOT NULL THEN
    SELECT current_organization_id INTO NEW.organization_id
    FROM public.users WHERE id = v_caller;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_asset_models_org_id_trigger ON public.asset_models;
CREATE TRIGGER set_asset_models_org_id_trigger
  BEFORE INSERT ON public.asset_models
  FOR EACH ROW EXECUTE FUNCTION public.set_model_org_id_from_caller();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'model_versions'
  ) THEN
    DROP TRIGGER IF EXISTS set_model_versions_org_id_trigger ON public.model_versions;
    CREATE TRIGGER set_model_versions_org_id_trigger
      BEFORE INSERT ON public.model_versions
      FOR EACH ROW EXECUTE FUNCTION public.set_model_org_id_from_caller();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Replace the always-true SELECT policy
-- ---------------------------------------------------------------------------
--
-- The is_shared flag is preserved: a model is visible to the org when shared,
-- and to its creator either way. That is what the original intended — the
-- previous predicate simply never implemented it.

DROP POLICY IF EXISTS "Users can view models for accessible assets" ON public.asset_models;
-- Live name in production, applied outside migrations:
DROP POLICY IF EXISTS "Users can view own and shared models" ON public.asset_models;

CREATE POLICY "Org members can view models in current org"
  ON public.asset_models
  FOR SELECT
  TO authenticated
  USING (
    organization_id = current_org_id()
    AND (is_shared OR created_by = auth.uid())
  );

-- INSERT additionally has to prove the row lands in the caller's own org, or
-- a user could write rows into another tenant.
DROP POLICY IF EXISTS "Users can create models" ON public.asset_models;
DROP POLICY IF EXISTS "Users can create own models" ON public.asset_models;

CREATE POLICY "Users can create models in current org"
  ON public.asset_models
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Users can update own models" ON public.asset_models;

CREATE POLICY "Users can update own models in current org"
  ON public.asset_models
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = created_by
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Users can delete own models" ON public.asset_models;

CREATE POLICY "Users can delete own models in current org"
  ON public.asset_models
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by
    AND organization_id = current_org_id()
  );

COMMENT ON COLUMN public.asset_models.organization_id IS
  'Owning organization. Required for tenant isolation and for attributing the '
  'model file in the assets storage bucket. NULL only on legacy rows whose '
  'creator belongs to more than one org; those must be assigned by an admin.';

-- ---------------------------------------------------------------------------
-- Verification — rows needing a human decision
-- ---------------------------------------------------------------------------
--
--   SELECT m.id, m.name, m.file_path, u.email AS created_by
--   FROM asset_models m JOIN users u ON u.id = m.created_by
--   WHERE m.organization_id IS NULL AND m.is_deleted IS NOT TRUE;
--
--   SELECT n.id, n.title, n.file_path, u.email AS created_by
--   FROM asset_notes n JOIN users u ON u.id = n.created_by
--   WHERE n.organization_id IS NULL AND n.is_deleted IS NOT TRUE;
