-- Files V1: links from a repository file to a Tesseract object.
--
-- ── Why not object_links ───────────────────────────────────────────────────
--
-- `object_links` is the dominant convention and is well built — two
-- polymorphic endpoints, a `linkable_entity_type` enum, an org-assignment
-- trigger, four tight policies. It was the obvious candidate and is
-- deliberately not used.
--
-- Its type column is a shared enum consumed by ten-plus components. Adding
-- `file` to it means `ALTER TYPE linkable_entity_type ADD VALUE`, and Postgres
-- cannot remove an enum value — so the cheapest possible reversal of a V1
-- decision would be impossible. Its endpoint resolver would also need a new
-- branch for files, which is a change to the tenancy of every existing link
-- type's code path.
--
-- A narrow table with a CHECK constraint is reversible: drop it and nothing
-- else in the product notices. `ai_conversation_tags` (20260427140000) made
-- the same call for the same reason, after the single `(context_type,
-- context_id)` pair on `ai_conversations` was abandoned.
--
-- What IS taken from `object_links` is its lesson, stated at
-- scripts/sql/security-c1/04-object-links.sql:7-11: a polymorphic row must
-- own its `organization_id` rather than deriving it by joining to whichever
-- endpoint happens to be tenant-owned, because some endpoints are global and
-- contribute no tenant at all.
--
-- ── Targets ────────────────────────────────────────────────────────────────
--
-- `asset` and `project` only.
--
-- `research` is deferred. There is no single canonical research entity:
-- `research_fields`, `asset_contributions`, `field_contributions` and
-- `theme_contributions_v2` are all candidates with different tenancy shapes,
-- and picking one without a product decision would be guessing. Adding a
-- value to this CHECK later is a one-line migration, which is exactly why
-- this is a CHECK and not an enum.
--
-- The two supported targets validate differently, and that asymmetry is the
-- point:
--
--   * `project` is tenant-owned. `projects.organization_id` must equal the
--     link's org, or a member of org A could attach a file to org B's
--     project.
--   * `asset` is GLOBAL and deliberately has no `organization_id` — see
--     src/lib/storage/asset-paths.ts:10-14. Two firms researching the same
--     ticker share one row. So an asset target contributes no tenant and is
--     validated only for existence. This is not a gap: the FILE carries the
--     tenancy, and the file is org-scoped.

BEGIN;

CREATE TABLE IF NOT EXISTS public.file_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id         uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,

  target_type     text NOT NULL,
  target_id       uuid NOT NULL,

  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT file_links_target_type_ck
    CHECK (target_type IN ('asset', 'project')),

  -- Linking the same file to the same thing twice says nothing new.
  CONSTRAINT file_links_unique UNIQUE (file_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS file_links_file_ix
  ON public.file_links (file_id);

-- "What files are attached to this project?" — the reverse lookup, which is
-- how the asset and project workspaces will read this later.
CREATE INDEX IF NOT EXISTS file_links_target_ix
  ON public.file_links (organization_id, target_type, target_id);

ALTER TABLE public.file_links ENABLE ROW LEVEL SECURITY;

-- ── Target validation ──────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it reads `projects`, whose own RLS would otherwise
-- hide a row the caller cannot see and make a cross-tenant link look like a
-- link to a non-existent project. It answers exactly one boolean and takes no
-- caller-supplied identity — the org comes from `current_org_id()`, never
-- from an argument — so there is nothing here to impersonate with.
CREATE OR REPLACE FUNCTION public.file_link_target_is_valid(
  p_target_type text,
  p_target_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := current_org_id();
BEGIN
  IF v_org IS NULL OR p_target_id IS NULL THEN
    RETURN false;
  END IF;

  CASE p_target_type
    -- Tenant-owned: must be this org's.
    WHEN 'project' THEN
      RETURN EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = p_target_id
          AND p.organization_id = v_org
      );

    -- Global security master, no organization_id by design. Existence only.
    WHEN 'asset' THEN
      RETURN EXISTS (SELECT 1 FROM assets a WHERE a.id = p_target_id);

    -- An unknown type is refused rather than allowed. If the CHECK above ever
    -- gains a value and this CASE does not, links of that type simply cannot
    -- be created — which is the safe direction for the two to disagree in.
    ELSE
      RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.file_link_target_is_valid(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_link_target_is_valid(text, uuid) TO authenticated, service_role;

-- ── Policies ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS file_links_select ON public.file_links;
CREATE POLICY file_links_select
  ON public.file_links FOR SELECT TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
  );

-- The file must be this org's AND live: attaching to an archived file, or to
-- a file in another org, are both refused. The EXISTS re-checks
-- `files.organization_id` directly rather than trusting the caller's
-- `organization_id` column — never trust client-supplied tenancy alone.
DROP POLICY IF EXISTS file_links_insert ON public.file_links;
CREATE POLICY file_links_insert
  ON public.file_links FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM files f
      WHERE f.id = file_id
        AND f.organization_id = current_org_id()
        AND f.deleted_at IS NULL
    )
    AND file_link_target_is_valid(target_type, target_id)
  );

-- Unlinking is a real delete: a link carries no history worth keeping, and an
-- archived link would need its own filter everywhere. Any active member of
-- the owning org may unlink, matching who may link.
DROP POLICY IF EXISTS file_links_delete ON public.file_links;
CREATE POLICY file_links_delete
  ON public.file_links FOR DELETE TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
  );

-- No UPDATE policy: a link has no mutable field. Changing what a link points
-- at is delete-then-create, which leaves `created_by` and `created_at`
-- honest.

REVOKE ALL ON public.file_links FROM anon;
REVOKE ALL ON public.file_links FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.file_links TO authenticated;

-- ── Prove the negatives ────────────────────────────────────────────────────

DO $$
DECLARE
  v_untenanted int;
  v_update_policies int;
BEGIN
  SELECT count(*) INTO v_untenanted
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'file_links'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT LIKE '%current_org_id%';

  IF v_untenanted > 0 THEN
    RAISE EXCEPTION 'file_links has % policy/policies with no tenant predicate', v_untenanted;
  END IF;

  SELECT count(*) INTO v_update_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'file_links' AND cmd = 'UPDATE';

  IF v_update_policies > 0 THEN
    RAISE EXCEPTION 'file_links must have no UPDATE policy, found %', v_update_policies;
  END IF;
END $$;

COMMIT;
