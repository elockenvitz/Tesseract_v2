-- =============================================================================
-- C1/05 — scenarios: global defaults vs tenant custom
--
-- Production: 112 rows. 111 are `is_default = true` with `created_by` NULL —
-- genuine global reference data. Exactly ONE is a custom scenario.
--
-- Two live defects:
--   * SELECT is `USING (true)`, so the one custom scenario is readable by every
--     tenant.
--   * UPDATE is `(auth.uid() = created_by) OR (is_default = true)` with **no
--     WITH CHECK**. The second branch means any authenticated user can mutate
--     any of the 111 global defaults — and with no WITH CHECK, can also flip
--     is_default or re-point asset_id on the way through.
--
-- Model: defaults stay global and become immutable to ordinary users; custom
-- scenarios carry an explicit organization_id.
--
-- The legacy custom row is NOT given an organization. Its creator belongs to 2
-- organizations, so membership does not identify the row's tenant. It keeps
-- organization_id NULL and is reachable only by its creator — quarantine over
-- fabrication.
-- =============================================================================

BEGIN;

ALTER TABLE public.scenarios ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN public.scenarios.organization_id IS
  'Tenant owner for custom scenarios. NULL for global defaults (is_default = true) '
  'and for legacy custom rows whose organization is not deterministically recoverable.';

-- NOT NULL is deliberately NOT enforced: defaults require NULL. The invariant
-- that actually matters is the pairing, and it is expressed as a CHECK. The
-- quarantined legacy row is exempted by name rather than by weakening the rule
-- for every future row.
DO $$
DECLARE legacy uuid[];
BEGIN
  SELECT array_agg(id) INTO legacy
    FROM public.scenarios WHERE is_default IS NOT TRUE AND organization_id IS NULL;

  ALTER TABLE public.scenarios DROP CONSTRAINT IF EXISTS scenarios_tenancy_check;

  IF legacy IS NULL OR array_length(legacy, 1) IS NULL THEN
    ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_tenancy_check CHECK (
      (is_default IS TRUE  AND organization_id IS NULL) OR
      (is_default IS NOT TRUE AND organization_id IS NOT NULL));
  ELSE
    RAISE NOTICE 'C1/05: exempting % quarantined legacy custom scenario(s) from the tenancy CHECK',
      array_length(legacy, 1);
    EXECUTE format(
      'ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_tenancy_check CHECK (
         (is_default IS TRUE AND organization_id IS NULL) OR
         (is_default IS NOT TRUE AND organization_id IS NOT NULL) OR
         (id = ANY (%L::uuid[])))', legacy);
  END IF;
END $$;

-- Tenancy becomes part of identity. Without organization_id in the key, two
-- organizations naming the same scenario on the same asset collide only if the
-- same user authored both — an accident of authorship, not a rule.
-- Constraint first: the index backs a UNIQUE constraint, so DROP INDEX alone
-- is refused. Dropping the constraint takes its index with it.
ALTER TABLE public.scenarios DROP CONSTRAINT IF EXISTS scenarios_asset_id_name_created_by_key;
DROP INDEX IF EXISTS public.scenarios_asset_id_name_created_by_key;
CREATE UNIQUE INDEX IF NOT EXISTS scenarios_asset_name_creator_org_key
  ON public.scenarios (asset_id, name, created_by, organization_id);

-- 111 of 112 rows are default, so a partial index is the whole table minus one.
CREATE INDEX IF NOT EXISTS idx_scenarios_organization_id
  ON public.scenarios (organization_id) WHERE is_default IS NOT TRUE;

-- -----------------------------------------------------------------------------
-- Assignment trigger: a custom scenario's org comes from the caller's active
-- organization, never from the request body.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scenarios_set_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.is_default IS TRUE THEN
    NEW.organization_id := NULL;   -- a global default has no tenant, by definition
    RETURN NEW;
  END IF;

  -- Preserve a quarantined legacy row's NULL when it is edited by its creator
  -- without changing tenancy; do not silently adopt it into the editor's org.
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NULL AND OLD.is_default IS NOT TRUE THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  NEW.organization_id := public.current_org_id();
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'scenarios: a custom scenario requires an active organization';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS scenarios_set_organization_id ON public.scenarios;
CREATE TRIGGER scenarios_set_organization_id
  BEFORE INSERT OR UPDATE ON public.scenarios
  FOR EACH ROW EXECUTE FUNCTION public.scenarios_set_organization_id();

-- -----------------------------------------------------------------------------
-- Policies.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view all scenarios"            ON public.scenarios;
DROP POLICY IF EXISTS "Users can create scenarios"              ON public.scenarios;
DROP POLICY IF EXISTS "Users can update their own scenarios"    ON public.scenarios;
DROP POLICY IF EXISTS "Users can delete their own custom scenarios" ON public.scenarios;

-- Defaults readable by everyone (Case vs Price and the scenario ladder depend
-- on it); custom readable in-org; a quarantined legacy row by its creator only.
CREATE POLICY scenarios_select ON public.scenarios
  FOR SELECT TO authenticated
  USING (is_default IS TRUE
         OR organization_id = public.current_org_id()
         OR (organization_id IS NULL AND created_by = auth.uid()));

-- `is_default IS NOT TRUE` on every write is what closes the defect: there is
-- no longer any command through which an ordinary user reaches a global default.
CREATE POLICY scenarios_insert ON public.scenarios
  FOR INSERT TO authenticated
  WITH CHECK (is_default IS NOT TRUE
              AND created_by = auth.uid()
              AND organization_id = public.current_org_id());

CREATE POLICY scenarios_update ON public.scenarios
  FOR UPDATE TO authenticated
  USING (is_default IS NOT TRUE
         AND created_by = auth.uid()
         AND (organization_id = public.current_org_id() OR organization_id IS NULL))
  WITH CHECK (is_default IS NOT TRUE
              AND created_by = auth.uid()
              AND (organization_id = public.current_org_id() OR organization_id IS NULL));

CREATE POLICY scenarios_delete ON public.scenarios
  FOR DELETE TO authenticated
  USING (is_default IS NOT TRUE
         AND created_by = auth.uid()
         AND (organization_id = public.current_org_id() OR organization_id IS NULL));

DO $$
DECLARE defaults int; custom int; quarantined int;
BEGIN
  SELECT count(*) FILTER (WHERE is_default IS TRUE),
         count(*) FILTER (WHERE is_default IS NOT TRUE),
         count(*) FILTER (WHERE is_default IS NOT TRUE AND organization_id IS NULL)
    INTO defaults, custom, quarantined FROM public.scenarios;
  RAISE NOTICE 'C1/05: % defaults, % custom, % quarantined', defaults, custom, quarantined;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scenarios'
              AND cmd IN ('UPDATE','DELETE','INSERT') AND coalesce(qual,with_check) LIKE '%is_default = true%') THEN
    RAISE EXCEPTION 'C1/05: a write policy still admits global defaults';
  END IF;
END $$;

COMMIT;
