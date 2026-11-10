-- =============================================================================
-- Transitive policy boundaries: the three children whose own policy says
-- nothing about the caller
--
-- WHY THIS EXISTS
--
--   Detector 4 of scripts/unconditional-policy-guard.mjs reports these three
--   as SEV3_TRANSITIVE_ONLY: every branch of their SELECT policy is caller-free,
--   and each branch EXISTS-joins a parent table, so the child's own predicate
--   constrains nothing by itself.
--
--     analyst_price_target_history  EXISTS (select 1 from analyst_price_targets t
--                                            where t.id = ...price_target_id)
--     calendar_event_reminders      EXISTS (select 1 from calendar_events ce
--                                            where ce.id = ...event_id)
--     model_versions                EXISTS (select 1 from asset_models m
--                                            where m.id = ...model_id)
--
--   A policy subquery is evaluated under the CALLER's RLS on the relation it
--   reads, so each child inherits its parent's org boundary. That is why these
--   are not holes. But the guard CANNOT establish it: nothing in a predicate
--   says whether the parent has RLS enabled at all, let alone whether the
--   parent's own predicate is sound. The guard says so in its own output and
--   demands this test instead of guessing.
--
--   So this file is the evidence for three ratchet entries. Without it,
--   KNOWN_UNRESOLVED_TRANSITIVE would be three tables suppressed on a reading
--   of their parents' predicates -- which is exactly the mistake that had
--   `workflow_stakeholders` recorded as live anon exposure for a day when the
--   measured answer was zero rows.
--
-- ── What it does NOT prove ───────────────────────────────────────────────────
--
-- That these policies are well designed. They are not: a child with no
-- predicate of its own is one migration away from being a hole -- drop RLS on a
-- parent, widen a parent's policy, or read the child through a SECURITY DEFINER
-- path, and nothing defends it. This test proves the boundary HOLDS TODAY. The
-- fix is to give each child a predicate of its own, and that is the ratchet
-- entry, not this test.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   5 PASS, 0 FAIL, both before and after any guard change: this suite tests
--   the DATABASE, not the guard. It is a measurement, not a regression gate for
--   a code change.
--
--   If assertion 1, 2 or 3 ever fails, the corresponding parent's RLS has been
--   weakened and the child is now a live cross-org read. Fix the child's policy;
--   do not re-measure the parent.
--
--   Assertion 5 is the preserve side: the owning organization must still read
--   all three of its own children. A "fix" that denied everyone would pass 1-4.
--
-- Self-cleaning. 5 assertions. Measured 2026-11-10 against production: 5/0.
-- =============================================================================

DROP TABLE IF EXISTS _tr_results;
CREATE TEMP TABLE _tr_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_a  uuid;
  v_org_b  uuid;
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_asset  uuid;
  v_scn    uuid;
  v_pt     uuid;
  v_hist   uuid;
  v_event  uuid;
  v_remind uuid;
  v_model  uuid;
  v_ver    uuid;
  v_count  int;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== transitive policy boundaries (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('TR A ' || v_suffix, 'tr-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('TR B ' || v_suffix, 'tr-b-' || v_suffix) RETURNING id INTO v_org_b;
  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a, 'tr_a_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b, 'tr_b_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a, 'active', false),
    (v_org_b, v_user_b, 'active', false);
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_a;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  INSERT INTO assets (symbol, company_name) VALUES ('TR' || upper(v_suffix), 'TR Test ' || v_suffix) RETURNING id INTO v_asset;
  SELECT id INTO v_scn FROM scenarios LIMIT 1;

  -- Three parent/child pairs, all owned by org A, written as the table owner
  -- (which is what an ingestion or a migration looks like).
  INSERT INTO analyst_price_targets (asset_id, scenario_id, user_id, price, organization_id)
    VALUES (v_asset, v_scn, v_user_a, 100, v_org_a) RETURNING id INTO v_pt;
  -- NOTE: analyst_price_target_history has NO organization_id column. That is
  -- the whole reason its policy leans on the parent, and it is why the fix is a
  -- design question rather than a one-line predicate change.
  INSERT INTO analyst_price_target_history (price_target_id, field_name)
    VALUES (v_pt, 'price') RETURNING id INTO v_hist;

  INSERT INTO calendar_events (title, start_date, organization_id)
    VALUES ('TR event ' || v_suffix, now(), v_org_a) RETURNING id INTO v_event;
  INSERT INTO calendar_event_reminders (event_id, reminder_time)
    VALUES (v_event, now()) RETURNING id INTO v_remind;

  INSERT INTO asset_models (asset_id, name, created_by, organization_id, is_shared)
    VALUES (v_asset, 'TR model ' || v_suffix, v_user_a, v_org_a, true) RETURNING id INTO v_model;
  INSERT INTO model_versions (model_id, version_number, file_path, file_name, created_by)
    VALUES (v_model, 1, 'p/' || v_suffix, 'f.xlsx', v_user_a) RETURNING id INTO v_ver;

  -- ===========================================================================
  -- 1-3. A member of org B must read none of the three children, although each
  --      child's own policy asks nothing about the caller.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_price_target_history WHERE id = v_hist;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tr_results VALUES (1,'PASS','org-B reads no analyst_price_target_history row');
  ELSE v_fail := v_fail + 1; INSERT INTO _tr_results VALUES (1,'FAIL',format('CROSS-ORG READ: %s row(s) — analyst_price_targets RLS has been weakened', v_count)); END IF;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM calendar_event_reminders WHERE id = v_remind;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tr_results VALUES (2,'PASS','org-B reads no calendar_event_reminders row');
  ELSE v_fail := v_fail + 1; INSERT INTO _tr_results VALUES (2,'FAIL',format('CROSS-ORG READ: %s row(s) — calendar_events RLS has been weakened', v_count)); END IF;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM model_versions WHERE id = v_ver;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tr_results VALUES (3,'PASS','org-B reads no model_versions row');
  ELSE v_fail := v_fail + 1; INSERT INTO _tr_results VALUES (3,'FAIL',format('CROSS-ORG READ: %s row(s) — asset_models RLS has been weakened', v_count)); END IF;

  -- ===========================================================================
  -- 4. anon reads nothing. Two of the three carry an anon SELECT GRANT, so the
  --    grant layer does not stop it; the policies are TO authenticated, so anon
  --    matches no policy at all. Both facts are load-bearing and neither is
  --    visible without running as anon.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT (SELECT count(*) FROM calendar_event_reminders) + (SELECT count(*) FROM model_versions) INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tr_results VALUES (4,'PASS','anon reads nothing, though it holds a SELECT grant on two of the three');
  ELSE v_fail := v_fail + 1; INSERT INTO _tr_results VALUES (4,'FAIL',format('ANON READ: %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 5. PRESERVE. The owning organization still reads all three of its own
  --    children. A policy change that denied everyone would pass 1-4.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM analyst_price_target_history WHERE id = v_hist)
         + (SELECT count(*) FROM calendar_event_reminders WHERE id = v_remind)
         + (SELECT count(*) FROM model_versions WHERE id = v_ver) INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 3 THEN v_pass := v_pass + 1; INSERT INTO _tr_results VALUES (5,'PASS','the owning org reads all three of its own children');
  ELSE v_fail := v_fail + 1; INSERT INTO _tr_results VALUES (5,'FAIL',format('OVER-TIGHTENED: owner reads %s of 3', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM model_versions WHERE id = v_ver;
  DELETE FROM asset_models WHERE id = v_model;
  DELETE FROM calendar_event_reminders WHERE id = v_remind;
  DELETE FROM calendar_events WHERE id = v_event;
  DELETE FROM analyst_price_target_history WHERE id = v_hist;
  DELETE FROM analyst_price_targets WHERE id = v_pt;
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 5 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _tr_results ORDER BY n, result;
