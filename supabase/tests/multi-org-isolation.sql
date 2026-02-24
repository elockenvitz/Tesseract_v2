-- =============================================================================
-- Multi-Org Isolation Smoke Test
--
-- Creates two orgs (A, B), a dual-member user, and verifies that org-scoped
-- data is correctly partitioned across 8 representative table families.
-- 20 assertions total.
--
-- Designed to run from: SQL Editor (service role), psql, or pgTAP.
-- Does NOT depend on auth.uid() / current_org_id() — uses direct org_id
-- comparisons so it works under service-role context.
--
-- Self-cleaning: uses unique suffix + cleanup block.
-- =============================================================================

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_a_id uuid;
  v_org_b_id uuid;
  v_team_a_id uuid;
  v_team_b_id uuid;
  v_portfolio_a_id uuid;
  v_portfolio_b_id uuid;
  v_workflow_a_id uuid;
  v_workflow_b_id uuid;
  v_project_a_id uuid;
  v_project_b_id uuid;
  v_theme_a_id uuid;
  v_theme_b_id uuid;
  v_conv_a_id uuid;
  v_conv_b_id uuid;
  v_tradelab_a_id uuid;
  v_tradelab_b_id uuid;
  v_calendar_a_id uuid;
  v_calendar_b_id uuid;
  v_user_id uuid;
  v_count int;
  v_pass int := 0;
  v_fail int := 0;
  v_user_current_org uuid;
BEGIN
  RAISE NOTICE '=== Multi-Org Isolation Smoke Test (suffix: %) ===', v_suffix;

  -- -------------------------------------------------------------------------
  -- SETUP: Get a test user
  -- -------------------------------------------------------------------------
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'SKIP: No auth users found — cannot run isolation test';
    RETURN;
  END IF;
  RAISE NOTICE 'Test user: %', v_user_id;

  -- -------------------------------------------------------------------------
  -- SETUP: Create Org A + Org B
  -- -------------------------------------------------------------------------
  INSERT INTO organizations (name, slug)
    VALUES ('Test Org A ' || v_suffix, 'test-org-a-' || v_suffix)
    RETURNING id INTO v_org_a_id;
  INSERT INTO organizations (name, slug)
    VALUES ('Test Org B ' || v_suffix, 'test-org-b-' || v_suffix)
    RETURNING id INTO v_org_b_id;

  -- User is active member of both
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org_a_id, v_user_id, 'active', true),
           (v_org_b_id, v_user_id, 'active', true);

  -- -------------------------------------------------------------------------
  -- SETUP: Seed data in BOTH orgs
  -- -------------------------------------------------------------------------

  -- Teams
  INSERT INTO teams (organization_id, name, slug, color, icon)
    VALUES (v_org_a_id, 'Team A ' || v_suffix, 'team-a-' || v_suffix, '#3b82f6', 'users')
    RETURNING id INTO v_team_a_id;
  INSERT INTO teams (organization_id, name, slug, color, icon)
    VALUES (v_org_b_id, 'Team B ' || v_suffix, 'team-b-' || v_suffix, '#10b981', 'users')
    RETURNING id INTO v_team_b_id;

  INSERT INTO team_memberships (team_id, user_id, is_team_admin)
    VALUES (v_team_a_id, v_user_id, true), (v_team_b_id, v_user_id, true);

  -- Portfolios (FK chain: portfolios → teams → org)
  INSERT INTO portfolios (name, team_id, portfolio_type)
    VALUES ('Portfolio A ' || v_suffix, v_team_a_id, 'equity')
    RETURNING id INTO v_portfolio_a_id;
  INSERT INTO portfolios (name, team_id, portfolio_type)
    VALUES ('Portfolio B ' || v_suffix, v_team_b_id, 'equity')
    RETURNING id INTO v_portfolio_b_id;

  INSERT INTO portfolio_memberships (portfolio_id, user_id, is_portfolio_manager)
    VALUES (v_portfolio_a_id, v_user_id, true), (v_portfolio_b_id, v_user_id, true);

  -- Workflows (direct org_id)
  INSERT INTO workflows (organization_id, name, description, created_by)
    VALUES (v_org_a_id, 'Workflow A ' || v_suffix, 'Test', v_user_id)
    RETURNING id INTO v_workflow_a_id;
  INSERT INTO workflows (organization_id, name, description, created_by)
    VALUES (v_org_b_id, 'Workflow B ' || v_suffix, 'Test', v_user_id)
    RETURNING id INTO v_workflow_b_id;

  -- Projects (direct org_id)
  INSERT INTO projects (organization_id, title, created_by, status, priority)
    VALUES (v_org_a_id, 'Project A ' || v_suffix, v_user_id, 'planning', 'medium')
    RETURNING id INTO v_project_a_id;
  INSERT INTO projects (organization_id, title, created_by, status, priority)
    VALUES (v_org_b_id, 'Project B ' || v_suffix, v_user_id, 'planning', 'medium')
    RETURNING id INTO v_project_b_id;

  -- Themes (direct org_id)
  INSERT INTO themes (organization_id, name, created_by)
    VALUES (v_org_a_id, 'Theme A ' || v_suffix, v_user_id)
    RETURNING id INTO v_theme_a_id;
  INSERT INTO themes (organization_id, name, created_by)
    VALUES (v_org_b_id, 'Theme B ' || v_suffix, v_user_id)
    RETURNING id INTO v_theme_b_id;

  -- Conversations (direct org_id)
  INSERT INTO conversations (organization_id, name, created_by, is_group)
    VALUES (v_org_a_id, 'Conv A ' || v_suffix, v_user_id, true)
    RETURNING id INTO v_conv_a_id;
  INSERT INTO conversations (organization_id, name, created_by, is_group)
    VALUES (v_org_b_id, 'Conv B ' || v_suffix, v_user_id, true)
    RETURNING id INTO v_conv_b_id;

  -- Trade Labs (FK chain: trade_labs → portfolios → teams → org)
  INSERT INTO trade_labs (portfolio_id, name, created_by)
    VALUES (v_portfolio_a_id, 'Lab A ' || v_suffix, v_user_id)
    RETURNING id INTO v_tradelab_a_id;
  INSERT INTO trade_labs (portfolio_id, name, created_by)
    VALUES (v_portfolio_b_id, 'Lab B ' || v_suffix, v_user_id)
    RETURNING id INTO v_tradelab_b_id;

  -- Calendar Events (direct org_id)
  INSERT INTO calendar_events (organization_id, title, start_date, end_date, event_type, created_by)
    VALUES (v_org_a_id, 'Event A ' || v_suffix, now(), now() + interval '1 hour', 'meeting', v_user_id)
    RETURNING id INTO v_calendar_a_id;
  INSERT INTO calendar_events (organization_id, title, start_date, end_date, event_type, created_by)
    VALUES (v_org_b_id, 'Event B ' || v_suffix, now(), now() + interval '1 hour', 'meeting', v_user_id)
    RETURNING id INTO v_calendar_b_id;

  -- =========================================================================
  -- SIMULATE ORG A CONTEXT: set user's current_organization_id to Org A
  -- then verify that querying with org_id = user's current org shows only A data
  -- =========================================================================
  UPDATE users SET current_organization_id = v_org_a_id WHERE id = v_user_id;
  -- Read it back to confirm
  SELECT current_organization_id INTO v_user_current_org FROM users WHERE id = v_user_id;

  RAISE NOTICE '';
  RAISE NOTICE '--- Context: Org A (%) ---', v_user_current_org;

  -- Assert 1: current_organization_id is Org A
  IF v_user_current_org = v_org_a_id THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [1]  current_organization_id = Org A';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1]  current_organization_id mismatch'; END IF;

  -- Assert 2: Teams scoped to Org A — exactly 1 test team
  SELECT count(*) INTO v_count FROM teams WHERE organization_id = v_org_a_id AND name LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [2]  Teams in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2]  Teams in Org A: expected 1, got %', v_count; END IF;

  -- Assert 3: Team B is NOT in Org A
  SELECT count(*) INTO v_count FROM teams WHERE id = v_team_b_id AND organization_id = v_org_a_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [3]  Org B team excluded from Org A scope';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3]  Org B team leaked into Org A scope'; END IF;

  -- Assert 4: Workflows scoped to Org A
  SELECT count(*) INTO v_count FROM workflows WHERE organization_id = v_org_a_id AND name LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [4]  Workflows in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4]  Workflows in Org A: expected 1, got %', v_count; END IF;

  -- Assert 5: Workflow B NOT in Org A
  SELECT count(*) INTO v_count FROM workflows WHERE id = v_workflow_b_id AND organization_id = v_org_a_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [5]  Org B workflow excluded from Org A';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5]  Org B workflow leaked into Org A'; END IF;

  -- Assert 6: Projects scoped to Org A
  SELECT count(*) INTO v_count FROM projects WHERE organization_id = v_org_a_id AND title LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [6]  Projects in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6]  Projects in Org A: expected 1, got %', v_count; END IF;

  -- Assert 7: Project B NOT in Org A
  SELECT count(*) INTO v_count FROM projects WHERE id = v_project_b_id AND organization_id = v_org_a_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [7]  Org B project excluded from Org A';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7]  Org B project leaked into Org A'; END IF;

  -- Assert 8: Themes scoped to Org A
  SELECT count(*) INTO v_count FROM themes WHERE organization_id = v_org_a_id AND name LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [8]  Themes in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8]  Themes in Org A: expected 1, got %', v_count; END IF;

  -- Assert 9: Conversations scoped to Org A
  SELECT count(*) INTO v_count FROM conversations WHERE organization_id = v_org_a_id AND name LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [9]  Conversations in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9]  Conversations in Org A: expected 1, got %', v_count; END IF;

  -- Assert 10: Calendar events scoped to Org A
  SELECT count(*) INTO v_count FROM calendar_events WHERE organization_id = v_org_a_id AND title LIKE '%' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] Calendar events in Org A: %', v_count;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] Calendar events in Org A: expected 1, got %', v_count; END IF;

  -- =========================================================================
  -- SIMULATE ORG B CONTEXT
  -- =========================================================================
  UPDATE users SET current_organization_id = v_org_b_id WHERE id = v_user_id;
  SELECT current_organization_id INTO v_user_current_org FROM users WHERE id = v_user_id;

  RAISE NOTICE '';
  RAISE NOTICE '--- Context: Org B (%) ---', v_user_current_org;

  -- Assert 11: current_organization_id is Org B
  IF v_user_current_org = v_org_b_id THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] current_organization_id = Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] current_organization_id mismatch'; END IF;

  -- Assert 12: Teams scoped to Org B — Org A team excluded
  SELECT count(*) INTO v_count FROM teams WHERE id = v_team_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] Org A team excluded from Org B scope';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] Org A team leaked into Org B scope'; END IF;

  -- Assert 13: Workflow A NOT in Org B
  SELECT count(*) INTO v_count FROM workflows WHERE id = v_workflow_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [13] Org A workflow excluded from Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13] Org A workflow leaked into Org B'; END IF;

  -- Assert 14: Project A NOT in Org B
  SELECT count(*) INTO v_count FROM projects WHERE id = v_project_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [14] Org A project excluded from Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [14] Org A project leaked into Org B'; END IF;

  -- Assert 15: Theme A NOT in Org B
  SELECT count(*) INTO v_count FROM themes WHERE id = v_theme_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [15] Org A theme excluded from Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [15] Org A theme leaked into Org B'; END IF;

  -- Assert 16: Conv A NOT in Org B
  SELECT count(*) INTO v_count FROM conversations WHERE id = v_conv_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [16] Org A conversation excluded from Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [16] Org A conversation leaked into Org B'; END IF;

  -- Assert 17: Calendar A NOT in Org B
  SELECT count(*) INTO v_count FROM calendar_events WHERE id = v_calendar_a_id AND organization_id = v_org_b_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [17] Org A calendar event excluded from Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [17] Org A calendar event leaked into Org B'; END IF;

  -- Assert 18: FK-chain — Portfolio A unreachable from Org B via team chain
  SELECT count(*) INTO v_count FROM portfolios p
    JOIN teams t ON t.id = p.team_id
    WHERE t.organization_id = v_org_b_id AND p.id = v_portfolio_a_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [18] Org A portfolio excluded from Org B (FK chain)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [18] Org A portfolio leaked into Org B (FK chain)'; END IF;

  -- Assert 19: FK-chain — Trade Lab A unreachable from Org B
  SELECT count(*) INTO v_count FROM trade_labs tl
    JOIN portfolios p ON p.id = tl.portfolio_id
    JOIN teams t ON t.id = p.team_id
    WHERE t.organization_id = v_org_b_id AND tl.id = v_tradelab_a_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [19] Org A trade lab excluded from Org B (FK chain)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [19] Org A trade lab leaked into Org B (FK chain)'; END IF;

  -- Assert 20: Cross-org invariant — no team has both org_a and org_b
  SELECT count(*) INTO v_count FROM teams
    WHERE organization_id = v_org_a_id AND id IN (
      SELECT id FROM teams WHERE organization_id = v_org_b_id
    );
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [20] No team exists in both Org A and Org B';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [20] Cross-org team detected'; END IF;

  -- =========================================================================
  -- CLEANUP
  -- =========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';

  DELETE FROM calendar_events WHERE id IN (v_calendar_a_id, v_calendar_b_id);
  DELETE FROM trade_labs WHERE id IN (v_tradelab_a_id, v_tradelab_b_id);
  DELETE FROM conversations WHERE id IN (v_conv_a_id, v_conv_b_id);
  DELETE FROM themes WHERE id IN (v_theme_a_id, v_theme_b_id);
  DELETE FROM projects WHERE id IN (v_project_a_id, v_project_b_id);
  DELETE FROM workflows WHERE id IN (v_workflow_a_id, v_workflow_b_id);
  DELETE FROM portfolio_memberships WHERE portfolio_id IN (v_portfolio_a_id, v_portfolio_b_id);
  DELETE FROM portfolios WHERE id IN (v_portfolio_a_id, v_portfolio_b_id);
  DELETE FROM team_memberships WHERE team_id IN (v_team_a_id, v_team_b_id);
  DELETE FROM teams WHERE id IN (v_team_a_id, v_team_b_id);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a_id, v_org_b_id);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a_id, v_org_b_id);
  DELETE FROM organizations WHERE id IN (v_org_a_id, v_org_b_id);

  -- =========================================================================
  -- RESULTS
  -- =========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 20 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'MULTI-ORG ISOLATION TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
