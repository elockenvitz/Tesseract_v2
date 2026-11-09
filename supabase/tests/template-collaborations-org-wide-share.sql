-- =============================================================================
-- template_collaborations / model_template_collaborations org-wide share
--
-- Guards the fixes in
--   supabase/migrations/20261109190001_sec_template_collaborations_org_scope.sql
--   supabase/migrations/20261109190002_sec_model_template_collaborations_org_scope.sql
--
-- THE DEFECT, twice, and it is the same one PR #276 fixed on layouts.
--
--   template_collaborations.collab_view_own            SELECT TO PUBLIC
--     ... OR ((user_id IS NULL) AND (team_id IS NULL))
--
--   model_template_collaborations
--     "Users can view org-wide collaborations"          SELECT TO PUBLIC
--     USING ((user_id IS NULL) AND (team_id IS NULL) AND (org_node_id IS NULL))
--
-- An all-NULL targets row is how "share with my organization" is recorded
-- (shareWithOrganization() in useTemplateCollaborations.ts:139 and
-- useModelTemplateCollaborations.ts:151). Neither predicate places any
-- condition on the caller and neither references another table, so each is
-- satisfied by row content alone. `anon` held SELECT on both tables.
--
-- Proven on production 2026-11-09, in a rolled-back transaction: one org-wide
-- template_collaborations row was inserted and then read back as the real
-- `anon` role. It returned 1.
--
-- Both tables hold zero org-wide rows today, which is the only reason nothing
-- is exposed right now. The first org-wide share arms both.
--
-- NOTE on the model_template_collaborations case: the caller-free-BRANCH
-- detector added by the preceding guard commit does not report it, because
-- that policy's only branch is caller-free and the detector deliberately
-- exempts a wholly caller-free predicate (`is_system = true` on a reference
-- table is correct). This test exists partly because CI could not see it.
--
-- Uses ACTUAL database roles (`authenticated`, `anon`) and a real
-- request.jwt.claims context, so grants, RLS and current_org_id() are
-- exercised together.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE the two migrations:
--       6 PASS, 5 FAIL - assertions 1, 2, 3, 4 and 7 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--
--   AFTER both migrations:
--       11 PASS, 0 FAIL.
--
-- Assertions 5, 6, 8, 9, 10 and 11 pass in BOTH states by design: they are the
-- preserve-legitimate-sharing side. 5 and 6 are the point of the feature - an
-- org-wide share must still reach the sharer's own colleagues. 9, 10 and 11
-- cover the OTHER sharing paths, so a fix that closed the org-wide branch by
-- breaking direct, team or org-node sharing fails here.
--
-- Assertion 7 is the one a fix keyed on membership presence would miss: a
-- REMOVED member whose current_organization_id still names the org must be
-- denied. current_org_id() enforces that by requiring status = 'active'.
--
-- FIXTURE NOTE: template_collaborations carries
-- UNIQUE NULLS NOT DISTINCT (template_id, team_id) and (template_id, user_id),
-- so a single text_template cannot hold BOTH an org-wide row and a
-- user-targeted row - the org-wide row's NULL team_id collides with the
-- user-targeted row's NULL team_id. Two separate templates are therefore
-- created. model_template_collaborations uses plain UNIQUE (NULLS DISTINCT)
-- and needs only one.
--
-- Self-cleaning. 11 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _tc_results;
CREATE TEMP TABLE _tc_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_owner   uuid := gen_random_uuid();   -- org A, current A, owns the templates
  v_member  uuid := gen_random_uuid();   -- org A, current A, the colleague the share is for
  v_out     uuid := gen_random_uuid();   -- active in A AND B, current B
  v_removed uuid := gen_random_uuid();   -- org A membership INACTIVE, current A
  v_team    uuid;
  v_node    uuid;
  v_tpl_org uuid;   -- text template carrying the ORG-WIDE share
  v_tpl_dir uuid;   -- text template carrying the DIRECT and TEAM shares
  v_mtpl    uuid;   -- model template, carries all three
  v_count   int;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== template collaborations org-wide share (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('TC Org A ' || v_suffix, 'tc-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('TC Org B ' || v_suffix, 'tc-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,   'tc_o_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_member,  'tc_m_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_out,     'tc_x_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_removed, 'tc_r_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner,   'active',   false),
    (v_org_a, v_member,  'active',   false),
    (v_org_a, v_out,     'active',   false),
    (v_org_b, v_out,     'active',   false),
    (v_org_a, v_removed, 'inactive', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_member, v_removed);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_out;

  INSERT INTO teams (name, slug, organization_id)
    VALUES ('TC team ' || v_suffix, 'tc-team-' || v_suffix, v_org_a) RETURNING id INTO v_team;
  INSERT INTO team_memberships (team_id, user_id) VALUES (v_team, v_member);

  INSERT INTO org_chart_nodes (organization_id, node_type, name)
    VALUES (v_org_a, 'team', 'TC node ' || v_suffix) RETURNING id INTO v_node;
  INSERT INTO org_chart_node_members (node_id, user_id, role) VALUES (v_node, v_member, 'member');

  INSERT INTO text_templates (user_id, name, content, organization_id)
    VALUES (v_owner, 'TC tpl org ' || v_suffix, 'body', v_org_a) RETURNING id INTO v_tpl_org;
  INSERT INTO text_templates (user_id, name, content, organization_id)
    VALUES (v_owner, 'TC tpl dir ' || v_suffix, 'body', v_org_a) RETURNING id INTO v_tpl_dir;
  INSERT INTO model_templates (name, organization_id, created_by)
    VALUES ('TC mtpl ' || v_suffix, v_org_a, v_owner) RETURNING id INTO v_mtpl;

  -- The org-wide shares: the exact rows shareWithOrganization() writes.
  INSERT INTO template_collaborations (template_id, user_id, team_id, permission)
    VALUES (v_tpl_org, NULL, NULL, 'view');
  INSERT INTO model_template_collaborations (template_id, user_id, team_id, org_node_id, permission)
    VALUES (v_mtpl, NULL, NULL, NULL, 'view');

  -- The other sharing paths, on the second template and the same model template.
  INSERT INTO template_collaborations (template_id, user_id, team_id, permission)
    VALUES (v_tpl_dir, v_member, NULL, 'edit');
  INSERT INTO model_template_collaborations (template_id, user_id, team_id, org_node_id, permission)
    VALUES (v_mtpl, v_member, NULL, NULL, 'edit');
  INSERT INTO model_template_collaborations (template_id, user_id, team_id, org_node_id, permission)
    VALUES (v_mtpl, NULL, NULL, v_node, 'view');

  -- ===========================================================================
  -- 1. THE FINDING. anon must not read an org-wide text-template share. This is
  --    the assertion that was measured returning 1 row on production.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id = v_tpl_org;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (1, 'PASS', 'anon reads no org-wide template share');
    ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (1, 'FAIL', format('ANON READ: %s org-wide template share(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. THE FINDING on the model-template table.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM model_template_collaborations
      WHERE template_id = v_mtpl AND user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (2, 'PASS', 'anon reads no org-wide model-template share');
    ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (2, 'FAIL', format('ANON READ: %s org-wide model-template share(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (2, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 3. A user whose current organization is B must not read org A's org-wide
  --    text-template share, even as an active member of org A. "Organization-
  --    wide" has to mean one organization.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id = v_tpl_org;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (3, 'PASS', 'org-B user reads no org A template share');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (3, 'FAIL', format('CROSS-ORG READ: %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 4. Same, model templates.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM model_template_collaborations
      WHERE template_id = v_mtpl AND user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (4, 'PASS', 'org-B user reads no org A model-template share');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (4, 'FAIL', format('CROSS-ORG READ: %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 5. PRESERVE. The colleague the share exists for still sees it. If this
  --    fails the feature is broken and the fix will be reverted.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id = v_tpl_org;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (5, 'PASS', 'same-org colleague still sees the org-wide template share');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (5, 'FAIL', format('over-tightened: org-wide share returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 6. PRESERVE, model templates.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM model_template_collaborations
      WHERE template_id = v_mtpl AND user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (6, 'PASS', 'same-org colleague still sees the org-wide model-template share');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (6, 'FAIL', format('over-tightened: returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 7. A REMOVED member of org A, current organization still org A, reads
  --    nothing. This is what current_org_id()'s status = 'active' requirement
  --    buys, and a fix that only matched the template's organization_id against
  --    a membership row would pass 3 and fail this.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_removed, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id = v_tpl_org;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (7, 'PASS', 'a removed member reads no org-wide share');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (7, 'FAIL', format('REMOVED MEMBER READ: %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 8. PRESERVE, ownership. The template owner still reads and manages their
  --    own collaborations - this is what the sharing modal lists.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id IN (v_tpl_org, v_tpl_dir);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (8, 'PASS', 'owner reads both of their template collaborations');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (8, 'FAIL', format('owner read %s row(s), expected 2', v_count)); END IF;

  -- ===========================================================================
  -- 9. PRESERVE, the DIRECT sharing path. Not the vulnerable branch, tested
  --    because the migration rewrites the whole policy and a dropped disjunct
  --    would be invisible otherwise.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM template_collaborations WHERE template_id = v_tpl_dir AND user_id = v_member;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (9, 'PASS', 'the direct user share is still visible to its target');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (9, 'FAIL', format('direct share returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 10. PRESERVE, the ORG-NODE sharing path on model templates.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM model_template_collaborations WHERE org_node_id = v_node;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (10, 'PASS', 'the org-node share is still visible to a node member');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (10, 'FAIL', format('org-node share returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 11. PRESERVE, the DIRECT sharing path on model templates.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM model_template_collaborations WHERE template_id = v_mtpl AND user_id = v_member;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _tc_results VALUES (11, 'PASS', 'the direct model-template share is still visible to its target');
  ELSE v_fail := v_fail + 1; INSERT INTO _tc_results VALUES (11, 'FAIL', format('direct model share returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM template_collaborations       WHERE template_id IN (v_tpl_org, v_tpl_dir);
  DELETE FROM model_template_collaborations WHERE template_id = v_mtpl;
  DELETE FROM text_templates  WHERE id IN (v_tpl_org, v_tpl_dir);
  DELETE FROM model_templates WHERE id = v_mtpl;
  DELETE FROM org_chart_node_members WHERE node_id = v_node;
  DELETE FROM org_chart_nodes WHERE id = v_node;
  DELETE FROM team_memberships WHERE team_id = v_team;
  DELETE FROM teams WHERE id = v_team;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_member, v_out, v_removed);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_out, v_removed);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 11 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migrations, 1/2/3/4/7 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _tc_results ORDER BY n, result;
