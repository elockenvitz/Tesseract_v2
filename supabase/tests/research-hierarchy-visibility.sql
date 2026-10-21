-- ═══════════════════════════════════════════════════════════════════════════
--  Research visibility — inherited membership across a real org chart
--
--  Regression coverage for scripts/sql/research-hierarchy/10-effective-membership.sql.
--
--  The fixture, in org A:
--
--      Division  D
--        └── Department  P1            └── Department  P2
--              ├── Team  T1                  └── Team  T3
--              └── Team  T2
--
--    u_t1   member of T1 only
--    u_t2   member of T2 only          (sibling of T1 under the same P1)
--    u_t3   member of T3 only          (different department, same division)
--    u_p1   member of P1 only          (parent-only: no team membership)
--    u_div  member of D only           (division-only)
--    u_multi member of T1 AND T3       (two memberships, two departments)
--    u_out  org B                      (cross-organization)
--
--  Effective membership is DIRECT plus ANCESTORS, so u_t1's set is {T1,P1,D}
--  and u_p1's is {P1,D}. Sharing with a node reaches everyone whose effective
--  set contains it — which is the node's direct members and everyone beneath.
--
--  ── NON-VACUITY ────────────────────────────────────────────────────────────
--
--  Run BEFORE the migration and expect 15 PASS / 5 FAIL, measured.
--
--    3, 4, 14, 15  the predicate matches the targeted node EXACTLY, so no
--                  descendant inherits anything.
--    17            the RPC validates existence, tenancy and scope but never
--                  membership, so an author can target any group in the org.
--
--  Everything else already holds and must KEEP holding: direct membership,
--  siblings, parent-only, cross-org, and the empty-audience rule. A migration
--  that turned any of those red would be widening access, not inheriting it.
--
--  Assertions 17, 19 and 20 treat 42883 as a FAILURE rather than a refusal.
--  A missing function refuses everything, and scoring that as a passing
--  boundary is how a suite reports green on an absent feature.
--
--  ── Production safety ──────────────────────────────────────────────────────
--
--  Writes synthetic 'ZZ ' fixtures and cleans up unconditionally in reverse
--  dependency order. One statement, so one transaction. Must run as `postgres`
--  — SET ROLE authenticated requires it.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS _rh_results;
CREATE TEMP TABLE _rh_results(n int, result text, detail text);

DO $$
DECLARE
  v_sfx   text := substr(md5(random()::text), 1, 8);
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_D  uuid := gen_random_uuid();   -- division
  v_P1 uuid := gen_random_uuid();   -- department under D
  v_P2 uuid := gen_random_uuid();   -- department under D
  v_T1 uuid := gen_random_uuid();   -- team under P1
  v_T2 uuid := gen_random_uuid();   -- team under P1 (sibling of T1)
  v_T3 uuid := gen_random_uuid();   -- team under P2
  v_B  uuid := gen_random_uuid();   -- org B department
  u_t1 uuid := gen_random_uuid();
  u_t2 uuid := gen_random_uuid();
  u_t3 uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid();
  u_div uuid := gen_random_uuid();
  u_multi uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  u_auth uuid := gen_random_uuid();  -- the author, member of T1
  c_dept uuid;    -- contribution shared with P1
  c_team uuid;    -- contribution shared with T1
  c_div  uuid;    -- contribution shared with D
  v_n int; v_pass int := 0; v_fail int := 0; v_state text;
BEGIN
  RAISE NOTICE '=== Research hierarchy visibility (suffix: %) ===', v_sfx;

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id) VALUES
    (u_t1),(u_t2),(u_t3),(u_p1),(u_div),(u_multi),(u_out),(u_auth);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a,'ZZ RH A '||v_sfx,'zz-rh-a-'||v_sfx),
    (v_org_b,'ZZ RH B '||v_sfx,'zz-rh-b-'||v_sfx);
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a,u_t1,'active'),(v_org_a,u_t2,'active'),(v_org_a,u_t3,'active'),
    (v_org_a,u_p1,'active'),(v_org_a,u_div,'active'),(v_org_a,u_multi,'active'),
    (v_org_a,u_auth,'active'),(v_org_b,u_out,'active');
  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (u_t1,u_t2,u_t3,u_p1,u_div,u_multi,u_auth);
  UPDATE users SET current_organization_id = v_org_b WHERE id = u_out;

  INSERT INTO assets(id, symbol, company_name)
  VALUES (v_asset,'ZZR'||v_sfx,'ZZ Research Hier Co '||v_sfx);

  INSERT INTO org_chart_nodes(id, organization_id, parent_id, node_type, name) VALUES
    (v_D , v_org_a, NULL , 'division'  , 'ZZ Div '||v_sfx),
    (v_P1, v_org_a, v_D  , 'department', 'ZZ Dept One '||v_sfx),
    (v_P2, v_org_a, v_D  , 'department', 'ZZ Dept Two '||v_sfx),
    (v_T1, v_org_a, v_P1 , 'team'      , 'ZZ Team One '||v_sfx),
    (v_T2, v_org_a, v_P1 , 'team'      , 'ZZ Team Two '||v_sfx),
    (v_T3, v_org_a, v_P2 , 'team'      , 'ZZ Team Three '||v_sfx),
    (v_B , v_org_b, NULL , 'department', 'ZZ Dept B '||v_sfx);

  INSERT INTO org_chart_node_members(node_id, user_id, role) VALUES
    (v_T1,u_t1,'member'), (v_T2,u_t2,'member'), (v_T3,u_t3,'member'),
    (v_P1,u_p1,'member'), (v_D ,u_div,'member'),
    (v_T1,u_multi,'member'), (v_T3,u_multi,'member'),
    (v_T1,u_auth,'member'),
    (v_B ,u_out,'member');

  -- Three contributions by the same author, one per scope.
  INSERT INTO asset_contributions(asset_id, section, content, created_by, organization_id, visibility)
  VALUES (v_asset,'thesis','ZZ dept-scoped '||v_sfx, u_auth, v_org_a, 'department')
  RETURNING id INTO c_dept;
  INSERT INTO asset_contributions(asset_id, section, content, created_by, organization_id, visibility)
  VALUES (v_asset,'risks','ZZ team-scoped '||v_sfx, u_auth, v_org_a, 'team')
  RETURNING id INTO c_team;
  INSERT INTO asset_contributions(asset_id, section, content, created_by, organization_id, visibility)
  VALUES (v_asset,'catalysts','ZZ div-scoped '||v_sfx, u_auth, v_org_a, 'division')
  RETURNING id INTO c_div;

  INSERT INTO contribution_visibility_targets(contribution_id, node_id, organization_id) VALUES
    (c_dept, v_P1, v_org_a),
    (c_team, v_T1, v_org_a),
    (c_div , v_D , v_org_a);

  -- ═══════════════════════════════════════════════════════════════════════
  -- Reader assertions. Each one checks BOTH server paths and requires them
  -- to agree; `expected` is 1 when the user should read the contribution.
  -- ═══════════════════════════════════════════════════════════════════════
  DECLARE
    r record;
    v_policy int; v_fn boolean;
  BEGIN
    FOR r IN
      SELECT * FROM (VALUES
        -- n, user,     contribution, expected, what it proves
        ( 1, u_auth , 'dept', 1, 'the author always reads their own'),
        ( 2, u_p1   , 'dept', 1, 'DIRECT member of the targeted department'),
        ( 3, u_t1   , 'dept', 1, 'DESCENDANT: team member reads department research'),
        ( 4, u_t2   , 'dept', 1, 'DESCENDANT: the sibling team is also beneath P1'),
        ( 5, u_div  , 'dept', 0, 'ANCESTOR-only member is NOT included downward'),
        ( 6, u_t3   , 'dept', 0, 'another department''s team is outside P1'),
        ( 7, u_out  , 'dept', 0, 'CROSS-ORG is refused'),
        ( 8, u_t1   , 'team', 1, 'DIRECT member of the targeted team'),
        ( 9, u_t2   , 'team', 0, 'SIBLING team does not inherit sideways'),
        (10, u_p1   , 'team', 0, 'PARENT-only member does not inherit downward'),
        (11, u_div  , 'team', 0, 'DIVISION-only member does not inherit downward'),
        (12, u_out  , 'team', 0, 'CROSS-ORG is refused'),
        (13, u_div  , 'div' , 1, 'DIRECT member of the targeted division'),
        (14, u_t3   , 'div' , 1, 'two levels down: team → department → division'),
        (15, u_multi, 'div' , 1, 'MULTIPLE memberships resolve through either branch'),
        (18, u_out  , 'div' , 0, 'CROSS-ORG is refused at the top of the tree')
      ) AS t(n, usr, which, expected, detail)
    LOOP
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', r.usr, 'role','authenticated')::text);
      SET ROLE authenticated;
      SELECT count(*) INTO v_policy FROM asset_contributions
       WHERE id = CASE r.which WHEN 'dept' THEN c_dept WHEN 'team' THEN c_team ELSE c_div END;
      SELECT public.can_read_asset_contribution(
               CASE r.which WHEN 'dept' THEN c_dept WHEN 'team' THEN c_team ELSE c_div END)
        INTO v_fn;
      RESET ROLE;

      IF v_policy <> r.expected::int THEN
        INSERT INTO _rh_results VALUES (r.n,'FAIL','policy: '||r.detail||' (saw '||v_policy||', wanted '||r.expected||')');
        v_fail := v_fail+1;
      ELSIF v_fn <> (r.expected = 1) THEN
        INSERT INTO _rh_results VALUES (r.n,'FAIL','SPLIT — policy agreed but can_read_asset_contribution did not: '||r.detail);
        v_fail := v_fail+1;
      ELSE
        INSERT INTO _rh_results VALUES (r.n,'PASS',r.detail);
        v_pass := v_pass+1;
      END IF;
      SET LOCAL request.jwt.claims = '';
    END LOOP;
  END;

  -- ═══════════════════════════════════════════════ author eligibility ══
  -- 16. The author may target an ANCESTOR of a team they belong to.
  --     u_auth is in T1, so P1 and D are effective memberships.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', u_auth, 'role','authenticated')::text);
    PERFORM public.set_contribution_audience(c_team, 'department', ARRAY[v_P1]);
    SET LOCAL request.jwt.claims = '';
    SELECT count(*) INTO v_n FROM contribution_visibility_targets
     WHERE contribution_id = c_team AND node_id = v_P1;
    IF v_n = 1 THEN
      INSERT INTO _rh_results VALUES (16,'PASS','author may target their parent department');
      v_pass := v_pass+1;
    ELSE
      INSERT INTO _rh_results VALUES (16,'FAIL','the ancestor target was not stored');
      v_fail := v_fail+1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    SET LOCAL request.jwt.claims = '';
    INSERT INTO _rh_results VALUES (16,'FAIL','refused a legitimate ancestor: '||SQLSTATE||' '||SQLERRM);
    v_fail := v_fail+1;
  END;

  -- 17. The author may NOT target a department they are not under.
  --     u_auth is in T1 (under P1); P2 is a different branch.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', u_auth, 'role','authenticated')::text);
    PERFORM public.set_contribution_audience(c_dept, 'department', ARRAY[v_P2]);
    SET LOCAL request.jwt.claims = '';
    INSERT INTO _rh_results VALUES (17,'FAIL','author targeted a department they do not belong to');
    v_fail := v_fail+1;
  EXCEPTION WHEN OTHERS THEN
    SET LOCAL request.jwt.claims = '';
    v_state := SQLSTATE;
    IF v_state = '42883' THEN
      INSERT INTO _rh_results VALUES (17,'FAIL','the RPC is not installed (42883) — not a security result');
      v_fail := v_fail+1;
    ELSE
      INSERT INTO _rh_results VALUES (17,'PASS','ineligible department refused ('||v_state||')');
      v_pass := v_pass+1;
    END IF;
  END;

  -- 19. An empty restricted audience is still refused (rule unchanged).
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', u_auth, 'role','authenticated')::text);
    PERFORM public.set_contribution_audience(c_dept, 'department', ARRAY[]::uuid[]);
    SET LOCAL request.jwt.claims = '';
    INSERT INTO _rh_results VALUES (19,'FAIL','an empty department audience was accepted');
    v_fail := v_fail+1;
  EXCEPTION WHEN OTHERS THEN
    SET LOCAL request.jwt.claims = '';
    v_state := SQLSTATE;
    IF v_state = '42883' THEN
      -- A missing function refuses everything. Counting that as a passing
      -- security boundary is how a suite reports green on an absent feature.
      INSERT INTO _rh_results VALUES (19,'FAIL','the RPC is not installed (42883) — not a security result');
      v_fail := v_fail+1;
    ELSE
      INSERT INTO _rh_results VALUES (19,'PASS','empty restricted audience refused ('||v_state||')');
      v_pass := v_pass+1;
    END IF;
  END;

  -- 20. Cross-org at the RPC: the author cannot target org B's node.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', u_auth, 'role','authenticated')::text);
    PERFORM public.set_contribution_audience(c_dept, 'department', ARRAY[v_B]);
    SET LOCAL request.jwt.claims = '';
    INSERT INTO _rh_results VALUES (20,'FAIL','the author targeted another organization''s node');
    v_fail := v_fail+1;
  EXCEPTION WHEN OTHERS THEN
    SET LOCAL request.jwt.claims = '';
    v_state := SQLSTATE;
    IF v_state = '42883' THEN
      INSERT INTO _rh_results VALUES (20,'FAIL','the RPC is not installed (42883) — not a security result');
      v_fail := v_fail+1;
    ELSE
      INSERT INTO _rh_results VALUES (20,'PASS','cross-org node refused ('||v_state||')');
      v_pass := v_pass+1;
    END IF;
  END;

  -- ═══════════════════════════════════════════════════════════ CLEANUP ══
  SET LOCAL request.jwt.claims = '';
  DELETE FROM contribution_visibility_targets WHERE contribution_id IN (c_dept,c_team,c_div);
  DELETE FROM asset_contributions WHERE id IN (c_dept,c_team,c_div);
  DELETE FROM org_chart_node_members WHERE node_id IN (v_D,v_P1,v_P2,v_T1,v_T2,v_T3,v_B);
  DELETE FROM org_chart_nodes WHERE id IN (v_T1,v_T2,v_T3,v_P1,v_P2,v_D,v_B);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a,v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (u_t1,u_t2,u_t3,u_p1,u_div,u_multi,u_out,u_auth);
  DELETE FROM organizations WHERE id IN (v_org_a,v_org_b);
  DELETE FROM list_statuses WHERE list_id IN (
    SELECT id FROM asset_lists WHERE created_by IN (u_t1,u_t2,u_t3,u_p1,u_div,u_multi,u_out,u_auth));
  DELETE FROM asset_lists WHERE created_by IN (u_t1,u_t2,u_t3,u_p1,u_div,u_multi,u_out,u_auth);
  DELETE FROM auth.users WHERE id IN (u_t1,u_t2,u_t3,u_p1,u_div,u_multi,u_out,u_auth);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 20 ===', v_pass, v_fail;
  RAISE NOTICE 'AFTER the migration: expect 20 passed, 0 failed.';
  RAISE NOTICE 'BEFORE it: expect 15 passed, 5 failed — 3, 4, 14, 15 (inheritance) and 17 (author eligibility).';
END $$;

SELECT n, result, detail FROM _rh_results ORDER BY n;
