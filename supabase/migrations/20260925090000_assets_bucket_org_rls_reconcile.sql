-- Bring the migration history into parity with production's hardened
-- `assets` storage policies.
--
-- ── Why this exists ────────────────────────────────────────────────────────
--
-- `20251013115000_create_assets_storage_bucket.sql` created four policies
-- whose entire predicate is `bucket_id = 'assets'`. Any authenticated user of
-- any organisation could read every object every customer had uploaded, and
-- INSERT was equally open.
--
-- Production no longer looks like that. The four hardened policies from
-- `scripts/sql/phase3-assets-bucket-org-rls.sql` were applied by hand, and
-- reading the live catalog on 2026-09-25 confirms production now carries
-- exactly the four `assets: …` policies reproduced below, with the four open
-- ones gone and the bucket private. That script's own header still says it is
-- unapplied; it is stale.
--
-- So the migration directory is the only place the insecure state survives —
-- and it is the state every fresh database, every local validation run and
-- every new environment starts from. Files V1 stores its bytes in this
-- bucket, so its tenancy cannot be validated locally until this is fixed.
-- That is what this migration is for: not a change to production, but a
-- change to what the repository says production is.
--
-- ── What it does where ─────────────────────────────────────────────────────
--
--   * against production: a semantic no-op. The sweep finds the four legacy
--     policies already absent and drops nothing; each hardened policy already
--     exists and is recreated identically.
--   * against a fresh or local database: replaces the open policies created
--     by 20251013115000 with the hardened ones, so the starting point is the
--     same everywhere.
--
-- ── Why the drop is catalog-driven ─────────────────────────────────────────
--
-- The Allocation lane taught this the hard way: five `DROP POLICY IF EXISTS`
-- guesses were wrong, and because permissive policies combine with OR, a
-- surviving `USING (true)` would have sat beside the new restrictive one and
-- silently won. Policy names are not a reliable handle. So instead of naming
-- the policies to remove, this drops EVERY policy on storage.objects whose
-- predicate mentions this bucket and which is not one of the four we are
-- about to create — by reading pg_policies, not by assuming.
--
-- Wrapped in an explicit transaction. Postgres does DDL transactionally, but
-- `psql -f` autocommits per statement, so a failure midway would otherwise
-- leave the bucket with some policies dropped and none created — an open
-- bucket with no policies is closed, but a half-swept one is not predictable.

BEGIN;

-- ── The bucket ─────────────────────────────────────────────────────────────
-- Private. Files V1 serves bytes through signed URLs; nothing in this bucket
-- is ever public.

INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── Refuse to strand objects ───────────────────────────────────────────────
--
-- Copied from phase3-assets-bucket-org-rls.sql. The hardened SELECT policy
-- matches the first path segment against current_org_id(), so an object whose
-- first segment is not an organisation uuid becomes unreadable to everyone
-- the moment these policies land. Better to refuse than to silently orphan.
--
-- `_unattributed` is the deliberate quarantine prefix from the Phase 2
-- backfill and is exempt.

DO $$
DECLARE
  v_legacy bigint;
BEGIN
  SELECT count(*) INTO v_legacy
  FROM storage.objects
  WHERE bucket_id = 'assets'
    AND (storage.foldername(name))[1] <> '_unattributed'
    AND (storage.foldername(name))[1] !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'Refusing to apply: % objects in the assets bucket are still on legacy '
      'paths and would become unreadable. Run the Phase 2 backfill first.',
      v_legacy;
  END IF;
END $$;

-- ── Catalog-driven sweep ───────────────────────────────────────────────────
--
-- Everything on storage.objects that talks about this bucket and is not one
-- of the four canonical names goes. Reading the catalog rather than naming
-- the legacy policies is the whole point: a policy nobody remembered is
-- exactly the one that survives a name-based drop.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%assets%'
      AND policyname NOT IN (
        'assets: read within current org',
        'assets: upload within current org',
        'assets: update own files within current org',
        'assets: delete own files within current org'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    RAISE NOTICE 'dropped legacy assets policy: %', r.policyname;
  END LOOP;
END $$;

-- ── The hardened four ──────────────────────────────────────────────────────
--
-- Transcribed from the live catalog. The tenant boundary is the first path
-- segment, which is what `assetsPath()` in src/lib/storage/asset-paths.ts
-- constructs and refuses to omit. `owner` is uuid, so it is compared to
-- auth.uid() as uuid — 20251013115000 wrote `auth.uid()::text = owner`, which
-- no longer type-checks against current Supabase.

DROP POLICY IF EXISTS "assets: read within current org" ON storage.objects;
CREATE POLICY "assets: read within current org"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

DROP POLICY IF EXISTS "assets: upload within current org" ON storage.objects;
CREATE POLICY "assets: upload within current org"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

DROP POLICY IF EXISTS "assets: update own files within current org" ON storage.objects;
CREATE POLICY "assets: update own files within current org"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "assets: delete own files within current org" ON storage.objects;
CREATE POLICY "assets: delete own files within current org"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND owner = auth.uid()
);

-- ── Prove the negative ─────────────────────────────────────────────────────
--
-- A restrictive policy beside a surviving permissive one is the failure this
-- migration exists to prevent, and it is invisible unless asserted. Both
-- checks run inside the transaction, so a failure rolls the whole thing back.

DO $$
DECLARE
  v_unscoped int;
  v_hardened int;
BEGIN
  SELECT count(*) INTO v_unscoped
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%assets%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT LIKE '%current_org_id%';

  IF v_unscoped > 0 THEN
    RAISE EXCEPTION
      'assets bucket still has % policy/policies without a tenant predicate', v_unscoped;
  END IF;

  SELECT count(*) INTO v_hardened
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'assets: read within current org',
      'assets: upload within current org',
      'assets: update own files within current org',
      'assets: delete own files within current org'
    );

  IF v_hardened <> 4 THEN
    RAISE EXCEPTION 'expected 4 hardened assets policies, found %', v_hardened;
  END IF;
END $$;

COMMIT;
