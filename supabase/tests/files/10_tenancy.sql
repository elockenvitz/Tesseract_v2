-- Files V1: tenancy and authority assertions.
--
-- Everything here runs as `authenticated` with `request.jwt.claim.sub` set to
-- a specific user, which is how Supabase resolves `auth.uid()`. A test that
-- ran as the table owner would bypass RLS entirely and assert nothing.
--
-- Two organisations, four users:
--   A-admin   org A, is_org_admin
--   A-member  org A, ordinary active member
--   A-gone    org A, status = 'inactive'
--   B-member  org B, ordinary active member
--
-- Assertions are written as "did the write land / is the row visible",
-- deliberately, rather than "did it raise". A write blocked by a USING filter
-- silently matches nothing while one blocked by a WITH CHECK raises, and both
-- are correct refusals — asserting a specific one makes the test brittle
-- against a policy that is equally secure.

\set ON_ERROR_STOP on
-- NOTICE so each `pass <label>` is visible. A suite whose output is
-- suppressed proves only that it did not error, which is not the same as
-- having asserted anything.
SET client_min_messages TO NOTICE;

-- ── Fixture ────────────────────────────────────────────────────────────────

DELETE FROM file_links;
DELETE FROM files;
DELETE FROM storage.objects WHERE bucket_id = 'assets';
DELETE FROM organization_memberships;
DELETE FROM projects;
DELETE FROM assets;
DELETE FROM users;
DELETE FROM organizations;

INSERT INTO organizations (id, name) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-4000-a000-000000000002', 'Org B');

INSERT INTO users (id, email, current_organization_id) VALUES
  ('a0000000-0000-4000-a000-00000000000a', 'a-admin@x',  'aaaaaaaa-0000-4000-a000-000000000001'),
  ('a0000000-0000-4000-a000-00000000000b', 'a-member@x', 'aaaaaaaa-0000-4000-a000-000000000001'),
  ('a0000000-0000-4000-a000-00000000000c', 'a-gone@x',   'aaaaaaaa-0000-4000-a000-000000000001'),
  ('b0000000-0000-4000-a000-00000000000d', 'b-member@x', 'bbbbbbbb-0000-4000-a000-000000000002'),
  -- A second ordinary member of org A, so "hidden from other members" can be
  -- asserted against somebody who is neither the uploader nor an admin.
  ('a0000000-0000-4000-a000-00000000000e', 'a-other@x',  'aaaaaaaa-0000-4000-a000-000000000001');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000a', true,  'active'),
  ('aaaaaaaa-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b', false, 'active'),
  ('aaaaaaaa-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000c', false, 'inactive'),
  ('bbbbbbbb-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-00000000000d', false, 'active'),
  ('aaaaaaaa-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000e', false, 'active');

INSERT INTO assets (id, symbol, company_name) VALUES
  ('cccccccc-0000-4000-a000-000000000001', 'NVDA', 'NVIDIA');

INSERT INTO projects (id, title, organization_id, created_by) VALUES
  ('dddddddd-0000-4000-a000-00000000000a', 'A project', 'aaaaaaaa-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b'),
  ('dddddddd-0000-4000-a000-00000000000b', 'B project', 'bbbbbbbb-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-00000000000d');

-- Seeded as owner so the fixture itself is not what is under test.
INSERT INTO files (id, organization_id, name, original_name, storage_path, mime_type, size_bytes, uploaded_by) VALUES
  ('f0000000-0000-4000-a000-00000000000a', 'aaaaaaaa-0000-4000-a000-000000000001',
   'A report.pdf', 'A report.pdf',
   'aaaaaaaa-0000-4000-a000-000000000001/files/f0000000-0000-4000-a000-00000000000a/A report.pdf',
   'application/pdf', 1024, 'a0000000-0000-4000-a000-00000000000b'),
  ('f0000000-0000-4000-a000-00000000000b', 'bbbbbbbb-0000-4000-a000-000000000002',
   'B secret.pdf', 'B secret.pdf',
   'bbbbbbbb-0000-4000-a000-000000000002/files/f0000000-0000-4000-a000-00000000000b/B secret.pdf',
   'application/pdf', 2048, 'b0000000-0000-4000-a000-00000000000d');

CREATE OR REPLACE FUNCTION pg_temp.ok(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL % : expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE WARNING 'PASS  %', p_label;
END $$;

-- ═══ READ ══════════════════════════════════════════════════════════════════

SET ROLE authenticated;

SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';
SELECT pg_temp.ok('A member sees org A file', (SELECT count(*)::int FROM files), 1);
SELECT pg_temp.ok('A member sees only its own org', (SELECT count(*)::int FROM files WHERE organization_id <> 'aaaaaaaa-0000-4000-a000-000000000001'), 0);

SET request.jwt.claim.sub = 'b0000000-0000-4000-a000-00000000000d';
SELECT pg_temp.ok('B member cannot see org A file', (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000a'), 0);
SELECT pg_temp.ok('B member sees its own file', (SELECT count(*)::int FROM files), 1);

SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000c';
SELECT pg_temp.ok('inactive member sees nothing', (SELECT count(*)::int FROM files), 0);

RESET request.jwt.claim.sub;
SELECT pg_temp.ok('anonymous sees nothing', (SELECT count(*)::int FROM files), 0);

-- ═══ INSERT ════════════════════════════════════════════════════════════════

SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';

-- Forged tenancy: claim org B while standing in org A.
DO $$ BEGIN
  BEGIN
    INSERT INTO files (organization_id, name, original_name, storage_path, uploaded_by)
    VALUES ('bbbbbbbb-0000-4000-a000-000000000002', 'forged', 'forged',
            'bbbbbbbb-0000-4000-a000-000000000002/files/x/forged', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL A member created metadata for org B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('cross-org metadata insert refused', (SELECT count(*)::int FROM files WHERE name = 'forged'), 0);

-- Forged uploader: attribute the upload to somebody else.
DO $$ BEGIN
  BEGIN
    INSERT INTO files (organization_id, name, original_name, storage_path, uploaded_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'forged-by', 'forged-by',
            'aaaaaaaa-0000-4000-a000-000000000001/files/y/forged-by', 'a0000000-0000-4000-a000-00000000000a');
    RAISE EXCEPTION 'FAIL forged uploaded_by accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('forged uploaded_by refused', (SELECT count(*)::int FROM files WHERE name = 'forged-by'), 0);

-- Path pointing into another org, with honest metadata. The CHECK constraint
-- is what catches this; the storage policy governs the object, not the row.
DO $$ BEGIN
  BEGIN
    INSERT INTO files (organization_id, name, original_name, storage_path, uploaded_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'path-escape', 'path-escape',
            'bbbbbbbb-0000-4000-a000-000000000002/files/z/path-escape', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL metadata pointing at another org accepted';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('path/org mismatch refused', (SELECT count(*)::int FROM files WHERE name = 'path-escape'), 0);

-- The honest path.
INSERT INTO files (id, organization_id, name, original_name, storage_path, mime_type, size_bytes, uploaded_by)
VALUES ('f0000000-0000-4000-a000-00000000000c', 'aaaaaaaa-0000-4000-a000-000000000001',
        'mine.txt', 'mine.txt',
        'aaaaaaaa-0000-4000-a000-000000000001/files/f0000000-0000-4000-a000-00000000000c/mine.txt',
        'text/plain', 12, 'a0000000-0000-4000-a000-00000000000b');
SELECT pg_temp.ok('member uploads into own org', (SELECT count(*)::int FROM files WHERE name = 'mine.txt'), 1);

-- ═══ RENAME ════════════════════════════════════════════════════════════════

UPDATE files SET name = 'renamed.txt' WHERE id = 'f0000000-0000-4000-a000-00000000000c';
SELECT pg_temp.ok('uploader renames own file', (SELECT name FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000c'), 'renamed.txt');

-- The admin may touch the row (archive) but the trigger forces `name` back.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000a';
UPDATE files SET name = 'admin-renamed.txt' WHERE id = 'f0000000-0000-4000-a000-00000000000c';
SELECT pg_temp.ok('org admin CANNOT rename another member file',
  (SELECT name FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000c'), 'renamed.txt');

-- A plain member of the same org has no authority over someone else's file.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';
INSERT INTO files (id, organization_id, name, original_name, storage_path, uploaded_by)
VALUES ('f0000000-0000-4000-a000-00000000000d', 'aaaaaaaa-0000-4000-a000-000000000001',
        'admins.txt', 'admins.txt',
        'aaaaaaaa-0000-4000-a000-000000000001/files/f0000000-0000-4000-a000-00000000000d/admins.txt',
        'a0000000-0000-4000-a000-00000000000b');
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000a';
UPDATE files SET name = 'nope.txt' WHERE id = 'f0000000-0000-4000-a000-00000000000d';
SELECT pg_temp.ok('admin rename of member file is a no-op',
  (SELECT name FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000d'), 'admins.txt');

-- ═══ ARCHIVE ═══════════════════════════════════════════════════════════════

-- Uploader archives their own. This is the case that caught the SELECT
-- policy: Postgres applies it to the row the UPDATE produces, so hiding
-- archived rows from their own uploader made archiving impossible.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';
UPDATE files SET deleted_at = now() WHERE id = 'f0000000-0000-4000-a000-00000000000c';
SELECT pg_temp.ok('uploader can archive own file',
  (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000c' AND deleted_at IS NOT NULL), 1);

-- Hidden from everyone else in the org, which is what archive means.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000e';
SELECT pg_temp.ok('archived file hidden from other members',
  (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000c'), 0);
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';

-- The approved override: an admin archives another member's file.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000a';
UPDATE files SET deleted_at = now() WHERE id = 'f0000000-0000-4000-a000-00000000000d';
SELECT pg_temp.ok('org admin archives another member file',
  (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000d' AND deleted_at IS NOT NULL), 1);

-- And the admin still sees archived rows, which is how a restore is possible.
SELECT pg_temp.ok('org admin sees archived rows',
  (SELECT count(*)::int FROM files WHERE deleted_at IS NOT NULL), 2);

-- An ordinary member who uploaded neither sees neither.
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000e';
SELECT pg_temp.ok('other member sees no archived rows',
  (SELECT count(*)::int FROM files WHERE deleted_at IS NOT NULL), 0);
SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000a';

-- An admin of org B has no reach into org A.
SET request.jwt.claim.sub = 'b0000000-0000-4000-a000-00000000000d';
UPDATE files SET deleted_at = now() WHERE id = 'f0000000-0000-4000-a000-00000000000a';
SELECT ROLE_RESET FROM (SELECT 1 AS ROLE_RESET) t;
RESET ROLE;
SELECT pg_temp.ok('org B cannot archive an org A file',
  (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000a' AND deleted_at IS NULL), 1);
SET ROLE authenticated;

-- ═══ HARD DELETE IS NOT AVAILABLE ══════════════════════════════════════════

SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';
DO $$ BEGIN
  BEGIN
    DELETE FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000a';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.ok('no physical delete in V1',
  (SELECT count(*)::int FROM files WHERE id = 'f0000000-0000-4000-a000-00000000000a'), 1);
SET ROLE authenticated;

-- ═══ FILE LINKS ════════════════════════════════════════════════════════════

SET request.jwt.claim.sub = 'a0000000-0000-4000-a000-00000000000b';

INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000a',
        'project', 'dddddddd-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-00000000000b');
SELECT pg_temp.ok('link to own-org project', (SELECT count(*)::int FROM file_links), 1);

-- An asset is global and carries no tenant, so this is valid from any org.
INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000a',
        'asset', 'cccccccc-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b');
SELECT pg_temp.ok('link to global asset', (SELECT count(*)::int FROM file_links WHERE target_type = 'asset'), 1);

-- Duplicate.
DO $$ BEGIN
  BEGIN
    INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000a',
            'asset', 'cccccccc-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL duplicate link accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('duplicate link refused', (SELECT count(*)::int FROM file_links WHERE target_type = 'asset'), 1);

-- Org B's project, from org A. This is the cross-tenant link.
DO $$ BEGIN
  BEGIN
    INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000a',
            'project', 'dddddddd-0000-4000-a000-00000000000b', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL cross-org project link accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('cross-org project link refused',
  (SELECT count(*)::int FROM file_links WHERE target_id = 'dddddddd-0000-4000-a000-00000000000b'), 0);

-- A file belonging to another org.
DO $$ BEGIN
  BEGIN
    INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000b',
            'asset', 'cccccccc-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL link to another org file accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('link to another org file refused',
  (SELECT count(*)::int FROM file_links WHERE file_id = 'f0000000-0000-4000-a000-00000000000b'), 0);

-- Unknown target type.
DO $$ BEGIN
  BEGIN
    INSERT INTO file_links (organization_id, file_id, target_type, target_id, created_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'f0000000-0000-4000-a000-00000000000a',
            'research', 'cccccccc-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-00000000000b');
    RAISE EXCEPTION 'FAIL unknown target type accepted';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('deferred target type refused',
  (SELECT count(*)::int FROM file_links WHERE target_type = 'research'), 0);

-- Org B cannot see org A's links.
SET request.jwt.claim.sub = 'b0000000-0000-4000-a000-00000000000d';
SELECT pg_temp.ok('B cannot read A links', (SELECT count(*)::int FROM file_links), 0);

RESET ROLE;
RESET request.jwt.claim.sub;
