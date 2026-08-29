-- =============================================================================
-- 07 — synthetic behavioural proof, STAGING ONLY.
--
-- Runs against a staging database that already has 07 applied. It proves the
-- fix by exploiting the defect first: the pre-07 function body (read verbatim
-- from production, md5 e66e67c628d5) is reinstalled inside this transaction,
-- the cross-tenant write is performed and shown to SUCCEED, and only then is
-- the fixed body restored and the same write shown to be REFUSED. A test that
-- only demonstrates the "after" state cannot distinguish a working guard from
-- a fixture that never reached the guard at all.
--
-- Everything is one transaction and nothing is kept: the suite ends in a
-- deliberate RAISE, which rolls back the fixtures, both function swaps and
-- every test row. The assertion table is carried out in the exception message
-- because a committed result set would defeat the rollback.
--
-- Staging has zero messages and zero portfolios of its own, so no fixture here
-- can collide with, or be contaminated by, real data.
-- =============================================================================

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Two organizations, one user who is an active member of org A only. Org B is
-- the foreign tenant. Portfolios: a team-less one in each org (the shape that
-- production has 33 of, and the shape the defect turns on) and a team-bearing
-- one in org A (the shape that resolved correctly even before 07).

INSERT INTO public.organizations (id, name, slug) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'C1 Fixture Org A', 'c1-fixture-org-a'),
  ('b0000000-0000-4000-8000-000000000002', 'C1 Fixture Org B', 'c1-fixture-org-b');

-- public.users.id is FK'd to auth.users, so the identity has to exist there
-- first. Only the three NOT NULL columns are set; this is a fixture identity
-- with no credentials, and it is rolled back with everything else.
INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES
  ('11111111-0000-4000-8000-000000000001', false, false);

-- Upsert, not insert: a trigger on auth.users provisions the public.users row
-- automatically, so the row already exists by the time we get here. What this
-- fixture actually needs to set is current_organization_id, which is the only
-- input to current_org_id().
INSERT INTO public.users (id, current_organization_id) VALUES
  ('11111111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET current_organization_id = EXCLUDED.current_organization_id;

INSERT INTO public.organization_memberships (organization_id, user_id, status) VALUES
  ('a0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'active');

INSERT INTO public.teams (id, organization_id, name, slug) VALUES
  ('7ea11111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'C1 Fixture Team A', 'c1-fixture-team-a');

INSERT INTO public.portfolios (id, name, organization_id, team_id) VALUES
  -- team_id NULL: the production-majority shape the INNER JOIN could not resolve
  ('9f000000-0000-4000-8000-00000000000a', 'C1 Fixture Portfolio A (team-less)', 'a0000000-0000-4000-8000-000000000001', NULL),
  ('9f000000-0000-4000-8000-00000000000b', 'C1 Fixture Portfolio B (team-less, FOREIGN)', 'b0000000-0000-4000-8000-000000000002', NULL),
  ('9f000000-0000-4000-8000-00000000000c', 'C1 Fixture Portfolio A (with team)', 'a0000000-0000-4000-8000-000000000001', '7ea11111-0000-4000-8000-000000000001');

CREATE TEMP TABLE c1_results (seq int, phase text, test text, expected text, actual text, pass boolean);
CREATE TEMP TABLE c1_saved_fn (def text);
-- The assertions are recorded while the session is standing as `authenticated`
-- or `service_role`, neither of which otherwise owns or reaches a
-- postgres-created temp table.
GRANT ALL ON c1_results, c1_saved_fn TO authenticated, service_role;
INSERT INTO c1_saved_fn SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'messages_set_organization_id';

-- ── Reinstall the pre-07 body, verbatim from production ─────────────────────
CREATE OR REPLACE FUNCTION public.messages_set_organization_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ctx uuid;
BEGIN
  SELECT CASE NEW.context_type
    WHEN 'theme'     THEN (SELECT t.organization_id FROM themes t WHERE t.id = NEW.context_id)
    WHEN 'portfolio' THEN (SELECT tm.organization_id FROM portfolios p
                             JOIN teams tm ON tm.id = p.team_id WHERE p.id = NEW.context_id)
    WHEN 'workflow'  THEN (SELECT w.organization_id FROM workflows w WHERE w.id = NEW.context_id)
    WHEN 'quick_thought' THEN (SELECT q.organization_id FROM quick_thoughts q WHERE q.id = NEW.context_id)
    WHEN 'trade_idea' THEN COALESCE(
        (SELECT COALESCE(p.organization_id, tm.organization_id)
           FROM trade_queue_items tq
           JOIN portfolios p ON p.id = tq.portfolio_id
           LEFT JOIN teams tm ON tm.id = p.team_id
          WHERE tq.id = NEW.context_id),
        (SELECT COALESCE(p.organization_id, tm.organization_id)
           FROM pair_trades pt
           JOIN portfolios p ON p.id = pt.portfolio_id
           LEFT JOIN teams tm ON tm.id = p.team_id
          WHERE pt.id = NEW.context_id))
    ELSE NULL
  END INTO v_ctx;

  NEW.organization_id := COALESCE(v_ctx, public.current_org_id());

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'messages: no organization could be derived for context %/%',
      NEW.context_type, NEW.context_id;
  END IF;

  IF v_ctx IS NOT NULL AND v_ctx IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'messages: context %/% belongs to another organization',
      NEW.context_type, NEW.context_id;
  END IF;

  RETURN NEW;
END $function$;

-- ── BEFORE: the exploit, under the pre-07 body ──────────────────────────────
DO $before$
DECLARE landed uuid;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated"}', true);

  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('c1 exploit probe', '11111111-0000-4000-8000-000000000001',
            'portfolio', '9f000000-0000-4000-8000-00000000000b')
    RETURNING organization_id INTO landed;

    -- Stamped with the CALLER's org while pointing at org B's portfolio.
    INSERT INTO c1_results VALUES (0, 'BEFORE',
      'cross-tenant write to foreign team-less portfolio',
      'EXPLOITABLE: row stored as caller org A',
      CASE WHEN landed = 'a0000000-0000-4000-8000-000000000001'
           THEN 'EXPLOITED — stored as org A' ELSE 'stored as ' || landed::text END,
      landed = 'a0000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (0, 'BEFORE',
      'cross-tenant write to foreign team-less portfolio',
      'EXPLOITABLE: row stored as caller org A',
      'unexpectedly refused: ' || SQLERRM, false);
  END;

  -- The T6 orphan has to be born here, under the pre-07 body, because the
  -- fixed body refuses to create one — which is the whole point of the guard.
  -- This is also how production's 4 orphaned trade_idea messages actually came
  -- to exist: written when the trigger still stamped the caller's org, and only
  -- later left parentless. Creating it as `authenticated` is what gives
  -- current_org_id() a value for the old body to fall back to.
  INSERT INTO public.messages (content, user_id, context_type, context_id)
  VALUES ('t6-orphan', '11111111-0000-4000-8000-000000000001',
          'trade_idea', '00000000-0000-4000-8000-0000000000bb');

  PERFORM set_config('role', 'postgres', true);
END $before$;

DELETE FROM public.messages WHERE content = 'c1 exploit probe';

-- ── Restore the 07 body and re-run every branch ─────────────────────────────
DO $restore$
BEGIN EXECUTE (SELECT def FROM c1_saved_fn); END $restore$;

DO $after$
DECLARE
  org_a  CONSTANT uuid := 'a0000000-0000-4000-8000-000000000001';
  pf_a   CONSTANT uuid := '9f000000-0000-4000-8000-00000000000a';
  pf_b   CONSTANT uuid := '9f000000-0000-4000-8000-00000000000b';
  pf_at  CONSTANT uuid := '9f000000-0000-4000-8000-00000000000c';
  usr    CONSTANT uuid := '11111111-0000-4000-8000-000000000001';
  landed uuid;
  orphan uuid;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- T1 — the same defect shape, but in the caller's own org. Must still work:
  -- this is the regression the LEFT JOIN exists to prevent.
  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('t1', usr, 'portfolio', pf_a) RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (1, 'AFTER', 'same-org team-less portfolio INSERT',
      'accepted, org = A (derived from portfolio, not caller)',
      'accepted, org = ' || CASE WHEN landed = org_a THEN 'A' ELSE landed::text END, landed = org_a);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (1, 'AFTER', 'same-org team-less portfolio INSERT',
      'accepted, org = A (derived from portfolio, not caller)', 'REFUSED: ' || SQLERRM, false);
  END;

  -- T2 — the exploit from the BEFORE phase, now under the fixed body.
  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('t2', usr, 'portfolio', pf_b) RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (2, 'AFTER', 'foreign-org team-less portfolio INSERT',
      'REFUSED', 'ACCEPTED as org ' || landed::text || ' — STILL EXPLOITABLE', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (2, 'AFTER', 'foreign-org team-less portfolio INSERT',
      'REFUSED', 'refused: ' || left(SQLERRM, 60), true);
  END;

  -- T3 — the branch that resolved correctly before 07 must be unchanged.
  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('t3', usr, 'portfolio', pf_at) RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (3, 'AFTER', 'same-org portfolio WITH team INSERT',
      'accepted, org = A', 'accepted, org = ' || CASE WHEN landed = org_a THEN 'A' ELSE landed::text END,
      landed = org_a);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (3, 'AFTER', 'same-org portfolio WITH team INSERT',
      'accepted, org = A', 'REFUSED: ' || SQLERRM, false);
  END;

  -- T4 — owner-bearing context that does not resolve at all. Before 07 this
  -- silently became the caller's org; it must now refuse.
  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('t4', usr, 'portfolio', '00000000-0000-4000-8000-0000000000ff')
    RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (4, 'AFTER', 'nonexistent portfolio INSERT',
      'REFUSED', 'ACCEPTED as org ' || landed::text || ' — fell back to caller', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (4, 'AFTER', 'nonexistent portfolio INSERT',
      'REFUSED', 'refused: ' || left(SQLERRM, 60), true);
  END;

  -- T5 — a genuinely tenant-less context type must STILL fall back to the
  -- caller's org. 07 must not turn every unresolved context into an error.
  BEGIN
    INSERT INTO public.messages (content, user_id, context_type, context_id)
    VALUES ('t5', usr, 'asset', '00000000-0000-4000-8000-0000000000aa')
    RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (5, 'AFTER', 'global context type (asset) INSERT',
      'accepted, falls back to caller org A',
      'accepted, org = ' || CASE WHEN landed = org_a THEN 'A' ELSE landed::text END, landed = org_a);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (5, 'AFTER', 'global context type (asset) INSERT',
      'accepted, falls back to caller org A', 'REFUSED: ' || SQLERRM, false);
  END;

  -- T6/T7 — the trigger's UPDATE branches.
  --
  -- `authenticated` holds no UPDATE grant on messages, on staging or on
  -- production (only service_role does), so running these as `authenticated`
  -- proves nothing: both would be refused by the missing grant before the
  -- trigger ever fired, and T7 would report a false PASS. The UPDATE branches
  -- are reachable only from service_role and SECURITY DEFINER RPCs, so that is
  -- the role they are exercised under. auth.uid() still resolves from the JWT
  -- claim, so current_org_id() behaves exactly as it does for a real caller.
  SELECT id INTO orphan FROM public.messages WHERE content = 't6-orphan';
  PERFORM set_config('role', 'service_role', true);

  BEGIN
    UPDATE public.messages SET content = 't6-edited' WHERE id = orphan
    RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (6, 'AFTER', 'UPDATE of orphan, context unchanged (service_role)',
      'accepted, org preserved as A',
      CASE WHEN landed = org_a THEN 'accepted, org preserved as A'
           ELSE 'accepted but org became ' || coalesce(landed::text,'NULL') END, landed = org_a);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (6, 'AFTER', 'UPDATE of orphan, context unchanged (service_role)',
      'accepted, org preserved as A', 'REFUSED: ' || left(SQLERRM, 60), false);
  END;

  -- T7 — moving an existing row's context to a foreign tenant must be refused.
  BEGIN
    UPDATE public.messages SET context_type = 'portfolio', context_id = pf_b
     WHERE id = orphan RETURNING organization_id INTO landed;
    INSERT INTO c1_results VALUES (7, 'AFTER', 'UPDATE moving context to foreign portfolio (service_role)',
      'REFUSED', 'ACCEPTED as org ' || coalesce(landed::text,'NULL'), false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO c1_results VALUES (7, 'AFTER', 'UPDATE moving context to foreign portfolio (service_role)',
      'REFUSED', 'refused: ' || left(SQLERRM, 60), true);
  END;

  PERFORM set_config('role', 'postgres', true);
END $after$;

-- ── Report and roll back ────────────────────────────────────────────────────
DO $report$
DECLARE
  body text := '';
  failed int;
BEGIN
  SELECT count(*) INTO failed FROM c1_results WHERE NOT pass;
  SELECT string_agg(format('  %s %s [%s] %s%s      expected: %s%s      actual  : %s',
                           CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
                           seq, phase, test, chr(10), expected, chr(10), actual),
                    chr(10) ORDER BY seq)
    INTO body FROM c1_results;

  RAISE EXCEPTION E'\n=== 07 STAGING BEHAVIOURAL SUITE ===\n%\n\n  % of % failed. Transaction rolled back; no fixture persisted.\n',
    body, failed, (SELECT count(*) FROM c1_results);
END $report$;
