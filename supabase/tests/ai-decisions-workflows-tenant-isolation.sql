-- =============================================================================
-- get_decisions / get_workflows read paths — tenant isolation regression test
--
-- WHAT THIS IS FOR
--
-- `ai-chat` gained two asset-scoped research tools. They add no table and no
-- policy: they read eight existing tables through the CALLER'S OWN client
-- (publishable key plus the caller's Authorization header), so the tenant
-- boundary they inherit is the one these policies already draw.
--
-- That inheritance is the thing worth testing, because it is an assumption, not
-- a mechanism. If any of these policies is later widened, the AI becomes a
-- cross-org read channel for the firm's decision record, and nothing in the
-- function would notice. These assertions fail the moment that happens.
--
-- WHY THE ASSET IS SHARED ON PURPOSE
--
-- Assets are global reference data. Both firms legitimately reach the same
-- ticker; what must never cross is what each firm DECIDED about it. So every
-- fixture below hangs off ONE asset, and the test is that two callers asking
-- the same question about the same ticker see disjoint record sets.
--
-- Measured against production 2026-11-11 with real accounts on AAPL, before
-- this suite existed: the insider saw 64 records, an outsider in another
-- organization saw 4 (their own firm's), and 0 were shared.
--
-- THE FOUR STAGES ARE SEPARATE RECORDS
--
-- Assertions 9 and 10 exist because the tools' whole purpose is keeping a
-- recommendation, a PM ruling and a committed trade apart. A fixture where an
-- accepted PM ruling has NO committed trade proves the chain can legitimately
-- stop mid-way, which is the state the model must be able to describe without
-- claiming a trade happened.
--
-- Run inside BEGIN … ROLLBACK. Nothing is committed, so there is no fixture
-- teardown — which matters here: 196 unindexed foreign keys make deleting a
-- test user take about 75 seconds.
--
-- EXECUTED 2026-11-11 against production inside BEGIN … ROLLBACK:
-- 11 of 11 passed. Nothing committed.
--
-- PROVEN NON-VACUOUS the same day, in the same wrapper, by widening the four
-- SELECT policies these assertions depend on to USING (true) — the real failure
-- shape, a policy loosened by a later migration:
--
--   asset_checklist_items_select, asset_workflow_progress_select,
--   "Trade queue: org-scoped access", "Decision requests: org-scoped"
--
-- Assertions 3, 4 and 5 then FAILED — "org B read 2 of org A's chain rows",
-- "org B read 2 of org A's process rows", "asset-scoped requirement read
-- returned 2 row(s); expected 1" — 0 PASS / 3 FAIL. The transaction was rolled
-- back and all four predicates re-verified intact in production afterwards.
--
-- Self-cleaning. 11 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid;
  v_org_b    uuid;
  v_user_a   uuid := gen_random_uuid();   -- org A analyst, and a portfolio member
  v_user_a2  uuid := gen_random_uuid();   -- org A colleague, NOT a portfolio member
  v_user_b   uuid := gen_random_uuid();   -- org B, unrelated
  v_asset    uuid;
  v_pf_a     uuid;
  v_pf_b     uuid;
  v_wf_a     uuid;
  v_wf_b     uuid;
  v_stage_a  text := 'stage_diligence';
  v_prog_a   uuid;
  v_item_a   uuid := gen_random_uuid();
  v_item_a2  uuid := gen_random_uuid();   -- a completed one, for the bucket check
  v_item_b   uuid := gen_random_uuid();
  v_rec_a    uuid;
  v_rec_b    uuid;
  v_ruling_a uuid;
  v_trade_a  uuid;
  v_count    int;
  v_text     text;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== get_decisions / get_workflows tenant isolation (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('AID Org A ' || v_suffix, 'aid-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('AID Org B ' || v_suffix, 'aid-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'aid_a_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'aid_a2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'aid_b_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_b, v_user_b,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- Global reference data. This is the premise, not an oversight.
  INSERT INTO assets (symbol, company_name)
    VALUES ('AID' || upper(substr(v_suffix, 1, 4)), 'AI Decisions Test ' || v_suffix)
    RETURNING id INTO v_asset;

  INSERT INTO portfolios (name, organization_id) VALUES ('AID PF A ' || v_suffix, v_org_a) RETURNING id INTO v_pf_a;
  INSERT INTO portfolios (name, organization_id) VALUES ('AID PF B ' || v_suffix, v_org_b) RETURNING id INTO v_pf_b;

  -- user_a is on the book; user_a2 deliberately is not. `accepted_trades`
  -- requires portfolio membership, so a2 is the "restricted record" case: same
  -- organization, still not entitled to the trade.
  INSERT INTO portfolio_team (portfolio_id, user_id, role) VALUES (v_pf_a, v_user_a, 'analyst');

  INSERT INTO workflows (name, organization_id, is_public) VALUES ('AID WF A ' || v_suffix, v_org_a, true) RETURNING id INTO v_wf_a;
  INSERT INTO workflows (name, organization_id, is_public) VALUES ('AID WF B ' || v_suffix, v_org_b, true) RETURNING id INTO v_wf_b;

  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order)
    VALUES (v_wf_a, v_stage_a, 'Diligence', 1);

  INSERT INTO asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started)
    VALUES (v_asset, v_wf_a, v_stage_a, true) RETURNING id INTO v_prog_a;
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started)
    VALUES (v_asset, v_wf_b, v_stage_a, true);

  -- Seeded as the table owner, bypassing RLS, so the fixture does not depend on
  -- the policies under test.
  INSERT INTO asset_checklist_items
    (id, asset_id, workflow_id, stage_id, item_id, item_text, status, item_type, organization_id, created_by)
  VALUES
    (v_item_a,  v_asset, v_wf_a, v_stage_a, 'item_0', 'ORG A: confirm segment margins', 'unchecked', 'thinking',    v_org_a, v_user_a),
    (v_item_a2, v_asset, v_wf_a, v_stage_a, 'item_1', 'ORG A: pull the 10-K',           'completed', 'operational', v_org_a, v_user_a),
    (v_item_b,  v_asset, v_wf_b, v_stage_a, 'item_0', 'ORG B: private diligence step',  'unchecked', 'thinking',    v_org_b, v_user_b);

  -- The decision chain for org A. Note what is deliberately MISSING: the ruling
  -- is accepted, and there is a committed trade, but its execution_status is
  -- 'not_started'. Accepted is not executed.
  INSERT INTO trade_queue_items (asset_id, portfolio_id, stage, status, action, created_by, organization_id, rationale, sharing_visibility)
    VALUES (v_asset, v_pf_a, 'ready_for_decision', 'deciding', 'buy', v_user_a, v_org_a, 'ORG A rationale', 'team')
    RETURNING id INTO v_rec_a;
  INSERT INTO trade_queue_items (asset_id, portfolio_id, stage, status, action, created_by, organization_id, rationale, sharing_visibility)
    VALUES (v_asset, v_pf_b, 'ready_for_decision', 'deciding', 'sell', v_user_b, v_org_b, 'ORG B rationale', 'team')
    RETURNING id INTO v_rec_b;

  INSERT INTO decision_requests (trade_queue_item_id, requested_by, portfolio_id, status, reviewed_by, reviewed_at, decision_note)
    VALUES (v_rec_a, v_user_a, v_pf_a, 'accepted', v_user_a, now(), 'ORG A: sized to 2%')
    RETURNING id INTO v_ruling_a;

  INSERT INTO accepted_trades
    (portfolio_id, asset_id, action, source, accepted_by, decision_request_id, trade_queue_item_id, execution_status)
    VALUES (v_pf_a, v_asset, 'buy', 'adhoc', v_user_a, v_ruling_a, v_rec_a, 'not_started')
    RETURNING id INTO v_trade_a;

  -- ===========================================================================
  -- 1. anon reads nothing from any of the eight tables
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT (SELECT count(*) FROM trade_queue_items   WHERE asset_id = v_asset)
         + (SELECT count(*) FROM decision_requests   WHERE trade_queue_item_id = v_rec_a)
         + (SELECT count(*) FROM accepted_trades     WHERE asset_id = v_asset)
         + (SELECT count(*) FROM asset_workflow_progress WHERE asset_id = v_asset)
         + (SELECT count(*) FROM asset_checklist_items   WHERE asset_id = v_asset)
         + (SELECT count(*) FROM workflow_stages     WHERE workflow_id = v_wf_a)
         + (SELECT count(*) FROM stage_assignments   WHERE asset_id = v_asset)
         + (SELECT count(*) FROM asset_stage_deadlines WHERE asset_id = v_asset)
      INTO v_count;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads nothing from the eight tool tables');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. LEGITIMATE same-org retrieval: the analyst sees their own firm's chain
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM trade_queue_items WHERE id = v_rec_a)
         + (SELECT count(*) FROM decision_requests WHERE id = v_ruling_a)
         + (SELECT count(*) FROM accepted_trades   WHERE id = v_trade_a)
      INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 3 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org A analyst reads recommendation + ruling + committed trade');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('org A analyst read %s of 3 chain rows — over-tightened, get_decisions would return empty', v_count)); END IF;

  -- ===========================================================================
  -- 3. CROSS-ORG DENIAL: org B sees none of org A's decision chain
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM trade_queue_items WHERE id = v_rec_a)
         + (SELECT count(*) FROM decision_requests WHERE id = v_ruling_a)
         + (SELECT count(*) FROM accepted_trades   WHERE id = v_trade_a)
      INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'org B reads none of org A''s decision chain');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('org B read %s of org A''s chain rows — get_decisions is a cross-org channel', v_count)); END IF;

  -- ===========================================================================
  -- 4. CROSS-ORG DENIAL: org B sees none of org A's process state
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM asset_workflow_progress WHERE workflow_id = v_wf_a)
         + (SELECT count(*) FROM asset_checklist_items   WHERE id = v_item_a)
         + (SELECT count(*) FROM workflow_stages         WHERE workflow_id = v_wf_a)
      INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'org B reads none of org A''s workflow, stage or requirement rows');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('org B read %s of org A''s process rows — get_workflows is a cross-org channel', v_count)); END IF;

  -- ===========================================================================
  -- 5. The asset-scoped query each tool actually issues returns ONLY own-org
  --    rows. This is the shape that matters: the tools filter by asset_id, not
  --    by id, so a policy that leaks shows up here and not in 3 or 4.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'asset-scoped requirement read returns 2 own-org rows, not org B''s third');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('asset-scoped requirement read returned %s row(s); expected exactly 2', v_count)); END IF;

  -- ===========================================================================
  -- 6. Same for the recommendation list the tool builds from
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM trade_queue_items WHERE asset_id = v_asset AND deleted_at IS NULL;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'asset-scoped recommendation read returns only org A''s');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('asset-scoped recommendation read returned %s row(s); expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 7. RESTRICTED RECORD: a same-org colleague who is not on the book cannot
  --    read the committed trade. Same organization, still not entitled — this
  --    is why zero committed_trades must never be reported as "none exist".
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM accepted_trades WHERE id = v_trade_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'non-member colleague cannot read the committed trade');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('non-member colleague read %s committed trade row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 8. ...while that same colleague DOES see the firm's process state. The
  --    restriction must be the portfolio's, not a blanket one.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE id = v_item_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'non-member colleague still reads the firm''s requirements');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('non-member colleague read %s requirement row(s); expected 1 — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 9. The chain links are the ones the tool reports, and they resolve
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count
      FROM accepted_trades t
      JOIN decision_requests d ON d.id = t.decision_request_id
      JOIN trade_queue_items q ON q.id = t.trade_queue_item_id
     WHERE t.id = v_trade_a AND d.id = v_ruling_a AND q.id = v_rec_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'committed trade -> PM ruling -> recommendation all resolve for the owner');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', format('the chain join returned %s row(s); expected 1 — get_decisions would report a broken link', v_count)); END IF;

  -- ===========================================================================
  -- 10. ACCEPTED IS NOT EXECUTED. The fixture's ruling is 'accepted' and its
  --     trade is 'not_started'. If anything ever collapses these, this fails.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT d.status || '/' || t.execution_status INTO v_text
      FROM decision_requests d JOIN accepted_trades t ON t.decision_request_id = d.id
     WHERE d.id = v_ruling_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := '(error)';
  END;
  IF v_text = 'accepted/not_started' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'an accepted ruling with an unexecuted trade is representable and distinguishable');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('ruling/execution read back as %s; expected accepted/not_started', coalesce(v_text, '(null)'))); END IF;

  -- ===========================================================================
  -- 11. Current workflow state: the stage the tool resolves is org A's, and the
  --     open/completed split is 1/1 rather than a single blended count.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT format('%s|%s|%s',
             (SELECT s.stage_label FROM asset_workflow_progress p
                JOIN workflow_stages s ON s.workflow_id = p.workflow_id AND s.stage_key = p.current_stage_key
               WHERE p.id = v_prog_a),
             (SELECT count(*) FROM asset_checklist_items WHERE asset_id = v_asset AND status <> 'completed'),
             (SELECT count(*) FROM asset_checklist_items WHERE asset_id = v_asset AND status = 'completed'))
      INTO v_text;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := '(error)';
  END;
  IF v_text = 'Diligence|1|1' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'current stage resolves to Diligence with 1 open / 1 completed requirement');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('workflow state read back as %s; expected Diligence|1|1', coalesce(v_text, '(null)'))); END IF;

  RAISE NOTICE '=== % passed, % failed ===', v_pass, v_fail;
END $$;

SELECT n, result, detail FROM _sec_results ORDER BY n;
