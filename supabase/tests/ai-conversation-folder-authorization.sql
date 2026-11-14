-- Can a conversation be filed on somebody else's shelf?
--
-- ============================================================================
-- STATUS: AUTHORED, NEVER EXECUTED.
--
-- This suite has not run against a database. The Management API connection
-- available to the agent that wrote it is read-only and refuses DDL and DML
-- with 25006, so fixtures cannot be created from it. Nothing below may be
-- described as proven until it has been run and until the two deliberate
-- breakages at the bottom have been seen to fail.
-- ============================================================================
--
-- ── What is being tested, and what was already true ────────────────────────
--
-- The guard is `ai_conversations_folder_own`, a BEFORE INSERT OR UPDATE OF
-- folder_id trigger calling the definer function
-- `ai_conversation_folder_must_be_own()`. It has been in production since
-- 20261112120000_ai_project_folders.sql. The 2.4 report claimed this check
-- did not exist; that claim was wrong, and this suite is partly here to stop
-- the question being re-answered from the policy list alone -- the two
-- policies on `ai_conversations` really do check only `user_id = auth.uid()`,
-- which is why the trigger is the control and why reading the policies and
-- stopping was a plausible mistake to make.
--
-- 20261114120000_ai_conversation_folder_org_boundary.sql adds the one
-- condition the trigger was missing: that the owner is still a member of the
-- organisation the folder is scoped to. Assertions 9 and 10 cover that and
-- will FAIL against a database on which only the first migration is applied.
-- That is the point of them, and it is how to tell which of the two
-- migrations a given environment has.
--
-- ── Why BEGIN/ROLLBACK and not a fixture teardown ──────────────────────────
--
-- `auth.users` has 196 unindexed inbound foreign keys in this database, which
-- makes deleting a test user take about 75 seconds. A suite that created and
-- dropped users would spend its time in cascade planning. Everything here
-- happens inside one transaction that is rolled back, so the database is
-- untouched whether the suite passes or fails.
--
-- ── How the caller is impersonated ─────────────────────────────────────────
--
-- `auth.uid()` reads the `request.jwt.claims` GUC, so setting that GUC and
-- the role is what makes a statement run "as" a reader. Both the trigger and
-- `is_member_of_org` resolve through it, which is the whole mechanism under
-- test -- so a suite that forgot to set the role would run as a superuser,
-- bypass RLS, and pass while proving nothing.

BEGIN;

SET LOCAL client_min_messages = warning;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--
-- Two readers in one firm, plus a third firm nobody below is a member of.
-- Deterministic uuids so a failure message names a row a reader can find.

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'folder-owner@test.invalid', '', now(), now(), now(), '{}', '{}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'folder-stranger@test.invalid', '', now(), now(), now(), '{}', '{}');

-- `slug` is NOT NULL with no default, so it is supplied. Checked against the
-- live table rather than assumed; an omitted column here would have made the
-- whole suite abort on its first statement and look like a guard failure.
INSERT INTO public.organizations (id, name, slug)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Folder Test Firm', 'folder-test-firm'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Firm Nobody Is In', 'firm-nobody-is-in');

-- Both readers are members of firm 1. Neither is a member of firm 2.
--
-- `organization_memberships`, NOT `organization_members` -- the latter does
-- not exist in this database. The table name is taken from the body of
-- `is_member_of_org`, which is the function under test here, so the fixture
-- and the predicate cannot disagree about where membership lives.
--
-- `status` is defaulted to 'active' and is written anyway: the predicate
-- reads `coalesce(m.status, 'active') = 'active'`, and a fixture that relied
-- on the default would be testing the default rather than the membership.
INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'member', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'member', 'active');

INSERT INTO public.ai_project_folders (id, user_id, organization_id, name)
VALUES
  -- The owner's own shelf, in a firm they belong to. The legitimate target.
  ('cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Mine'),
  -- The stranger's shelf, same firm. Must be unreachable.
  ('cccccccc-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Theirs'),
  -- The owner's own shelf, in a firm they are NOT a member of. This is the
  -- gap the 2.4 migration closes: theirs, and unreadable to them.
  ('cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Mine, elsewhere');

INSERT INTO public.ai_conversations (id, user_id, title)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Owner thread'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Stranger thread');

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.be(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.be_nobody() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Did this statement fail, and with which SQLSTATE? Returns the code, or
-- 'OK' when it succeeded. Used instead of bare EXCEPTION blocks so a test
-- can assert on the code rather than merely on "something went wrong" --
-- a 42501 and a 23503 mean very different things here.
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_label text, p_got text, p_want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL %: expected % got %', p_label, p_want, p_got;
  END IF;
  RAISE WARNING 'pass %', p_label;
END $$;

-- ── 1-2. The control exists at all ─────────────────────────────────────────
--
-- Asserted before anything is exercised, because every refusal below would
-- also be produced by a database with no trigger and a coincidence. These
-- two are what tell "the guard refused" from "the write happened to fail".

SELECT pg_temp.ok('1 trigger is installed',
  (SELECT count(*)::text FROM pg_trigger
    WHERE tgrelid = 'public.ai_conversations'::regclass
      AND tgname = 'ai_conversations_folder_own'
      AND NOT tgisinternal), '1');

SELECT pg_temp.ok('2 guard runs as definer with a pinned search_path',
  (SELECT (p.prosecdef AND p.proconfig::text LIKE '%search_path%')::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ai_conversation_folder_must_be_own'), 'true');

-- ── 3. ...and is not callable by a reader ──────────────────────────────────
--
-- A trigger function fires regardless of EXECUTE, so granting it buys
-- nothing and costs a directly-callable privileged function. Every public
-- function in this database is born anon-executable, so this is a real
-- check and not a formality.

SELECT pg_temp.ok('3 guard is not executable by anon or authenticated',
  (SELECT (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ai_conversation_folder_must_be_own'), 'false');

-- ── 4-5. The legitimate path works ─────────────────────────────────────────
--
-- First, because a guard that refuses everything passes every negative test
-- in this file. If 4 fails, nothing below means anything.

SELECT pg_temp.be('aaaaaaaa-0000-0000-0000-000000000001');

SELECT pg_temp.ok('4 owner files their own thread on their own shelf',
  pg_temp.try($q$
    UPDATE public.ai_conversations
       SET folder_id = 'cccccccc-0000-0000-0000-000000000001'
     WHERE id = 'dddddddd-0000-0000-0000-000000000001'
  $q$), 'OK');

SELECT pg_temp.ok('5 and the row really moved',
  (SELECT folder_id::text FROM public.ai_conversations
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000001');

-- ── 6. Unfiling is always allowed ──────────────────────────────────────────
--
-- The guard returns early on NULL. Worth asserting: a guard that checked
-- NULL against the folder table would make "take it off the shelf"
-- impossible, and the menu offers exactly that.

SELECT pg_temp.ok('6 unfiling is not refused',
  pg_temp.try($q$
    UPDATE public.ai_conversations SET folder_id = NULL
     WHERE id = 'dddddddd-0000-0000-0000-000000000001'
  $q$), 'OK');

-- ── 7. THE one. A stranger's shelf is refused ──────────────────────────────

SELECT pg_temp.ok('7 a stranger''s folder is refused with 42501',
  pg_temp.try($q$
    UPDATE public.ai_conversations
       SET folder_id = 'cccccccc-0000-0000-0000-000000000002'
     WHERE id = 'dddddddd-0000-0000-0000-000000000001'
  $q$), '42501');

SELECT pg_temp.ok('7b and the row did not move',
  (SELECT coalesce(folder_id::text, 'null') FROM public.ai_conversations
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'), 'null');

-- ── 8. A folder that does not exist is refused THE SAME WAY ────────────────
--
-- The indistinguishability requirement, and the only assertion in this file
-- that is about an absence of information rather than an absence of access.
-- If this returned 23503 (foreign_key_violation) instead, the control would
-- be an oracle: a reader could learn whether any uuid is a real folder from
-- which error they got back. The BEFORE trigger runs ahead of the FK, which
-- is what keeps the two answers identical.

SELECT pg_temp.ok('8 a nonexistent folder is refused identically',
  pg_temp.try($q$
    UPDATE public.ai_conversations
       SET folder_id = 'cccccccc-0000-0000-0000-00000000dead'
     WHERE id = 'dddddddd-0000-0000-0000-000000000001'
  $q$), '42501');

-- ── 9-10. The organisation boundary ────────────────────────────────────────
--
-- These two require 20261114120000_ai_conversation_folder_org_boundary.sql.
-- Against a database carrying only the first migration they will FAIL with
-- 'OK' where '42501' was wanted, and that failure is informative rather than
-- a bug in the suite: it is how to tell which migration an environment has.
--
-- The folder in 9 is the reader's OWN, in a firm they are not a member of.
-- Before the second migration the trigger's definer read reached it; after,
-- it does not, because `is_member_of_org` is false for that organisation.

SELECT pg_temp.ok('9 own folder in a firm the reader has left is refused',
  pg_temp.try($q$
    UPDATE public.ai_conversations
       SET folder_id = 'cccccccc-0000-0000-0000-000000000003'
     WHERE id = 'dddddddd-0000-0000-0000-000000000001'
  $q$), '42501');

SELECT pg_temp.ok('10 and that refusal is the same 42501, not a new code',
  (SELECT coalesce(folder_id::text, 'null') FROM public.ai_conversations
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'), 'null');

-- ── 11-12. The conversation's own boundary is independent of the folder's ──
--
-- The trigger is not the only control. A reader must not be able to move
-- somebody ELSE's thread, even onto a shelf of their own, and that refusal
-- comes from the policy rather than from the trigger. 11 asserts the write
-- affects nothing (a policy refusal on UPDATE is silent -- zero rows -- not
-- an error), and 12 asserts the row is untouched.

SELECT pg_temp.ok('11 moving another reader''s thread raises nothing',
  pg_temp.try($q$
    UPDATE public.ai_conversations
       SET folder_id = 'cccccccc-0000-0000-0000-000000000001'
     WHERE id = 'dddddddd-0000-0000-0000-000000000002'
  $q$), 'OK');

SELECT pg_temp.be_nobody();

SELECT pg_temp.ok('12 ...and changed nothing, because RLS matched no row',
  (SELECT coalesce(folder_id::text, 'null') FROM public.ai_conversations
    WHERE id = 'dddddddd-0000-0000-0000-000000000002'), 'null');

-- ── 13. An INSERT is guarded as well as an UPDATE ──────────────────────────
--
-- The trigger is `BEFORE INSERT OR UPDATE OF folder_id`, and the client has
-- an insert path that carries a folder: "New conversation in this project"
-- holds the folder until the first answer writes the row. A guard that
-- covered only UPDATE would leave the only path a reader actually uses to
-- create a filed thread unprotected.

SELECT pg_temp.be('aaaaaaaa-0000-0000-0000-000000000001');

SELECT pg_temp.ok('13 inserting a thread onto a stranger''s shelf is refused',
  pg_temp.try($q$
    INSERT INTO public.ai_conversations (id, user_id, title, folder_id)
    VALUES ('dddddddd-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001', 'New in theirs',
            'cccccccc-0000-0000-0000-000000000002')
  $q$), '42501');

SELECT pg_temp.ok('14 inserting onto their own shelf is allowed',
  pg_temp.try($q$
    INSERT INTO public.ai_conversations (id, user_id, title, folder_id)
    VALUES ('dddddddd-0000-0000-0000-000000000004',
            'aaaaaaaa-0000-0000-0000-000000000001', 'New in mine',
            'cccccccc-0000-0000-0000-000000000001')
  $q$), 'OK');

-- ── 15. The folder list itself is private ──────────────────────────────────
--
-- Not strictly about `folder_id`, and included because assertion 7 would
-- pass on a database where folders were readable firm-wide, and the two
-- together are what make "private shelf" true.

SELECT pg_temp.be('aaaaaaaa-0000-0000-0000-000000000002');

SELECT pg_temp.ok('15 a reader cannot see another reader''s folders',
  (SELECT count(*)::text FROM public.ai_project_folders
    WHERE id = 'cccccccc-0000-0000-0000-000000000001'), '0');

SELECT pg_temp.be_nobody();

ROLLBACK;

-- ============================================================================
-- DELIBERATE BREAKAGES -- run these, or this file is decoration.
--
-- A suite nobody has watched fail is an assertion about itself. Each of these
-- must produce the failures named, and no others.
--
-- INJECTION 1 -- remove the guard entirely.
--
--   DROP TRIGGER ai_conversations_folder_own ON public.ai_conversations;
--
--   Expect: 1 fails (the trigger is not installed). 7, 8, 9 and 13 fail with
--   'OK' where '42501' was wanted, and 7b and 10 fail because the row moved.
--   Expect 4, 5, 6, 11, 12, 14 and 15 to still PASS -- which is the real
--   lesson of this injection: the legitimate path and the conversation's own
--   policy are untouched by removing the folder guard, so a suite built only
--   from those would have reported green on a database with no guard at all.
--
-- INJECTION 2 -- drop the organisation condition, i.e. revert to the
-- pre-2.4 function body.
--
--   CREATE OR REPLACE FUNCTION public.ai_conversation_folder_must_be_own()
--   ... AND f.user_id = NEW.user_id            -- and nothing else
--
--   Expect: exactly 9 and 10 fail. Everything else passes. If 7 or 8 also
--   fails, the two conditions have been conflated and the ownership check
--   has been weakened rather than the membership one removed.
--
-- INJECTION 3 -- make the refusals distinguishable, which is the subtlest of
-- the three and the one a reviewer is most likely to wave through.
--
--   Split the single EXISTS into two: first check the folder exists at all
--   and raise 'no such folder' (or simply let the FK handle it by returning
--   NEW), then check ownership and raise 42501.
--
--   Expect: 8 fails -- it will get 23503 or a different message instead of
--   42501 -- while 7 still passes. That is the signature of an oracle: access
--   is still correctly denied, and the denial has started leaking whether the
--   id was real.
-- ============================================================================
