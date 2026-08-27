-- =============================================================================
-- quick_thoughts Tenant Isolation — security regression test
--
-- Proves the boundary established by:
--   20260827090100  legacy backfill + quarantine + NOT NULL constraint
--   20260827090200  organization_id derived server-side, then immutable
--   20260827090300  the platform-admin-only cross-org Ops RPC
--   20260827090400  tenant-aware policies, anon loses the table
--
-- Run it BEFORE those migrations to watch it fail and after to watch it pass;
-- a passing run on its own proves only that the test is not wired to anything.
-- Before remediation, expect at minimum assertions 1, 2, 3, 7, 8, 9, 10 and 15
-- to fail — those are the open doors.
--
-- Each read probe assumes the `authenticated` role and forges a JWT claim the
-- way PostgREST presents a request, then drops back immediately. Reads made as
-- the owning role would bypass RLS entirely and prove nothing.
--
-- Self-cleaning. 16 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix      text := substr(md5(random()::text), 1, 8);
  v_org_a       uuid;
  v_org_b       uuid;
  v_user_a      uuid := gen_random_uuid();   -- org A author
  v_user_a2     uuid := gen_random_uuid();   -- org A colleague, shares an org A project
  v_user_b      uuid := gen_random_uuid();   -- member of BOTH orgs; shares only an org B project
  v_admin       uuid := gen_random_uuid();   -- platform admin
  v_proj_a      uuid;
  v_proj_b      uuid;
  v_node_a      uuid;
  v_th_private  uuid;
  v_th_public   uuid;
  v_th_team     uuid;
  v_th_orgnode  uuid;
  v_count       int;
  v_num         bigint;
  v_pass        int := 0;
  v_fail        int := 0;
BEGIN
  RAISE NOTICE '=== quick_thoughts Tenant Isolation (suffix: %) ===', v_suffix;

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('QT Org A ' || v_suffix, 'qt-a-' || v_suffix)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('QT Org B ' || v_suffix, 'qt-b-' || v_suffix)
    RETURNING id INTO v_org_b;

  -- handle_new_user() mirrors each auth user into public.users.
  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'qt_a_'     || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'qt_a2_'    || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'qt_b_'     || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_admin,   'qt_admin_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_a, v_user_b,  'active', false),   -- dual member: lets us isolate the project-org check
    (v_org_b, v_user_b,  'active', false),
    (v_org_b, v_admin,   'active', false);

  INSERT INTO platform_admins (user_id) VALUES (v_admin);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2, v_user_b);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_admin;

  -- A shared project inside org A: the legitimate team relationship.
  --
  -- `created_by` is not decoration. The team policy's self-join reads
  -- project_assignments, whose own SELECT policy is
  --   assigned_to = auth.uid() OR project_id IN (projects I created)
  -- so a reader can only see the AUTHOR's assignment row if they created the
  -- project. Without this the team probes return zero for a reason that has
  -- nothing to do with tenancy, and the assertions would pass vacuously.
  INSERT INTO projects (title, organization_id, created_by)
    VALUES ('QT Proj A ' || v_suffix, v_org_a, v_user_a2) RETURNING id INTO v_proj_a;

  -- A shared project inside org B between the same author and user_b. user_b
  -- will stand in org A, so the ONLY thing that can deny them is the policy's
  -- requirement that the shared project belong to the row's organization.
  INSERT INTO projects (title, organization_id, created_by)
    VALUES ('QT Proj B ' || v_suffix, v_org_b, v_user_b) RETURNING id INTO v_proj_b;

  -- Some environments carry a notify_project_assignment() that writes a
  -- notification with a NULL message, which its own NOT NULL constraint then
  -- rejects. Nothing here is under test, so silence it for the inserts and put
  -- it back. Guarded: the trigger does not exist everywhere.
  BEGIN
    ALTER TABLE public.project_assignments DISABLE TRIGGER project_assignment_notification;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  INSERT INTO project_assignments (project_id, assigned_to) VALUES (v_proj_a, v_user_a), (v_proj_a, v_user_a2);
  INSERT INTO project_assignments (project_id, assigned_to) VALUES (v_proj_b, v_user_a), (v_proj_b, v_user_b);

  BEGIN
    ALTER TABLE public.project_assignments ENABLE TRIGGER project_assignment_notification;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  INSERT INTO org_chart_nodes (organization_id, node_type, name)
    VALUES (v_org_a, 'team', 'QT Node ' || v_suffix) RETURNING id INTO v_node_a;
  INSERT INTO org_chart_node_members (node_id, user_id, role) VALUES (v_node_a, v_user_a2, 'member');

  -- Fixtures written the way the application writes them: as the author, in a
  -- session. Not as the owner — `enforce_quick_thought_org_boundary()` resolves
  -- visibility_org_node_id against `current_org_id()`, which is NULL outside a
  -- session, so an owner-written org-node row is rejected outright. Writing
  -- them in-session also means organization_id is derived rather than asserted,
  -- which is the behaviour under test.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  INSERT INTO quick_thoughts (created_by, content, visibility)
    VALUES (v_user_a, 'qt private ' || v_suffix, 'private') RETURNING id INTO v_th_private;
  INSERT INTO quick_thoughts (created_by, content, visibility)
    VALUES (v_user_a, 'qt public ' || v_suffix, 'public') RETURNING id INTO v_th_public;
  INSERT INTO quick_thoughts (created_by, content, visibility)
    VALUES (v_user_a, 'qt team ' || v_suffix, 'team') RETURNING id INTO v_th_team;
  INSERT INTO quick_thoughts (created_by, content, visibility, visibility_org_node_id)
    VALUES (v_user_a, 'qt node ' || v_suffix, 'organization', v_node_a) RETURNING id INTO v_th_orgnode;

  -- Drop the role AND the claim. RESET ROLE alone leaves auth.uid() populated,
  -- which silently keeps later "owner" statements running as this user.
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 1. anon has no access to the table at all
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE created_by = v_user_a;
    RESET ROLE;
    IF v_count = 0 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] anon reads zero rows';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] anon read % row(s) — public thoughts are internet-readable', v_count;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] anon refused at the grant (SELECT revoked)';
  WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] anon refused (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 2. Org B cannot read Org A's PUBLIC thought
  -- ===========================================================================
  BEGIN
    UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_public;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] org B cannot read org A public thought';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] org B read org A public thought (count %)', v_count; END IF;

  -- ===========================================================================
  -- 3. Org B cannot read Org A's TEAM thought
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_team;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] org B cannot read org A team thought';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3] org B read org A team thought (count %)', v_count; END IF;

  -- ===========================================================================
  -- 4. Same-org colleague CAN read the workspace ('public') thought
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_public;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] same-org workspace thought is readable';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] same-org workspace thought NOT readable (count %)', v_count; END IF;

  -- ===========================================================================
  -- 5. Same-org shared project CAN read the team thought
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_team;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [5] same-org project relationship grants team read';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] same-org team thought NOT readable (count %)', v_count; END IF;

  -- ===========================================================================
  -- 6. Private is author-only, even inside the same org
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_private;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [6a] same-org colleague cannot read a private thought';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6a] private thought leaked to a colleague (count %)', v_count; END IF;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_private;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [6b] the author still reads their own private thought';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6b] author cannot read own private thought (count %)', v_count; END IF;

  -- ===========================================================================
  -- 7. A cross-org project relationship does NOT bypass the boundary
  --    user_b stands in org A and shares a project with the author — but that
  --    project belongs to org B, which is the only thing denying them.
  -- ===========================================================================
  BEGIN
    UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_b;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_team;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] a foreign-org shared project does not grant team read';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7] cross-org project relationship bypassed the boundary (count %)', v_count; END IF;

  -- ===========================================================================
  -- 8. A forged organization_id on INSERT is refused
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO quick_thoughts (created_by, content, visibility, organization_id)
      VALUES (v_user_a, 'qt forged ' || v_suffix, 'private', v_org_b);
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8] wrote a row into a foreign organization';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] forged organization_id refused (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 9. organization_id cannot be moved to another org after insert
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE quick_thoughts SET organization_id = v_org_b WHERE id = v_th_private;
    RESET ROLE;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_private AND organization_id = v_org_b;
    IF v_count = 0 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] update did not move the row (no rows matched)';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9] organization_id was moved to another org';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] moving organization_id refused (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 10. organization_id cannot be cleared
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE quick_thoughts SET organization_id = NULL WHERE id = v_th_private;
    RESET ROLE;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_private AND organization_id IS NULL;
    IF v_count = 0 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] organization_id was not cleared';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] organization_id cleared — row is now readable by nobody and scoped to nothing';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] clearing organization_id refused (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 11. A normal session insert is stamped, never NULL, and never needs to ask
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO quick_thoughts (created_by, content, visibility)
      VALUES (v_user_a, 'qt derived ' || v_suffix, 'private');
    RESET ROLE;
    SELECT count(*) INTO v_count FROM quick_thoughts
      WHERE content = 'qt derived ' || v_suffix AND organization_id = v_org_a;
    IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] organization_id derived from session context';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] insert not stamped with the caller org (count %)', v_count; END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] ordinary insert was rejected (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 12. The CHECK constraint refuses a NULL organization_id outright
  -- ===========================================================================
  BEGIN
    -- Explicitly unauthenticated. A claim left over from the probe above would
    -- put this on the trigger's session branch, which derives an organization
    -- and makes the row succeed — passing the assertion for the wrong reason.
    SET LOCAL request.jwt.claims = '';
    INSERT INTO quick_thoughts (created_by, content, visibility, organization_id)
      VALUES (v_user_a, 'qt null org ' || v_suffix, 'private', NULL);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] a NULL organization_id row was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] NULL organization_id refused (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- 13. The 'organization' tier reads back for a node member, and only them
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_orgnode;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [13a] org-node member reads an ''organization'' thought';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13a] org-node thought unreadable by its node member (count %)', v_count; END IF;

  BEGIN
    UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_b;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM quick_thoughts WHERE id = v_th_orgnode;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [13b] same-org non-member of the node cannot read it';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13b] org-node thought leaked to a non-member (count %)', v_count; END IF;

  -- ===========================================================================
  -- 14. The Ops RPC works for a platform admin, and returns no content column
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT sum(thought_count) INTO v_num
      FROM ops_quick_thought_activity(ARRAY[v_user_a]::uuid[], NULL, NULL, false);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_num := -1;
  END;
  -- The admin stands in org B; every fixture row belongs to org A. A result
  -- above zero is therefore proof the RPC crossed the tenant boundary on
  -- purpose, which is the whole point of it existing.
  IF v_num >= 4 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [14] platform admin reads cross-org activity (% rows counted)', v_num;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [14] ops RPC returned % for a platform admin', v_num; END IF;

  -- ===========================================================================
  -- 15. An ordinary user cannot use the Ops RPC — and gets an error, not a
  --     quietly narrowed answer
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT sum(thought_count) INTO v_num
      FROM ops_quick_thought_activity(NULL, NULL, NULL, false);
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [15] ordinary user called the ops RPC and got %', v_num;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [15] ordinary user refused by the ops RPC (%)', SQLSTATE;
  END;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  -- Teardown runs as the owner; make sure it really is unauthenticated.
  SET LOCAL request.jwt.claims = '';
  DELETE FROM quick_thoughts WHERE created_by IN (v_user_a, v_user_a2, v_user_b, v_admin);
  DELETE FROM org_chart_node_members WHERE node_id = v_node_a;
  DELETE FROM org_chart_nodes WHERE id = v_node_a;
  DELETE FROM project_assignments WHERE project_id IN (v_proj_a, v_proj_b);
  DELETE FROM projects WHERE id IN (v_proj_a, v_proj_b);
  DELETE FROM platform_admins WHERE user_id = v_admin;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
    WHERE id IN (v_user_a, v_user_a2, v_user_b, v_admin);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b, v_admin);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 16 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'QUICK_THOUGHTS TENANT ISOLATION TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
