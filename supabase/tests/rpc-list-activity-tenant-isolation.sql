-- =============================================================================
-- List-activity RPCs - cross-tenant disclosure regression test
--
-- Pins the two functions repaired by
-- supabase/migrations/20261106160100_sec_list_activity_rpcs.sql:
--
--   get_list_activity_counts(p_user_id uuid)
--   get_latest_list_activities(p_list_ids uuid[])
--
-- WHY THIS TEST EXISTS
--
-- Both were SECURITY DEFINER with no caller check, and both are callable by
-- `authenticated` through PostgREST. Chained, they turned ONE user uuid into a
-- roster of another organization's private lists and who touched them:
--
--   get_list_activity_counts('<victim uuid>')        -> the victim's list uuids
--   get_latest_list_activities(array[those uuids])   -> actor_name resolved to
--                                                       a real EMAIL ADDRESS,
--                                                       plus metadata (tickers)
--
-- Measured against production 2026-11-06: the attacker's own direct SELECT of
-- the same rows returned 0, so RLS was correct and these two functions were
-- the hole. The attacker read 2 list uuids and the string
-- 'Orga Owner / ORGASECRET1'.
--
-- THE FIX, AND WHY IT IS SAFE
--
-- Both become SECURITY INVOKER, so the caller's own policies apply, and the
-- counts function stops trusting p_user_id (the parameter stays in the
-- signature for call compatibility and is ignored). Verified against the live
-- policies rather than assumed:
--
--   asset_list_activity    SELECT  the caller owns or collaborates on the list
--   asset_list_user_state  SELECT  user_id = auth.uid()
--   users                  SELECT  own row, or a member of the current org
--
-- The last one is why the fix does not simply hide everything: the body's
-- existing COALESCE already degrades an unresolvable actor to the literal
-- 'Someone', so a cross-org actor's name and email stop resolving without any
-- change to the body.
--
-- EXPECTED RESULTS BEFORE THE MIGRATION IS APPLIED
--   Measured against production 2026-11-06: 3 passed, 4 failed.
--   Assertions 1, 2, 5 and 6 FAIL. Assertions 3, 4 and 7 pass.
--
-- EXPECTED RESULTS AFTER: all 7 pass. Measured.
--
-- THE LEAK IS NOT ONLY CROSS-ORGANIZATION
--
-- Assertions 5 and 6 fail before the fix as well, and that was not expected
-- when this file was written. Pre-fix, the collaborator - who is shared on ONE
-- of the two lists - sees BOTH of them, because the SECURITY DEFINER function
-- applies no filter whatsoever, not even within an organization. So the same
-- defect also over-shares between colleagues in the same tenant. That is the
-- same single fix, but it is worth knowing that the blast radius was wider
-- than "another organization".
--
-- ASSERTION 5 IS ALSO THE ONE A LAZY FIX FAILS
--
-- A fix that scoped to "lists in my organization" rather than "lists I own or
-- collaborate on" would still let the collaborator see BOTH lists, including
-- the one they were never shared on. Assertion 5 requires exactly 1.
--
-- SAFE TO RUN AGAINST PRODUCTION: self-cleaning.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);
GRANT ALL ON _sec_results TO authenticated, anon;

DO $$
DECLARE
  s text := substr(md5(random()::text), 1, 8);
  v_org_a uuid; v_org_b uuid;
  v_owner uuid := gen_random_uuid();   -- org A, owns both lists
  v_collab uuid := gen_random_uuid();  -- org A, shared on ONE list only
  v_atk uuid := gen_random_uuid();     -- org B, the attacker
  v_private uuid;  -- org A list, not shared with anyone
  v_shared uuid;   -- org A list, shared with v_collab
  v_count int; v_txt text;
  v_pass int := 0; v_fail int := 0;
BEGIN
  -- ===========================================================================
  -- FIXTURE
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('RPC-LIST A ' || s, 'rpc-list-a-' || s) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('RPC-LIST B ' || s, 'rpc-list-b-' || s) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,  'rpclist_owner_'  || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_collab, 'rpclist_collab_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_atk,    'rpclist_atk_'    || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- A real name on the victim, so a leak is unmistakable in the output.
  UPDATE users SET first_name = 'Orga', last_name = 'Owner' WHERE id = v_owner;

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner, 'active', false),
    (v_org_a, v_collab, 'active', false),
    (v_org_b, v_atk, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_collab);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_atk;

  INSERT INTO asset_lists (name, created_by) VALUES ('ORG A PRIVATE LIST ' || s, v_owner) RETURNING id INTO v_private;
  INSERT INTO asset_lists (name, created_by) VALUES ('ORG A SHARED LIST '  || s, v_owner) RETURNING id INTO v_shared;
  INSERT INTO asset_list_collaborations (list_id, user_id, permission, invited_by)
    VALUES (v_shared, v_collab, 'write', v_owner);
  INSERT INTO asset_list_activity (list_id, activity_type, actor_id, metadata, created_at) VALUES
    (v_private, 'item_added', v_owner, '{"ticker":"ORGASECRET1"}', now()),
    (v_private, 'item_added', v_owner, '{"ticker":"ORGASECRET2"}', now()),
    (v_shared,  'item_added', v_owner, '{"ticker":"ORGASECRET3"}', now());

  -- ===========================================================================
  -- 1 & 2. THE LEAK: a forged p_user_id, then forged list uuids.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM get_list_activity_counts(v_owner) WHERE list_id IN (v_private, v_shared);
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'forged p_user_id enumerates 0 of org A''s lists');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('CROSS-ORG DISCLOSURE: forged p_user_id enumerated %s of org A''s lists', v_count)); END IF;

  SELECT count(*), string_agg(actor_name || ' / ' || (metadata->>'ticker'), ' ; ')
    INTO v_count, v_txt
    FROM get_latest_list_activities(ARRAY[v_private, v_shared]);
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'forged list uuids return 0 activity rows');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('CROSS-ORG DISCLOSURE: read %s row(s): %s', v_count, coalesce(v_txt, ''))); END IF;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 3 & 4. LEGITIMATE: the owner. Both lists, and real names and metadata.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM get_list_activity_counts(v_owner) WHERE list_id IN (v_private, v_shared);
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'owner still sees both of their own lists');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('owner sees %s of 2 own lists - OVER-TIGHTENED', v_count)); END IF;

  SELECT string_agg(actor_name || '/' || (metadata->>'ticker'), ' ; ' ORDER BY actor_name)
    INTO v_txt FROM get_latest_list_activities(ARRAY[v_private, v_shared]);
  IF v_txt LIKE '%Orga Owner%' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', format('owner still reads names and metadata: %s', v_txt));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('owner lost their own data: %s - OVER-TIGHTENED', coalesce(v_txt, '(none)'))); END IF;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 5 & 6. LEGITIMATE BUT NARROW: the collaborator sees the shared list and
  --        ONLY the shared list. An org-wide fix would fail assertion 5.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_collab, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM get_list_activity_counts(v_collab) WHERE list_id IN (v_private, v_shared);
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'collaborator sees the shared list only (1 of 2)');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('collaborator sees %s lists, expected exactly 1', v_count)); END IF;

  SELECT string_agg(a.list_id::text, ',') INTO v_txt FROM get_latest_list_activities(ARRAY[v_private, v_shared]) a;
  IF v_txt = v_shared::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'collaborator reads activity on the shared list only');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('collaborator activity scope wrong: %s', coalesce(v_txt, '(none)'))); END IF;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 7. ANON.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM get_list_activity_counts(v_owner);
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'anon reads 0 rows');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('anon read %s row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (7, 'PASS', format('anon denied (%s)', SQLSTATE));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  DELETE FROM asset_list_activity WHERE list_id IN (v_private, v_shared);
  DELETE FROM asset_list_user_state WHERE list_id IN (v_private, v_shared);
  DELETE FROM asset_list_collaborations WHERE list_id IN (v_private, v_shared);
  DELETE FROM asset_list_items WHERE list_id IN (v_private, v_shared);
  DELETE FROM asset_lists WHERE id IN (v_private, v_shared);
  -- Inserting a public.users row fires create_default_lists_trigger, which
  -- creates a default asset_lists row per user, and seed_default_list_statuses
  -- then seeds its statuses. Those lists are not in the fixture but they exist,
  -- and leaving them makes the users delete below fail with 23503 on
  -- list_statuses_list_id_fkey.
  DELETE FROM list_statuses WHERE list_id IN (SELECT id FROM asset_lists WHERE created_by IN (v_owner, v_collab, v_atk));
  DELETE FROM asset_lists WHERE created_by IN (v_owner, v_collab, v_atk);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_collab, v_atk);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM public.users WHERE id IN (v_owner, v_collab, v_atk);
  DELETE FROM auth.users WHERE id IN (v_owner, v_collab, v_atk);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 7 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
