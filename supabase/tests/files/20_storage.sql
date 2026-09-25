-- Files V1: storage-layer tenancy.
--
-- The database tables and the storage bucket enforce tenancy INDEPENDENTLY.
-- 10_tenancy.sql proves the metadata boundary; this proves the object
-- boundary, so that neither one alone is load-bearing. A forged `files` row
-- still cannot reach another org's bytes, and an object uploaded out of band
-- still cannot be read across the boundary.

\set ON_ERROR_STOP on
SET client_min_messages TO NOTICE;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL % : expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE WARNING 'PASS  %', p_label;
END $$;

DELETE FROM storage.objects WHERE bucket_id = 'assets';

-- Seeded as owner: the fixture is the other org's existing object, which the
-- attacker is trying to reach.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('assets',
   'bbbbbbbb-0000-4000-a000-000000000002/files/f0000000-0000-4000-a000-00000000000b/B secret.pdf',
   'b0000000-0000-4000-a000-00000000000d');

-- ═══ Bucket posture ════════════════════════════════════════════════════════

SELECT pg_temp.ok('assets bucket is private',
  (SELECT public FROM storage.buckets WHERE id = 'assets'), false);

SELECT pg_temp.ok('no assets policy without a tenant predicate',
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) LIKE '%assets%'
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) NOT LIKE '%current_org_id%'), 0);

SELECT pg_temp.ok('the four hardened assets policies exist',
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'assets: read within current org',
       'assets: upload within current org',
       'assets: update own files within current org',
       'assets: delete own files within current org')), 4);

-- The specific legacy names, asserted gone. The catalog sweep above is the
-- real guard; this names them so a regression says which one came back.
SELECT pg_temp.ok('legacy open assets policies are gone',
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'Authenticated users can upload files',
       'Authenticated users can read files',
       'Users can update their own files',
       'Users can delete their own files')), 0);

-- ═══ Cross-tenant object access ════════════════════════════════════════════

SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';  -- org A

SELECT pg_temp.ok('org A cannot read an org B object',
  (SELECT count(*)::int FROM storage.objects
   WHERE name LIKE 'bbbbbbbb-%'), 0);

-- Upload into another org's namespace.
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('assets', 'bbbbbbbb-0000-4000-a000-000000000002/files/evil/evil.pdf',
            'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL org A uploaded into org B namespace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- A path crafted to look like it escapes upward. `foldername()` splits on
-- '/', so segment [1] is literally '..' here and can never equal an org uuid.
DO $$ BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('assets', '../bbbbbbbb-0000-4000-a000-000000000002/files/evil/evil.pdf',
            'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL traversal-style path accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Another org's id buried deeper in the path does not move the boundary:
-- segment [1] is still org A, so this lands inside org A and is harmless.
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('assets',
        'aaaaaaaa-0000-4000-a000-000000000001/bbbbbbbb-0000-4000-a000-000000000002/ok.pdf',
        'a0000000-0000-4000-a000-00000000000b');

RESET ROLE;
SELECT pg_temp.ok('no org B object was created by org A',
  (SELECT count(*)::int FROM storage.objects
   WHERE bucket_id = 'assets' AND name LIKE 'bbbbbbbb-%'), 1);  -- only the seeded one
SELECT pg_temp.ok('traversal path was not created',
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE '..%'), 0);
SET ROLE authenticated;

-- Legitimate upload into own namespace.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('assets',
        'aaaaaaaa-0000-4000-a000-000000000001/files/f0000000-0000-4000-a000-00000000000c/mine.txt',
        'a0000000-0000-4000-a000-00000000000b');
SELECT pg_temp.ok('org A uploads into its own namespace',
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE 'aaaaaaaa-%/files/%'), 1);

-- Deleting somebody else's object, inside the same org: the hardened policy
-- requires `owner = auth.uid()` as well as the org match.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000e';
DELETE FROM storage.objects
WHERE name = 'aaaaaaaa-0000-4000-a000-000000000001/files/f0000000-0000-4000-a000-00000000000c/mine.txt';
RESET ROLE;
SELECT pg_temp.ok('another member cannot remove your object',
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE '%mine.txt'), 1);
SET ROLE authenticated;

-- Org B cannot remove org A's object either.
SET request.jwt.claim.sub = 'b0000000-0000-4000-a000-00000000000d';
DELETE FROM storage.objects WHERE name LIKE 'aaaaaaaa-%';
RESET ROLE;
SELECT pg_temp.ok('org B cannot remove an org A object',
  (SELECT count(*)::int FROM storage.objects WHERE name LIKE 'aaaaaaaa-%'), 2);

RESET request.jwt.claim.sub;
