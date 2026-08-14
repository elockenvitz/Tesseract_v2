-- ===========================================================================
-- Phase 3: tenant-scope the `assets` storage bucket.
--
-- DO NOT APPLY THIS YET, AND DO NOT MOVE IT INTO supabase/migrations/ UNTIL
-- THE PHASE 2 BACKFILL REPORTS ZERO UNATTRIBUTABLE AND ZERO LEGACY OBJECTS.
--
-- It lives here rather than in supabase/migrations/ specifically so that a
-- `supabase db push` cannot pick it up by accident. Applying it before the
-- backfill completes makes every object still on a legacy path unreadable
-- to everyone — models, note attachments, checklist evidence, all of it.
--
--   1. node scripts/backfill-assets-bucket-org-scope.mjs           (staging)
--   2. read assets-backfill-report.json; resolve the unattributable set
--   3. ... --apply                                                 (staging)
--   4. re-run the dry run; confirm resolvable = 0 and orphan is understood
--   5. apply this file to staging, exercise uploads/downloads/previews
--   6. repeat 1-5 against production
--   7. only then move this into supabase/migrations/ with a real timestamp
--
-- ===========================================================================
--
-- What it replaces. The bucket was created by
-- 20251013115000_create_assets_storage_bucket.sql with:
--
--     CREATE POLICY "Authenticated users can read files"
--     ON storage.objects FOR SELECT TO authenticated
--     USING (bucket_id = 'assets');
--
-- The only condition is that the object is in the bucket. Any authenticated
-- user of any organization could read every file any customer had ever
-- uploaded. INSERT was equally open. This adds the tenant condition that was
-- never there, matching the first path segment against the caller's current
-- org — the same boundary the table policies already use.
--
-- The owner conditions on UPDATE and DELETE are preserved exactly as they
-- were. This change is a pure tightening: nothing that was denied before is
-- allowed now.
-- ===========================================================================

BEGIN;

-- Fail loudly rather than half-applying if any object is still unscoped.
-- storage.foldername() returns the folder segments, so [1] is the prefix.
DO $$
DECLARE
  v_legacy bigint;
BEGIN
  SELECT count(*) INTO v_legacy
  FROM storage.objects
  WHERE bucket_id = 'assets'
    AND (storage.foldername(name))[1] !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'Refusing to apply: % objects in the assets bucket are still on legacy '
      'paths and would become unreadable. Run the Phase 2 backfill first.',
      v_legacy;
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read files"   ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files"     ON storage.objects;

CREATE POLICY "assets: read within current org"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

CREATE POLICY "assets: upload within current org"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

CREATE POLICY "assets: update own files within current org"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND auth.uid()::text = owner
);

CREATE POLICY "assets: delete own files within current org"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND auth.uid()::text = owner
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification — run after applying. Both should return zero rows.
-- ---------------------------------------------------------------------------
--
-- Objects whose prefix is not a real organization:
--
--   SELECT DISTINCT (storage.foldername(name))[1] AS prefix
--   FROM storage.objects
--   WHERE bucket_id = 'assets'
--     AND (storage.foldername(name))[1] NOT IN (SELECT id::text FROM organizations);
--
-- Database rows still pointing at a legacy path:
--
--   SELECT 'asset_notes' AS src, file_path FROM asset_notes
--     WHERE file_path IS NOT NULL AND file_path !~* '^[0-9a-f-]{36}/'
--   UNION ALL SELECT 'asset_models', file_path FROM asset_models
--     WHERE file_path IS NOT NULL AND file_path !~* '^[0-9a-f-]{36}/'
--   UNION ALL SELECT 'model_versions', file_path FROM model_versions
--     WHERE file_path IS NOT NULL AND file_path !~* '^[0-9a-f-]{36}/'
--   UNION ALL SELECT 'model_templates', base_template_path FROM model_templates
--     WHERE base_template_path IS NOT NULL AND base_template_path !~* '^[0-9a-f-]{36}/';
