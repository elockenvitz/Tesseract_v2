-- price_target_outcomes tenant isolation — preflight, rehearsal and verification.
--
-- Sections 1-2 are READ-ONLY and establish the before-state.
-- Section 3 is the REHEARSAL: it applies the migration, asserts every property,
-- then ROLLS BACK, so the whole fix can be proven against real production rows
-- without changing production. Run it exactly as written — the final ROLLBACK
-- is part of the script.
-- Section 4 is the post-apply verification, for after the migration lands.
--
--   psql "$DATABASE_URL" -f scripts/sql/price-target-outcomes/verify.sql
--
-- Two production identities are used for the behavioural checks. Both were
-- chosen because the evidence in section 2 says what they must see:
--   OWNER   6e020f03-3db9-42bb-89ee-8aff12f31e34  johncpetrini@gmail.com  (Tesseract)
--   FOREIGN 95cb37a8-642d-4a9b-ac82-abaf5635a0bd  patcaffrey9@gmail.com   (Caffrey Capital)


\echo '== 1. PREFLIGHT: the boundary as it stands =='

-- 1a. Expect exactly one SELECT policy, qual = (auth.uid() IS NOT NULL).
SELECT polname,
       CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                   WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                   ELSE polcmd::text END AS cmd,
       pg_get_expr(polqual,      polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
  FROM pg_policy
 WHERE polrelid = 'public.price_target_outcomes'::regclass
 ORDER BY polname;

-- 1b. RLS enabled / forced. Expect enabled, NOT forced.
SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
  FROM pg_class WHERE oid = 'public.price_target_outcomes'::regclass;

-- 1c. Grants. Expect anon to hold DELETE/INSERT/TRUNCATE/UPDATE before,
--     and nothing after.
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'price_target_outcomes'
 GROUP BY grantee ORDER BY grantee;

-- 1d. Every writer of this table. All three must be SECURITY DEFINER, which is
--     why narrowing the policies cannot break a write path.
SELECT p.proname,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosrc ~* '(insert into|update|delete from)[[:space:]]+price_target_outcomes'
 ORDER BY p.proname;


\echo '== 2. PREFLIGHT: ownership resolves, and the two wrong derivations do not =='

-- 2a. Total rows. This number must not change. Expected: 30.
SELECT count(*) AS total_rows FROM public.price_target_outcomes;

-- 2b. Resolvability via the parent. Expected: orphans 0, unresolvable 0,
--     resolved 30, distinct orgs 2.
SELECT count(*) FILTER (WHERE apt.id IS NULL)                AS orphans,
       count(*) FILTER (WHERE apt.id IS NOT NULL
                          AND apt.organization_id IS NULL)   AS unresolvable,
       count(apt.organization_id)                            AS resolved,
       count(DISTINCT apt.organization_id)                   AS distinct_orgs
  FROM public.price_target_outcomes pto
  LEFT JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id;

-- 2c. Why the author derivation was rejected, in numbers. Expected:
--     multi_org_authors 27, author_org_disagrees 7.
SELECT
  count(*) FILTER (
    WHERE (SELECT count(DISTINCT m.organization_id)
             FROM public.organization_memberships m
            WHERE m.user_id = pto.user_id AND m.status = 'active') > 1
  ) AS multi_org_authors,
  count(*) FILTER (
    WHERE u.current_organization_id IS NOT NULL
      AND apt.organization_id IS NOT NULL
      AND u.current_organization_id <> apt.organization_id
  ) AS author_org_disagrees
  FROM public.price_target_outcomes pto
  JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id
  LEFT JOIN public.users u ON u.id = pto.user_id;

-- 2d. The exposure, behaviourally, as the foreign tenant. This is the finding.
--     Expected BEFORE: readable 30, timeline 7, parents_visible 3,
--                      readable_with_invisible_parent 27.
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"sub":"95cb37a8-642d-4a9b-ac82-abaf5635a0bd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT (SELECT count(*) FROM public.price_target_outcomes) AS readable,
         (SELECT count(*) FROM public.price_target_outcomes
           WHERE status IN ('hit','missed','expired'))       AS timeline,
         (SELECT count(*) FROM public.analyst_price_targets) AS parents_visible,
         (SELECT count(*) FROM public.price_target_outcomes pto
            WHERE NOT EXISTS (SELECT 1 FROM public.analyst_price_targets apt
                               WHERE apt.id = pto.price_target_id))
                                                             AS readable_with_invisible_parent;
  RESET ROLE;
ROLLBACK;


\echo '== 3. REHEARSAL: apply, assert, then roll back. Changes nothing. =='

BEGIN;

\i supabase/migrations/20261011120000_price_target_outcomes_tenant_isolation.sql

-- 3a. Nothing was lost and no owner was invented.
DO $$
DECLARE total int; owned int; wrong int;
BEGIN
  SELECT count(*), count(organization_id) INTO total, owned
    FROM public.price_target_outcomes;
  IF total <> 30 THEN
    RAISE EXCEPTION 'FAIL 3a: row count changed to %, expected 30', total;
  END IF;
  IF owned <> 30 THEN
    RAISE EXCEPTION 'FAIL 3a: only % of % rows resolved to an owner', owned, total;
  END IF;
  -- Every stamped owner must equal what the parent says. A row here means an
  -- owner was fabricated rather than derived.
  SELECT count(*) INTO wrong
    FROM public.price_target_outcomes pto
    JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id
   WHERE pto.organization_id IS DISTINCT FROM apt.organization_id;
  IF wrong <> 0 THEN
    RAISE EXCEPTION 'FAIL 3a: % row(s) disagree with their parent', wrong;
  END IF;
  RAISE NOTICE 'OK 3a: 30 rows preserved, 30 owners derived, 0 fabricated';
END $$;

-- 3b. No unconditional predicate survives on this table.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_policy
   WHERE polrelid = 'public.price_target_outcomes'::regclass
     AND coalesce(pg_get_expr(polqual, polrelid), '') IN
         ('true', '(true)', '(auth.uid() IS NOT NULL)');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL 3b: % AUTH_ONLY/unconditional predicate(s) remain', n;
  END IF;
  RAISE NOTICE 'OK 3b: no unconditional predicate on price_target_outcomes';
END $$;

-- 3c. anon holds no grant.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'price_target_outcomes'
     AND grantee IN ('anon', 'PUBLIC');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL 3c: anon/PUBLIC still holds % grant(s)', n;
  END IF;
  RAISE NOTICE 'OK 3c: anon and PUBLIC hold no grant';
END $$;

-- 3d. SAME-TENANT READ still works — the owner org keeps everything it owns,
--     including all 7 rows the Decision Timeline renders.
DO $$
DECLARE readable int; timeline int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO readable FROM public.price_target_outcomes;
  SELECT count(*) INTO timeline FROM public.price_target_outcomes
   WHERE status IN ('hit','missed','expired');
  RESET ROLE;
  IF readable <> 27 THEN
    RAISE EXCEPTION 'FAIL 3d: owner org reads % rows, expected 27', readable;
  END IF;
  IF timeline <> 7 THEN
    RAISE EXCEPTION 'FAIL 3d: owner org reads % timeline rows, expected 7', timeline;
  END IF;
  RAISE NOTICE 'OK 3d: owner org keeps 27 rows and all 7 timeline rows';
END $$;

-- 3e. CROSS-TENANT READ DENIED — and the child now agrees with its parent.
DO $$
DECLARE readable int; timeline int; parents int; escaped int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"95cb37a8-642d-4a9b-ac82-abaf5635a0bd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO readable FROM public.price_target_outcomes;
  SELECT count(*) INTO timeline FROM public.price_target_outcomes
   WHERE status IN ('hit','missed','expired');
  SELECT count(*) INTO parents  FROM public.analyst_price_targets;
  SELECT count(*) INTO escaped  FROM public.price_target_outcomes pto
   WHERE NOT EXISTS (SELECT 1 FROM public.analyst_price_targets apt
                      WHERE apt.id = pto.price_target_id);
  RESET ROLE;
  IF readable <> 3 THEN
    RAISE EXCEPTION 'FAIL 3e: foreign org reads % rows, expected its own 3', readable;
  END IF;
  IF timeline <> 0 THEN
    RAISE EXCEPTION 'FAIL 3e: foreign org still reads % timeline rows', timeline;
  END IF;
  IF escaped <> 0 THEN
    RAISE EXCEPTION 'FAIL 3e: % outcome row(s) still outlive an invisible parent', escaped;
  END IF;
  RAISE NOTICE 'OK 3e: foreign org reads only its own 3 rows, 0 timeline rows, 0 escaped (parents visible: %)', parents;
END $$;

-- 3f. CROSS-TENANT UPDATE DENIED.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"95cb37a8-642d-4a9b-ac82-abaf5635a0bd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.price_target_outcomes SET notes = 'cross-tenant write attempt'
   WHERE status IN ('hit','missed','expired');
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 3f: foreign UPDATE touched % row(s)', n;
  END IF;
  RAISE NOTICE 'OK 3f: cross-tenant UPDATE touches nothing';
END $$;

-- 3g. GATE NON-VACUITY, part 1: a forged organization_id is DISCARDED, not
--     trusted. Without the trigger this write would relabel the row and the
--     policy would happily honour it.
DO $$
DECLARE victim uuid; forged uuid; got uuid; truth uuid;
BEGIN
  SELECT pto.id, apt.organization_id INTO victim, truth
    FROM public.price_target_outcomes pto
    JOIN public.analyst_price_targets apt ON apt.id = pto.price_target_id
   LIMIT 1;
  SELECT id INTO forged FROM public.organizations WHERE id <> truth LIMIT 1;

  UPDATE public.price_target_outcomes
     SET organization_id = forged
   WHERE id = victim;

  SELECT organization_id INTO got
    FROM public.price_target_outcomes WHERE id = victim;

  IF got = forged THEN
    RAISE EXCEPTION
      'FAIL 3g: forged organization_id % was accepted — the trigger is not guarding', forged;
  END IF;
  IF got IS DISTINCT FROM truth THEN
    RAISE EXCEPTION 'FAIL 3g: owner became %, expected the parent''s %', got, truth;
  END IF;
  RAISE NOTICE 'OK 3g: forged owner discarded, re-derived to the parent''s org';
END $$;

-- 3h. GATE NON-VACUITY, part 2: the natural key is immutable, so a row cannot
--     be walked into another tenant by repointing it at a foreign parent.
DO $$
DECLARE victim uuid; other_parent uuid; blocked boolean := false;
BEGIN
  SELECT id INTO victim FROM public.price_target_outcomes LIMIT 1;
  SELECT apt.id INTO other_parent
    FROM public.analyst_price_targets apt
   WHERE apt.id <> (SELECT price_target_id FROM public.price_target_outcomes WHERE id = victim)
   LIMIT 1;

  BEGIN
    UPDATE public.price_target_outcomes
       SET price_target_id = other_parent
     WHERE id = victim;
  EXCEPTION WHEN raise_exception OR unique_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL 3h: price_target_id was mutable — a row can change tenant';
  END IF;
  RAISE NOTICE 'OK 3h: price_target_id is immutable';
END $$;

-- 3i. GATE NON-VACUITY, part 3: prove the quarantine actually hides a row,
--     by creating one. A parent with no organization yields a NULL owner, and
--     a NULL owner must be invisible to the very org that would otherwise own it.
DO $$
DECLARE parent uuid; child uuid; owner_org uuid; visible int; present int;
BEGIN
  SELECT pto.price_target_id, pto.id, pto.organization_id
    INTO parent, child, owner_org
    FROM public.price_target_outcomes pto
   WHERE pto.organization_id IS NOT NULL
   LIMIT 1;

  -- Strip the parent's org, then touch the child so the trigger re-derives.
  UPDATE public.analyst_price_targets SET organization_id = NULL WHERE id = parent;
  UPDATE public.price_target_outcomes SET notes = notes WHERE id = child;

  SELECT count(*) INTO present
    FROM public.price_target_outcomes WHERE id = child AND organization_id IS NULL;
  IF present <> 1 THEN
    RAISE EXCEPTION 'FAIL 3i: unresolvable row did not quarantine to NULL';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visible FROM public.price_target_outcomes WHERE id = child;
  RESET ROLE;

  IF visible <> 0 THEN
    RAISE EXCEPTION 'FAIL 3i: quarantined row is visible to org %', owner_org;
  END IF;
  RAISE NOTICE 'OK 3i: unresolvable row quarantines to NULL, preserved and invisible';
END $$;

-- 3j. The write path that actually creates these rows still works end to end:
--     inserting a price target as a real user must produce an outcome stamped
--     with that user's org, through the SECURITY DEFINER trigger.
DO $$
DECLARE new_target uuid; stamped uuid; expected uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"6e020f03-3db9-42bb-89ee-8aff12f31e34","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT current_org_id() INTO expected;

  INSERT INTO public.analyst_price_targets (user_id, asset_id, scenario_id, price, timeframe)
  SELECT '6e020f03-3db9-42bb-89ee-8aff12f31e34'::uuid,
         apt.asset_id, apt.scenario_id, 123.45, '12 months'
    FROM public.analyst_price_targets apt
   WHERE apt.organization_id = expected
   LIMIT 1
  RETURNING id INTO new_target;

  SELECT organization_id INTO stamped
    FROM public.price_target_outcomes WHERE price_target_id = new_target;
  RESET ROLE;

  IF new_target IS NULL THEN
    RAISE EXCEPTION 'FAIL 3j: could not create a price target as the owner user';
  END IF;
  IF stamped IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL 3j: new outcome stamped %, expected %', stamped, expected;
  END IF;
  RAISE NOTICE 'OK 3j: the live write path still creates a correctly owned outcome';
END $$;

ROLLBACK;

\echo '== REHEARSAL ROLLED BACK — production unchanged =='

-- Confirm the rollback: the old policy must still be here until the migration
-- is applied for real.
SELECT count(*) AS auth_only_policies_still_present
  FROM pg_policy
 WHERE polrelid = 'public.price_target_outcomes'::regclass
   AND pg_get_expr(polqual, polrelid) = '(auth.uid() IS NOT NULL)';


\echo '== 4. POST-APPLY verification (run after the migration lands) =='

-- Re-run sections 1a-1c and 3a-3f against the applied state. 1a must show the
-- two new policies and no AUTH_ONLY predicate; 1c must show no anon grant;
-- 2a must still read 30.
