-- =============================================================================
-- Workflow Visibility — tenant isolation and role regression test
--
-- Pins who can see a workflow, for the four roles the product has (creator,
-- collaborator, stakeholder, nobody) across two organizations, and proves that
-- the DATABASE is what restricts it.
--
-- WHY THIS TEST EXISTS
--
-- `src/hooks/workflow/useWorkflowQueries.ts` used to try to express visibility
-- in the frontend:
--
--   .or(`created_by.eq.X,is_public.eq.true,collaborators.user_id.eq.X`)
--
-- PostgREST rejected the whole request with PGRST100 ("failed to parse logic
-- tree"): a dotted name inside or= is read as a json path on a column of the
-- base table, and `workflows` has no `collaborators` column. A top-level or=
-- cannot reference an embedded resource, so there is no spelling of that filter
-- that works. The repair removes it and leaves visibility to RLS.
--
-- That is only safe if RLS really decides. So the shape under test is the
-- REPAIRED query's shape: no org filter, no visibility filter, just
--
--   SELECT ... FROM workflows WHERE parent_workflow_id IS NULL
--
-- which is what the frontend now sends. Assertion 12 runs exactly that.
--
-- THE POLICY UNDER TEST
--
--   SELECT USING (
--     organization_id = current_org_id()
--     AND ( is_public
--        OR created_by = auth.uid()
--        OR user_has_workflow_access(id, auth.uid())
--        OR (parent_workflow_id IS NOT NULL
--            AND user_has_workflow_access(parent_workflow_id, auth.uid())) ) )
--
-- `user_has_workflow_access` covers creator, collaborator
-- (workflow_collaborations), stakeholder (workflow_stakeholders) and
-- public-within-org.
--
-- The organization term is OUTSIDE the disjunction, and that conjunction is
-- load-bearing: the collaborator and stakeholder branches inside the helper
-- carry no organization term of their own, so moving the org term inside the
-- OR would make a cross-org collaboration row into a cross-org read. Assertions
-- 7, 8 and 9 are what would catch that.
--
-- EXECUTED 2026-11-06 against production as a single DO block ending in
-- RAISE EXCEPTION, so the transaction aborted and nothing — not one fixture
-- row — was committed. All 14 assertions passed.
--
-- The same run also measured the live corpus under RLS, as five real users:
--
--   creator + collaborator + stakeholder, current org = A   135 rows, 0 cross-org
--   stakeholder only,                     current org = A    61 rows, 0 cross-org
--   no relationship,                      current org = A    61 rows, 0 cross-org
--   collaborator + stakeholder on A,      current org = B     0 rows
--   stakeholder on A,                     current org = C     0 rows
--   member of no organization                                 0 rows
--   anon                                                      0 rows
--
-- The 61 is exactly 11 public workflows plus 52 branches of public workflows in
-- that organization, out of 144 — so 83 private workflows were denied to a user
-- who is a member of the organization that owns them.
--
-- PROVEN NON-VACUOUS, 2026-11-06
--
-- A second run moved the organization term from outside the disjunction to
-- inside it, which is the most plausible way someone would "fix" a
-- collaborator who cannot see a workflow shared with them:
--
--   USING ( (organization_id = current_org_id() AND is_public)
--        OR created_by = auth.uid()
--        OR user_has_workflow_access(id, auth.uid())
--        OR (parent_workflow_id IS NOT NULL AND user_has_workflow_access(...)) )
--
-- Assertions 7 and 8 flipped to FAIL — the user in org B read org A's private
-- workflow — and the repaired frontend query returned 2 of org A's workflows to
-- them. Assertion 9 still passed, because that one branch kept its org term,
-- which is the precision you want from a test. The policy change and the
-- fixtures were both rolled back by the RAISE; the live policy was re-read
-- afterwards and is unchanged.
--
-- KNOWN GAP, NOT FIXED HERE (assertion 14 documents it)
--
-- `workflow_collaborations` has no organization term in its SELECT policy:
--
--   USING ( user_id = auth.uid()
--        OR invited_by = auth.uid()
--        OR workflow_id IN (SELECT id FROM workflows WHERE created_by = auth.uid()) )
--
-- So a user whose current organization is B still reads their OWN collaboration
-- rows pointing at workflows in organization A — measured at 10 rows for one
-- real user. The workflow itself stays invisible (assertion 7), so what leaks is
-- membership metadata and a workflow id, not workflow content. Changing that
-- policy was explicitly out of scope for the change that added this test.
-- Assertion 14 pins the limit of the leak: it must stay own-rows-only and must
-- never reach a third party's collaboration row in another organization.
--
-- Self-cleaning. 14 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix    text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid;
  v_org_b     uuid;
  v_creator   uuid := gen_random_uuid();   -- org A, owns the private workflows
  v_collab    uuid := gen_random_uuid();   -- org A, collaborator, current org A
  v_stake     uuid := gen_random_uuid();   -- org A, stakeholder,  current org A
  v_norel     uuid := gen_random_uuid();   -- org A, no relationship at all
  v_outsider  uuid := gen_random_uuid();   -- member of A *and* B, current org B
  v_nomember  uuid := gen_random_uuid();   -- member of nothing
  v_wf_priv   uuid;                        -- org A, private, collaborator added
  v_wf_stake  uuid;                        -- org A, private, stakeholder added
  v_wf_pub    uuid;                        -- org A, public
  v_wf_b      uuid;                        -- org B, private
  v_count     int;
  v_pass      int := 0;
  v_fail      int := 0;
BEGIN
  RAISE NOTICE '=== Workflow Visibility Tenant Isolation (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('WFV Org A ' || v_suffix, 'wfv-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('WFV Org B ' || v_suffix, 'wfv-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_creator,  'wfv_c_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_collab,   'wfv_x_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_stake,    'wfv_s_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_norel,    'wfv_n_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outsider, 'wfv_o_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_nomember, 'wfv_m_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  /*
   * The outsider is an ACTIVE member of org A as well as org B, and their
   * CURRENT organization is B. That combination is the whole point: it is not a
   * stranger, it is a legitimate colleague who has switched organizations, and
   * it is what two real production users look like today. If visibility were
   * keyed on membership rather than on the current organization, this user
   * would see org A's workflows from inside org B's app.
   */
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_creator,  'active', false),
    (v_org_a, v_collab,   'active', false),
    (v_org_a, v_stake,    'active', false),
    (v_org_a, v_norel,    'active', false),
    (v_org_a, v_outsider, 'active', false),
    (v_org_b, v_outsider, 'active', false);

  UPDATE users SET current_organization_id = v_org_a
    WHERE id IN (v_creator, v_collab, v_stake, v_norel);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  -- Seeded as the table owner, bypassing RLS, so the fixture does not depend on
  -- the policies under test.
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WFV private collab ' || v_suffix, v_org_a, v_creator, false) RETURNING id INTO v_wf_priv;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WFV private stake ' || v_suffix, v_org_a, v_creator, false) RETURNING id INTO v_wf_stake;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WFV public ' || v_suffix, v_org_a, v_creator, true) RETURNING id INTO v_wf_pub;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('WFV org B private ' || v_suffix, v_org_b, v_outsider, false) RETURNING id INTO v_wf_b;

  -- 'read' and 'admin' are the only values the check constraint admits. The
  -- TypeScript mutation types this as 'read' | 'write' | 'admin' and
  -- user_has_workflow_edit_access reads ('write','admin'), so the 'write' half
  -- of both is unreachable. Recorded, not fixed here.
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by) VALUES
    (v_wf_priv, v_collab,   'admin', v_creator),
    (v_wf_priv, v_outsider, 'admin', v_creator);   -- cross-org collaboration row

  INSERT INTO workflow_stakeholders (workflow_id, user_id, created_by) VALUES
    (v_wf_stake, v_stake,    v_creator),
    (v_wf_stake, v_outsider, v_creator);           -- cross-org stakeholder row

  -- ===========================================================================
  -- 1. anon reads no workflow at all
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM workflows
      WHERE id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no workflow');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s workflow(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. The creator sees their own private workflow
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_creator, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_priv;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'creator sees their private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('creator saw %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 3. A same-org collaborator sees the private workflow they collaborate on
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_collab, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_priv;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'same-org collaborator sees the private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('collaborator saw %s rows, expected 1 — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 4. A same-org stakeholder sees the private workflow they stakehold
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_stake, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_stake;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'same-org stakeholder sees the private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('stakeholder saw %s rows, expected 1 — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 5. A same-org user with no relationship sees NEITHER private workflow.
  --    Membership of the organization that owns a workflow is not access to it.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_norel, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id IN (v_wf_priv, v_wf_stake);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'org member with no relationship sees no private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('unrelated org member read %s private workflow(s)', v_count)); END IF;

  -- ===========================================================================
  -- 6. ...but DOES see the public one. The product side: a tighter policy that
  --    broke this would be reverted.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_norel, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_pub;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'unrelated org member still sees the public workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('public workflow invisible to an org member (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 7. THE MONEY ASSERTION. A collaborator whose CURRENT organization is B
  --    reads nothing of org A's private workflow, even though the
  --    collaboration row exists and they are an active member of org A.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_priv;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'cross-org collaborator cannot read org A''s private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('CROSS-ORG READ: collaborator in org B read %s org A workflow(s)', v_count)); END IF;

  -- ===========================================================================
  -- 8. Same, through the stakeholder branch.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_stake;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'cross-org stakeholder cannot read org A''s private workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('CROSS-ORG READ: stakeholder in org B read %s org A workflow(s)', v_count)); END IF;

  -- ===========================================================================
  -- 9. "Public" means public WITHIN the organization. The outsider does not get
  --    org A's public workflow from inside org B either.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_pub;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'a public workflow is public only within its own organization');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', format('CROSS-ORG READ: org A public workflow visible from org B (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 10. A user who is a member of no organization reads nothing. current_org_id()
  --     returns NULL and `organization_id = NULL` is never true, so the failure
  --     mode is zero rows rather than every row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_nomember, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows
      WHERE id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'a member of no organization reads no workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('non-member read %s workflow(s)', v_count)); END IF;

  -- ===========================================================================
  -- 11. WRITE. A cross-org collaborator with 'admin' permission cannot update
  --     org A's workflow. A read-only check would miss this entirely.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE workflows SET description = 'written from org B' WHERE id = v_wf_priv;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'cross-org collaborator cannot write org A''s workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('CROSS-ORG WRITE: %s row(s) updated from org B', v_count)); END IF;

  -- ===========================================================================
  -- 12. The REPAIRED query shape, sent verbatim by useWorkflowQueries: no
  --     organization filter, no visibility filter, only the top-level clause.
  --     The creator gets 2 of their own private workflows plus the public one;
  --     the unrelated member gets the public one alone.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_norel, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows
      WHERE parent_workflow_id IS NULL
        AND id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (12, 'PASS', 'the unfiltered repaired query returns only the public workflow to an unrelated member');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (12, 'FAIL', format('the repaired query returned %s rows to an unrelated member, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 13. The repaired collaborators embed. Reading `workflows` with
  --     collaborations embedded must not hand the creator a collaboration row
  --     belonging to another organization's workflow — the embed goes through
  --     workflow_collaborations' own policy, which has no org term.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_creator, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations wc
      JOIN workflows w ON w.id = wc.workflow_id
      WHERE w.organization_id <> v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (13, 'PASS', 'the collaborations embed reaches no other organization''s workflow');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (13, 'FAIL', format('embed exposed %s collaboration row(s) on another org''s workflow', v_count)); END IF;

  -- ===========================================================================
  -- 14. The limit of the known gap. workflow_collaborations has no org term, so
  --     the outsider DOES read their own cross-org collaboration row. What must
  --     stay true is that it is own-rows-only: they must not reach the
  --     collaboration row of a THIRD party on the same org A workflow.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflow_collaborations
      WHERE workflow_id = v_wf_priv AND user_id <> v_outsider;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (14, 'PASS', 'cross-org collaborator reads only their own collaboration row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (14, 'FAIL', format('cross-org collaborator read %s third-party collaboration row(s)', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM workflow_stakeholders WHERE workflow_id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
  DELETE FROM workflow_collaborations WHERE workflow_id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
  DELETE FROM workflows WHERE id IN (v_wf_priv, v_wf_stake, v_wf_pub, v_wf_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
    WHERE id IN (v_creator, v_collab, v_stake, v_norel, v_outsider, v_nomember);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_creator, v_collab, v_stake, v_norel, v_outsider, v_nomember);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 14 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
