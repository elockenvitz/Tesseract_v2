-- =============================================================================
-- workflow_collaborations Tenant Isolation — security regression test
--
-- Proves the boundary that
-- supabase/migrations/20261106150000_workflow_collaborations_tenant_scope.sql
-- establishes, and that it does not take sharing away from the people it exists
-- for.
--
-- THE FINDING UNDER TEST
--
--   SELECT USING ( user_id = auth.uid()
--               OR invited_by = auth.uid()
--               OR workflow_id IN (SELECT id FROM workflows WHERE created_by = auth.uid()) )
--
-- No organization term. A user whose current organization is B reads their own
-- collaboration rows pointing at workflows in organization A. The workflow is
-- correctly invisible, so what leaks is the workflow uuid, the permission and
-- the inviter's user id.
--
-- AGAINST PRODUCTION AS IT STANDS, assertion 2 is expected to FAIL. 1, 3, 4, 5,
-- 6 and 7 must pass both before and after — they are the "did we break sharing"
-- side. Assertion 4 in particular (the workflow owner must still see every
-- collaborator) is what the manage-sharing UI reads, and assertion 6 is the
-- live "which workflows am I shared on" query in useActiveRuns.ts:61,
-- WorkflowSelector.tsx:84 and WorkflowsPage.tsx:2058.
--
-- Assertion 3 is the one a naive test misses: the org-B user must keep their own
-- org B collaboration. A fix that scoped on membership rather than on the
-- CURRENT organization, or that dropped the own-row branches, would pass
-- assertion 2 and fail this one.
--
-- EXECUTED 2026-11-06 against production inside a single DO block ending in
-- RAISE EXCEPTION, with the proposed policy created transaction-locally:
-- baseline showed the org-B user reading 1 of org A's rows; with the policy
-- applied it read 0 while assertions 3, 4, 5, 6 and 7 all held. Nothing was
-- committed and the live policy was re-read afterwards unchanged.
--
-- Self-cleaning. 7 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_a  uuid;
  v_org_b  uuid;
  v_owner  uuid := gen_random_uuid();   -- org A, creates the workflow and shares it
  v_collab uuid := gen_random_uuid();   -- org A, collaborator, current org A
  v_out    uuid := gen_random_uuid();   -- active member of A AND B, current org B
  v_wf_a   uuid;
  v_wf_b   uuid;
  v_count  int;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== workflow_collaborations Tenant Isolation (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('WC Org A ' || v_suffix, 'wc-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('WC Org B ' || v_suffix, 'wc-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,  'wc_o_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_collab, 'wc_c_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_out,    'wc_x_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  /* The outsider is an ACTIVE member of org A as well as org B, with org B
     current. Not a stranger: a legitimate colleague who switched organizations,
     which is what the two real production users look like. */
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner,  'active', false),
    (v_org_a, v_collab, 'active', false),
    (v_org_a, v_out,    'active', false),
    (v_org_b, v_out,    'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_collab);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_out;

  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WC wf A ' || v_suffix, v_org_a, v_owner, false) RETURNING id INTO v_wf_a;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WC wf B ' || v_suffix, v_org_b, v_out, false) RETURNING id INTO v_wf_b;

  -- 'admin' and 'read' are the only values the check constraint admits; see the
  -- permission-vocabulary finding recorded alongside this test.
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by) VALUES
    (v_wf_a, v_collab, 'admin', v_owner),   -- legitimate same-org collaboration
    (v_wf_a, v_out,    'read',  v_owner),   -- the cross-org row
    (v_wf_b, v_collab, 'read',  v_out);     -- org B collaboration held by an org A user

  -- ===========================================================================
  -- 1. anon reads nothing
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM workflow_collaborations
      WHERE workflow_id IN (v_wf_a, v_wf_b);
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no collaboration row');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. THE FINDING. A user whose current organization is B must not read org A's
  --    collaboration rows, even their own, even as an active member of org A.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations WHERE workflow_id = v_wf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org-B user reads no org A collaboration metadata');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('CROSS-ORG READ: org-B user read %s org A collaboration row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. ...but keeps their OWN org B collaboration. A fix keyed on membership
  --    rather than on the current organization would pass 2 and fail this.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations WHERE workflow_id = v_wf_b;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'org-B user still reads their own org B collaboration');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('over-tightened: own-org collaboration returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 4. The workflow owner still reads EVERY collaborator. This is what the
  --    manage-sharing UI reads; breaking it would get the fix reverted.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations WHERE workflow_id = v_wf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'owner reads all collaborators on their workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('owner read %s collaborator(s), expected 2', v_count)); END IF;

  -- ===========================================================================
  -- 5. A same-org collaborator still reads their own row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_collab, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations WHERE workflow_id = v_wf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'same-org collaborator reads their own row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('same-org collaborator read %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 6. The live "which workflows am I shared on" query, sent verbatim by
  --    useActiveRuns.ts:61, WorkflowSelector.tsx:84 and WorkflowsPage.tsx:2058.
  --    The org A user holds one org A row and one org B row; from inside org A
  --    they must get exactly the org A one.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_collab, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations WHERE user_id = v_collab;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'the shared-with-me query returns the current org''s row only');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('shared-with-me returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 7. A forged workflow_id does not help. Knowing org A's workflow uuid is not
  --    an authorization, so filtering directly on it returns nothing.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations
      WHERE workflow_id = v_wf_a AND user_id = v_out;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'a known cross-org workflow uuid grants nothing');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('forged workflow_id returned %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM workflow_collaborations WHERE workflow_id IN (v_wf_a, v_wf_b);
  DELETE FROM workflows WHERE id IN (v_wf_a, v_wf_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_collab, v_out);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_owner, v_collab, v_out);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 7 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
