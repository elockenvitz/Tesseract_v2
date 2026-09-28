-- The ops client-detail RPCs: attribution and authorization.
--
-- Written as "what does the operator actually get back", not "did it
-- raise" — the bug being fixed returned HTTP 200 with a wrong number, so a
-- test that only checks for absence of error would have passed against it.

\set ON_ERROR_STOP on
SET client_min_messages TO NOTICE;

-- ── Fixture ────────────────────────────────────────────────────────────────
--
--   Tesseract  the operator's own org — the current_org_id() in the report
--   Raven      the pilot being viewed, one portfolio, no activity
--   admin      platform admin, a member of BOTH, active in both
--   member     ordinary user, not a platform admin

INSERT INTO organizations (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tesseract'),
  ('22222222-2222-2222-2222-222222222222', 'Raven Capital');

INSERT INTO users (id, email, current_organization_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@tesseract.test',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member@raven.test',
   '22222222-2222-2222-2222-222222222222');

INSERT INTO organization_memberships (user_id, organization_id, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'active');

INSERT INTO platform_admins (user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Raven's autoloaded pilot portfolio. The reported symptom was this reading
-- as zero while the operator sat in Tesseract.
INSERT INTO portfolios (organization_id, name, is_active) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Pilot Model Portfolio', true);
INSERT INTO portfolios (organization_id, name, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tesseract Internal', true);

-- The note that started this: authored by the admin, attributed to NO org,
-- created before Raven existed.
INSERT INTO asset_notes (organization_id, created_by, title) VALUES
  (NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Testing');

-- The same person active in both orgs.
INSERT INTO asset_notes (organization_id, created_by, title) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tesseract note'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Raven note A'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Raven note B');

INSERT INTO analyst_ratings (organization_id, user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  (NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO quick_thoughts (organization_id, created_by, idea_type, is_archived) VALUES
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'note', false),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'trade_idea', false),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'note', true),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'note', false),
  (NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'note', false);

INSERT INTO user_sessions (organization_id, user_id, duration_seconds) VALUES
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 100),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 200),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 9999),
  (NULL, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 5000);

-- ── Act as the platform admin, whose CURRENT org is Tesseract ──────────────
--
-- Plain SET, not SET LOCAL: psql runs in autocommit, so SET LOCAL outside an
-- explicit transaction is a no-op that only warns. It left auth.uid() NULL,
-- which made is_platform_admin() false and the whole suite meaningless.
SET ROLE authenticated;
SET "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $t$
DECLARE r record; v_cur uuid;
BEGIN
  -- IS DISTINCT FROM, not <>. With a NULL auth.uid() this SELECT returns no
  -- row, v_cur stays NULL, and `NULL <> 'x'` is NULL — so the IF would not
  -- fire and the check would "pass" having asserted nothing. That is exactly
  -- how the first run of this suite reported PASS against a broken fixture.
  SELECT current_organization_id INTO v_cur FROM users WHERE id = auth.uid();
  IF v_cur IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'FAIL fixture: operator current org is %, expected Tesseract',
      coalesce(v_cur::text, 'NULL (auth.uid() not set)');
  END IF;
  RAISE NOTICE 'PASS  operator current org is Tesseract, viewing Raven';

  SELECT * INTO r FROM ops_client_engagement('22222222-2222-2222-2222-222222222222', NULL);

  -- CROSS-ORG ADMIN: the reported symptom.
  IF r.portfolio_count <> 1 THEN
    RAISE EXCEPTION 'FAIL portfolio count: expected 1, got %', r.portfolio_count;
  END IF;
  RAISE NOTICE 'PASS  Raven portfolio counted as 1 while operator sits in Tesseract';

  -- UNATTRIBUTED NOTE + SAME PERSON TWO ORGS: Raven has exactly 2 notes.
  -- The NULL-org "Testing" note and the Tesseract note must both be absent.
  IF r.notes <> 2 THEN
    RAISE EXCEPTION 'FAIL notes: expected 2 (Raven only), got %', r.notes;
  END IF;
  RAISE NOTICE 'PASS  notes counted 2 - unattributed and other-org notes excluded';

  IF r.ratings <> 1 THEN
    RAISE EXCEPTION 'FAIL ratings: expected 1, got %', r.ratings;
  END IF;
  RAISE NOTICE 'PASS  ratings exclude the NULL-org row';

  -- ideas: Raven, unarchived, any type -> 2 of the 3 Raven thoughts.
  IF r.ideas <> 2 THEN
    RAISE EXCEPTION 'FAIL ideas: expected 2, got %', r.ideas;
  END IF;
  IF r.trade_ideas <> 1 THEN
    RAISE EXCEPTION 'FAIL trade_ideas: expected 1, got %', r.trade_ideas;
  END IF;
  RAISE NOTICE 'PASS  quick thoughts attributed by row org, not by member id';

  IF r.sessions <> 2 OR r.avg_duration_seconds <> 150 THEN
    RAISE EXCEPTION 'FAIL sessions: expected 2 / avg 150, got % / %',
      r.sessions, r.avg_duration_seconds;
  END IF;
  RAISE NOTICE 'PASS  sessions and average exclude the other org and the NULL org';
END;
$t$;

-- ── CURRENT ORG INDEPENDENCE ───────────────────────────────────────────────
-- Move the operator into Raven and assert nothing about the report changes.
RESET ROLE;
UPDATE users SET current_organization_id = '22222222-2222-2222-2222-222222222222'
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET ROLE authenticated;
SET "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $t$
DECLARE a record; b record;
BEGIN
  SELECT * INTO a FROM ops_client_engagement('22222222-2222-2222-2222-222222222222', NULL);
  IF a.notes <> 2 OR a.portfolio_count <> 1 THEN
    RAISE EXCEPTION 'FAIL current-org independence: Raven view changed to %/%',
      a.notes, a.portfolio_count;
  END IF;
  RAISE NOTICE 'PASS  viewed-org metrics are identical whichever org the operator is in';

  -- And viewing the OTHER org from here returns that org's numbers, not these.
  SELECT * INTO b FROM ops_client_engagement('11111111-1111-1111-1111-111111111111', NULL);
  IF b.notes <> 1 OR b.portfolio_count <> 1 OR b.sessions <> 1 THEN
    RAISE EXCEPTION 'FAIL org A view: expected 1/1/1, got %/%/%',
      b.notes, b.portfolio_count, b.sessions;
  END IF;
  RAISE NOTICE 'PASS  viewing org A returns org A activity only';
END;
$t$;

-- ── Minimal portfolio metadata ─────────────────────────────────────────────
DO $t$
DECLARE n int; nm text;
BEGIN
  SELECT count(*) INTO n FROM ops_client_portfolios('22222222-2222-2222-2222-222222222222');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL portfolio rows: expected 1, got %', n; END IF;

  SELECT name INTO nm FROM ops_client_portfolios('22222222-2222-2222-2222-222222222222');
  IF nm <> 'Pilot Model Portfolio' THEN
    RAISE EXCEPTION 'FAIL portfolio name: got %', nm;
  END IF;
  RAISE NOTICE 'PASS  Raven portfolio returned by name across orgs';
END;
$t$;

-- ── NON-ADMIN IS DENIED ────────────────────────────────────────────────────
RESET ROLE;
SET ROLE authenticated;
SET "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

DO $t$
DECLARE r record;
BEGIN
  BEGIN
    SELECT * INTO r FROM ops_client_engagement('22222222-2222-2222-2222-222222222222', NULL);
    RAISE EXCEPTION 'FAIL non-admin was allowed to read engagement';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%Platform admin required%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  non-admin refused engagement, and told why';
  END;

  BEGIN
    PERFORM * FROM ops_client_portfolios('22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'FAIL non-admin was allowed to read portfolios';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%Platform admin required%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  non-admin refused portfolios';
  END;
END;
$t$;

-- ── A NULL org is refused, not silently zeroed ─────────────────────────────
RESET ROLE;
SET ROLE authenticated;
SET "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $t$
DECLARE r record;
BEGIN
  BEGIN
    SELECT * INTO r FROM ops_client_engagement(NULL, NULL);
    RAISE EXCEPTION 'FAIL null org returned a row instead of raising';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%p_org_id is required%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  a NULL org raises rather than reporting an inactive client';
  END;
END;
$t$;

-- ── Grants ─────────────────────────────────────────────────────────────────
RESET ROLE;
DO $t$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('ops_client_engagement','ops_client_portfolios')
    AND (array_to_string(p.proacl,',') LIKE '=X/%' OR array_to_string(p.proacl,',') LIKE '%anon=X%');
  IF v > 0 THEN RAISE EXCEPTION 'FAIL % function(s) grant EXECUTE to PUBLIC or anon', v; END IF;
  RAISE NOTICE 'PASS  no PUBLIC or anon EXECUTE on either function';

  SELECT count(*) INTO v FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('ops_client_engagement','ops_client_portfolios')
    AND p.prosecdef AND 'search_path=public' = ANY(p.proconfig);
  IF v <> 2 THEN RAISE EXCEPTION 'FAIL expected 2 SECURITY DEFINER + pinned search_path, got %', v; END IF;
  RAISE NOTICE 'PASS  both are SECURITY DEFINER with a pinned search_path';
END;
$t$;
