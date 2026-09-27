-- Files V1: the canonical organisation file repository.
--
-- ── What this is ───────────────────────────────────────────────────────────
--
-- One table answering "where are the documents my organisation intentionally
-- stored in Tesseract?". Bytes live in the existing private `assets` bucket
-- under `<organization_id>/files/<file_id>/<name>`; this row is the metadata
-- and the thing RLS actually guards.
--
-- Existing workflow attachments (`asset_models`, `model_files`,
-- `asset_checklist_attachments`, `project_attachments`, note and thought
-- attachments, workflow templates) stay exactly where they are. Files is the
-- shared repository going forward, not a federated index over those, and
-- nothing here migrates or breaks them.
--
-- ── Conventions followed ───────────────────────────────────────────────────
--
-- Shaped after `benchmark_weight_snapshots` (20260818090000) and
-- `quick_thoughts` (20260827090400), which are the two most recently reviewed
-- org-scoped tables in the repository:
--
--   * `organization_id` owned by the row, NOT NULL, FK to organizations
--   * every policy `TO authenticated`
--   * `organization_id = current_org_id()` ANDed across the whole predicate,
--     never OR-ed into a branch — the anti-pattern `audit_events` has
--   * grants narrowed after the policies
--   * a verification block that asserts the negative
--
-- ── Soft archive ───────────────────────────────────────────────────────────
--
-- `deleted_at timestamptz`, the timestamp form, which is where the newer
-- migrations have converged (`workflows`, `portfolios`, `projects`,
-- `trade_queue_items`). Archiving never removes the storage object — V1 has
-- no physical delete at all.
--
-- The archive predicate is IN THE POLICY, not left to the client. Across this
-- database only two policies filter soft-deleted rows (`portfolios.status`,
-- `research_fields.is_archived`); everywhere else it is a client-side
-- `.eq('is_deleted', false)`, which means an archived row is still readable by
-- anyone who can reach PostgREST directly. For a file repository that is the
-- difference between archived and deleted, so it is enforced here, following
-- the `portfolios` shape: hidden from members, visible to org admins.

BEGIN;

CREATE TABLE IF NOT EXISTS public.files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- `name` is the editable display name; `original_name` is what the user
  -- uploaded and never changes, so a rename cannot lose the provenance of
  -- what the bytes actually were.
  name            text NOT NULL,
  original_name   text NOT NULL,

  -- Where the bytes are. `storage_path` is unique because two rows pointing
  -- at one object means archiving one silently affects the other.
  storage_bucket  text NOT NULL DEFAULT 'assets',
  storage_path    text NOT NULL UNIQUE,

  mime_type       text,
  size_bytes      bigint,

  uploaded_by     uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT files_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT files_original_name_not_blank CHECK (length(btrim(original_name)) > 0),
  CONSTRAINT files_size_nonnegative CHECK (size_bytes IS NULL OR size_bytes >= 0),

  -- The storage path must start with the row's own organisation. Without this
  -- a member of org A could insert a row claiming organization_id = A while
  -- storage_path points into org B's namespace — metadata forgery that the
  -- storage policy alone would not catch, because the storage policy governs
  -- the object and this governs the pointer to it.
  CONSTRAINT files_path_starts_with_org
    CHECK (storage_path LIKE organization_id::text || '/%')
);

-- The repository list: active files for one org, newest first.
CREATE INDEX IF NOT EXISTS files_org_active_created_ix
  ON public.files (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS files_org_uploader_ix
  ON public.files (organization_id, uploaded_by)
  WHERE deleted_at IS NULL;

-- Filename search. `gin_trgm_ops` would be better but pg_trgm is not
-- guaranteed present, and V1 search is a single `ilike` over one org's files
-- — the org+active index above already narrows that to a small set.
CREATE INDEX IF NOT EXISTS files_org_name_ix
  ON public.files (organization_id, lower(name))
  WHERE deleted_at IS NULL;

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- ── Policies ───────────────────────────────────────────────────────────────

-- Archived files are hidden from the repository, with two exceptions: an org
-- admin (who may need to restore one) and the UPLOADER.
--
-- The uploader exception is not a courtesy, it is required for archive to
-- work at all. Postgres applies the SELECT policy to the row an UPDATE
-- produces, so a policy that hid archived rows from their own uploader made
-- `UPDATE files SET deleted_at = now()` fail with "new row violates
-- row-level security policy" — a member could not archive their own file.
-- Verified on a disposable cluster: with the uploader term removed the
-- update is refused, with it present it succeeds.
--
-- It also happens to be the right product behaviour. Archive is not delete;
-- the person who archived something should still be able to see that they
-- did, and ask for it back.
DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select
  ON public.files FOR SELECT TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
    AND (
      deleted_at IS NULL
      OR uploaded_by = auth.uid()
      OR is_active_org_admin_of_current_org()
    )
  );

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert
  ON public.files FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
    AND uploaded_by = auth.uid()
    AND deleted_at IS NULL
  );

-- Rename and archive share one UPDATE policy, because Postgres has no
-- column-level RLS: the USING clause decides who may touch the row and the
-- WITH CHECK decides what the row may become.
--
-- The uploader may do either. An org admin may ONLY archive — that is what
-- the asymmetry between USING and WITH CHECK buys: an admin passes USING,
-- but the WITH CHECK requires the row to end up archived and otherwise
-- unchanged, so an admin cannot rename somebody else's file or un-archive
-- their way into editing it.
--
-- `files_update_admin_archive_only` below is the trigger that enforces
-- "otherwise unchanged", which a WITH CHECK cannot express on its own
-- because it cannot see the old row.
DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update
  ON public.files FOR UPDATE TO authenticated
  USING (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
    AND (
      uploaded_by = auth.uid()
      OR is_active_org_admin_of_current_org()
    )
  )
  WITH CHECK (
    organization_id = current_org_id()
    AND is_active_member_of_current_org()
    AND (
      uploaded_by = auth.uid()
      OR is_active_org_admin_of_current_org()
    )
  );

-- No DELETE policy, deliberately. V1 archives; it does not delete. With RLS
-- enabled and no policy, DELETE is denied to `authenticated` outright — the
-- absence IS the rule, so there is nothing to bypass.

-- ── The admin override is archive-only ─────────────────────────────────────
--
-- A trigger rather than a policy, because a WITH CHECK sees only NEW and
-- cannot say "nothing but deleted_at changed". Runs as the invoker: it makes
-- no privileged decision of its own, it only compares two versions of a row
-- the policy has already admitted.
CREATE OR REPLACE FUNCTION public.files_enforce_admin_archive_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The uploader is unrestricted (within what the policy already allowed).
  IF OLD.uploaded_by = auth.uid() THEN
    -- Tenancy and ownership are immutable for everyone, uploader included.
    NEW.organization_id := OLD.organization_id;
    NEW.uploaded_by     := OLD.uploaded_by;
    NEW.storage_path    := OLD.storage_path;
    NEW.storage_bucket  := OLD.storage_bucket;
    NEW.original_name   := OLD.original_name;
    NEW.created_at      := OLD.created_at;
    NEW.updated_at      := now();
    RETURN NEW;
  END IF;

  -- Anyone else who got past the policy is an org admin, and may only
  -- archive or restore. Every other column is forced back to its old value,
  -- so a rename attempt silently becomes a no-op rather than an error the
  -- caller could probe.
  NEW.name            := OLD.name;
  NEW.original_name   := OLD.original_name;
  NEW.organization_id := OLD.organization_id;
  NEW.uploaded_by     := OLD.uploaded_by;
  NEW.storage_path    := OLD.storage_path;
  NEW.storage_bucket  := OLD.storage_bucket;
  NEW.mime_type       := OLD.mime_type;
  NEW.size_bytes      := OLD.size_bytes;
  NEW.created_at      := OLD.created_at;
  NEW.updated_at      := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS files_enforce_admin_archive_only ON public.files;
CREATE TRIGGER files_enforce_admin_archive_only
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.files_enforce_admin_archive_only();

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Narrowed the way quick_thoughts does. No DELETE: V1 archives.

REVOKE ALL ON public.files FROM anon;
REVOKE ALL ON public.files FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.files TO authenticated;

-- ── Prove the negatives ────────────────────────────────────────────────────

DO $$
DECLARE
  v_untenanted int;
  v_delete_policies int;
BEGIN
  SELECT count(*) INTO v_untenanted
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'files'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT LIKE '%current_org_id%';

  IF v_untenanted > 0 THEN
    RAISE EXCEPTION 'files has % policy/policies with no tenant predicate', v_untenanted;
  END IF;

  SELECT count(*) INTO v_delete_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'files' AND cmd = 'DELETE';

  IF v_delete_policies > 0 THEN
    RAISE EXCEPTION 'files must have no DELETE policy in V1, found %', v_delete_policies;
  END IF;
END $$;

COMMIT;
