-- The themes_name_key unique index covered `name` globally, so two
-- orgs couldn't both have a theme with the same name (e.g. "Nuclear
-- Energy"). Replace with a per-org case-insensitive uniqueness
-- constraint, scoped to live (non-archived) themes so soft-deleted
-- ones don't permanently reserve the name.

ALTER TABLE public.themes DROP CONSTRAINT IF EXISTS themes_name_key;
DROP INDEX IF EXISTS public.themes_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS themes_organization_id_name_unique
  ON public.themes (organization_id, lower(name))
  WHERE is_archived = false;
