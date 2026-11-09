-- =============================================================================
-- Asset-page layout access — security regression test
--
-- Guards the fix in 20261109180000_fix_layout_access_anon_exposure.sql and the
-- drop in 20261109180001_drop_save_asset_content.sql.
--
-- The defect: `user_has_layout_access`'s final "organization-wide" branch
-- never referenced p_user_id and never mentioned an organization, and
-- `layout_collab_view_own` carried the same mistake inline as a bare
-- `(user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL)` disjunct.
-- Either one alone made a layout with an org-wide share readable by ANY
-- caller — including the real `anon` role, i.e. anyone holding the
-- publishable key that ships in the browser bundle.
--
-- Uses ACTUAL database roles (`authenticated`, `anon`) and a real
-- request.jwt.claims context, so RLS, role grants, policy dependencies and
-- the definer function are all exercised together. Application-level
-- filtering is not involved and would not be sufficient: every defect this
-- guards is a database path that returns rows the client never asked to hide.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE the two migrations:
--       6 PASS, 7 FAIL — assertions 1, 2, 3, 9, 10, 11 and 13 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--
--   AFTER both migrations:
--       13 PASS, 0 FAIL.
--
-- Assertions 4, 5, 6, 7, 8 and 12 pass in BOTH states by design. They are the
-- preserve-legitimate-access controls, and a fix that breaks one is too
-- tight. 8 and 12 specifically guard against over-tightening: 8 proves a
-- same-org member does NOT get a layout that was never shared org-wide, and
-- 12 proves the view/edit ladder still discriminates.
--
-- ── Why the organization is derived from membership ─────────────────────────
--
-- Neither `user_asset_page_layouts` nor `layout_collaborations` has an
-- organization_id column (their theme twins do). So "same organization" can
-- only mean: the caller and the layout's owner are both ACTIVE, unexpired
-- members of one common organization. Assertion 11 is what makes that
-- meaningful — a member whose status is 'inactive' is refused even though
-- their membership row still names the owner's organization.
--
-- ── One share per layout, which is a schema constraint not a choice ────────
--
-- `unique_layout_user (layout_id, user_id)` treats NULLs as NOT DISTINCT, so
-- a layout may hold at most ONE row with user_id IS NULL. A layout therefore
-- cannot carry a team share and a node share at the same time, and each kind
-- of share needs its own layout in the fixture. Discovered by 23505 on the
-- first run of this file against production, not assumed.
--
-- The direct-user share branch (layout_collaborations.user_id = the caller)
-- is deliberately NOT covered here: it was never part of the defect, it is
-- not in the required coverage, and exercising it would need a fifth layout.
--
-- ── Fixtures ────────────────────────────────────────────────────────────────
--
--   org A ─ owner      owns L1, L2, L3, L4
--         ├ teammate   member of team T                 → 'edit' on L2
--         ├ nodemember member of org-chart node N       → 'view' on L3
--         ├ plain      no share at all
--         └ removed    membership status 'inactive'
--   org B ─ outsider
--
--   L1  org-wide share  (user_id, team_id, org_node_id all NULL), 'view'
--   L2  team T, 'edit'
--   L3  org-chart node N, 'view'
--   L4  no collaborations at all — owner-only
-- =============================================================================

DROP TABLE IF EXISTS _layout_results;
CREATE TEMP TABLE _layout_results(n int, result text, detail text);
GRANT INSERT, SELECT ON _layout_results TO anon, authenticated;

DO $$
DECLARE
  v_suffix     text := substr(md5(random()::text), 1, 8);
  v_org_a      uuid := gen_random_uuid();
  v_org_b      uuid := gen_random_uuid();
  v_owner      uuid := gen_random_uuid();
  v_teammate   uuid := gen_random_uuid();
  v_nodemember uuid := gen_random_uuid();
  v_plain      uuid := gen_random_uuid();
  v_removed    uuid := gen_random_uuid();
  v_outsider   uuid := gen_random_uuid();
  v_team       uuid := gen_random_uuid();
  v_node       uuid := gen_random_uuid();
  v_l1         uuid := gen_random_uuid();
  v_l2         uuid := gen_random_uuid();
  v_l3         uuid := gen_random_uuid();
  v_l4         uuid := gen_random_uuid();
  v_n          int;
  v_b          boolean;
  v_pass       int := 0;
  v_fail       int := 0;
  v_denied     boolean;
  v_edit_ok    boolean;
BEGIN
  RAISE NOTICE '=== asset-page layout access (suffix: %) ===', v_suffix;

  -- ----- Identities -----
  INSERT INTO auth.users(id) VALUES
    (v_owner), (v_teammate), (v_nodemember), (v_plain), (v_removed), (v_outsider);

  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ Layout A '||v_suffix, 'zz-layout-a-'||v_suffix),
    (v_org_b, 'ZZ Layout B '||v_suffix, 'zz-layout-b-'||v_suffix);

  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_owner, v_teammate, v_nodemember, v_plain, v_removed);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_owner,      'active'),
    (v_org_a, v_teammate,   'active'),
    (v_org_a, v_nodemember, 'active'),
    (v_org_a, v_plain,      'active'),
    (v_org_a, v_removed,    'active'),
    (v_org_b, v_outsider,   'active');

  -- Moved out of 'active' by UPDATE, not inserted as 'inactive':
  -- enforce_org_membership_status_transition() governs this column and
  -- active -> inactive is the transition it permits.
  UPDATE organization_memberships SET status = 'inactive'
   WHERE organization_id = v_org_a AND user_id = v_removed;

  -- ----- Team and org-chart node, both in org A -----
  INSERT INTO teams(id, organization_id, name, slug)
  VALUES (v_team, v_org_a, 'ZZ Layout Team '||v_suffix, 'zz-layout-team-'||v_suffix);
  INSERT INTO team_memberships(team_id, user_id) VALUES (v_team, v_teammate);

  INSERT INTO org_chart_nodes(id, organization_id, node_type, name)
  VALUES (v_node, v_org_a, 'team', 'ZZ Layout Node '||v_suffix);
  INSERT INTO org_chart_node_members(node_id, user_id, role)
  VALUES (v_node, v_nodemember, 'member');

  -- ----- Layouts and their shares, one share kind per layout -----
  INSERT INTO user_asset_page_layouts(id, user_id, name) VALUES
    (v_l1, v_owner, 'ZZ Org-wide '||v_suffix),
    (v_l2, v_owner, 'ZZ Team '||v_suffix),
    (v_l3, v_owner, 'ZZ Node '||v_suffix),
    (v_l4, v_owner, 'ZZ Private '||v_suffix);

  INSERT INTO layout_collaborations(layout_id, user_id, team_id, org_node_id, permission, invited_by)
  VALUES
    (v_l1, NULL, NULL,   NULL,   'view', v_owner),   -- the org-wide row
    (v_l2, NULL, v_team, NULL,   'edit', v_owner),
    (v_l3, NULL, NULL,   v_node, 'view', v_owner);

  -- ===========================================================================
  -- 1. An anonymous caller reads NO layouts.
  --    FAILS BEFORE THE FIX: L1's org-wide row satisfies the unconditional
  --    disjunct, so anon reads it.
  -- ===========================================================================
  SET LOCAL ROLE anon;
  -- A revoked grant raises 42501 rather than returning zero rows. That is a
  -- STRONGER refusal than an empty result, so it counts as a pass -- but it
  -- must be caught, or it would abort the whole block instead of asserting.
  BEGIN
    SELECT count(*) INTO v_n FROM user_asset_page_layouts
     WHERE id IN (v_l1, v_l2, v_l3, v_l4);
  EXCEPTION WHEN insufficient_privilege THEN
    v_n := -1;
  END;
  IF v_n <= 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (1, 'PASS',
      CASE WHEN v_n = -1 THEN 'anon denied on user_asset_page_layouts at the grant layer (42501)'
           ELSE 'anon reads 0 layouts' END);
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (1, 'FAIL',
      format('anon read %s of 4 layouts', v_n));
  END IF;

  -- ===========================================================================
  -- 2. An anonymous caller reads NO collaboration rows.
  --    FAILS BEFORE THE FIX: layout_collab_view_own's all-NULL disjunct.
  -- ===========================================================================
  BEGIN
    SELECT count(*) INTO v_n FROM layout_collaborations
     WHERE layout_id IN (v_l1, v_l2, v_l3, v_l4);
  EXCEPTION WHEN insufficient_privilege THEN
    v_n := -1;
  END;
  IF v_n <= 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (2, 'PASS',
      CASE WHEN v_n = -1 THEN 'anon denied on layout_collaborations at the grant layer (42501)'
           ELSE 'anon reads 0 collaborations' END);
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (2, 'FAIL',
      format('anon read %s of 3 collaboration rows', v_n));
  END IF;

  -- ===========================================================================
  -- 3. The function itself refuses a NULL user.
  --    FAILS BEFORE THE FIX: returns true.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    SELECT public.user_has_layout_access(v_l1, NULL, 'view') INTO v_b;
  EXCEPTION WHEN insufficient_privilege THEN
    -- EXECUTE revoked from anon: it cannot even ask. Stronger than false.
    v_b := NULL; v_denied := true;
  END;
  IF v_b IS NOT TRUE THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (3, 'PASS',
      CASE WHEN v_denied THEN 'anon denied EXECUTE on user_has_layout_access (42501)'
           ELSE format('user_has_layout_access(L1, NULL) = %s', coalesce(v_b::text,'NULL')) END);
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (3, 'FAIL',
      'user_has_layout_access(L1, NULL, view) returned true');
  END IF;
  RESET ROLE;

  -- ===========================================================================
  -- 4. The owner still reads all four of their own layouts.
  --    Preserve-access control: passes before and after.
  -- ===========================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts
   WHERE id IN (v_l1, v_l2, v_l3, v_l4);
  IF v_n = 4 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (4, 'PASS', 'owner reads all 4 own layouts');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (4, 'FAIL',
      format('owner read %s of 4 own layouts', v_n));
  END IF;

  -- ===========================================================================
  -- 5. A legitimate same-org member reads the ORG-WIDE layout (L1).
  --    Preserve-access control: this is the feature the fix must not break.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_plain::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts WHERE id = v_l1;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (5, 'PASS',
      'same-org member reads the org-wide layout');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (5, 'FAIL',
      'same-org member could NOT read the org-wide layout — fix is too tight');
  END IF;

  -- ===========================================================================
  -- 8. ...but that same member reaches none of L2, L3, L4, which were never
  --    shared org-wide. Guards against the fix being too loose.
  --    (Numbered out of order so it sits beside assertion 5, its complement.)
  -- ===========================================================================
  SELECT count(*) INTO v_n FROM user_asset_page_layouts
   WHERE id IN (v_l2, v_l3, v_l4);
  IF v_n = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (8, 'PASS',
      'untargeted same-org member reaches none of the team/node/private layouts');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (8, 'FAIL',
      format('untargeted same-org member read %s of L2/L3/L4', v_n));
  END IF;

  -- ===========================================================================
  -- 6. A team collaborator reads the team-shared layout (L2).
  --    Preserve-access control.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teammate::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts WHERE id = v_l2;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (6, 'PASS', 'team collaborator reads L2');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (6, 'FAIL',
      'team collaborator could NOT read L2 — fix is too tight');
  END IF;

  -- The team share is 'edit', so this must succeed.
  UPDATE user_asset_page_layouts SET description = 'edited by teammate'
   WHERE id = v_l2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_edit_ok := (v_n = 1);

  -- ===========================================================================
  -- 7. An org-chart node collaborator reads the node-shared layout (L3).
  --    Preserve-access control.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_nodemember::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts WHERE id = v_l3;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (7, 'PASS', 'org-node collaborator reads L3');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (7, 'FAIL',
      'org-node collaborator could NOT read L3 — fix is too tight');
  END IF;

  -- ===========================================================================
  -- 12. The permission ladder still discriminates: the team share on L2 is
  --     'edit' so that collaborator may UPDATE it; the node share on L3 is
  --     'view' so that collaborator may not. layout_collaborator_edit requires
  --     'edit'. Preserve-access and preserve-tightness in one assertion.
  -- ===========================================================================
  UPDATE user_asset_page_layouts SET description = 'edited by view-only member'
   WHERE id = v_l3;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_edit_ok AND v_n = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (12, 'PASS',
      'edit-grant collaborator may update L2; view-grant collaborator may not update L3');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (12, 'FAIL',
      format('permission ladder wrong: teammate(edit) updated=%s, nodemember(view) updated %s rows',
             v_edit_ok, v_n));
  END IF;

  -- ===========================================================================
  -- 9. A member of ANOTHER organization reads none of the four.
  --    FAILS BEFORE THE FIX: L1's org-wide row ignores the organization
  --    entirely, so the outsider reads it.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts
   WHERE id IN (v_l1, v_l2, v_l3, v_l4);
  IF v_n = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (9, 'PASS', 'cross-org caller reads 0 layouts');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (9, 'FAIL',
      format('cross-org caller read %s of 4 layouts', v_n));
  END IF;

  -- ===========================================================================
  -- 10. Forged p_user_id. The outsider asks the function about the OWNER.
  --     FAILS BEFORE THE FIX: there is no identity check, so supplying
  --     someone else's id answers for them.
  -- ===========================================================================
  SELECT public.user_has_layout_access(v_l1, v_owner, 'admin') INTO v_b;
  IF v_b IS NOT TRUE THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (10, 'PASS',
      'forged p_user_id (owner''s id, admin) refused');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (10, 'FAIL',
      'forged p_user_id returned true — caller answered as another user');
  END IF;

  -- ===========================================================================
  -- 11. A REMOVED member of the owning organization reads none of the four.
  --     FAILS BEFORE THE FIX: the org-wide branch has no membership test at
  --     all, let alone an active one.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_removed::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM user_asset_page_layouts
   WHERE id IN (v_l1, v_l2, v_l3, v_l4);
  IF v_n = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (11, 'PASS',
      'removed (inactive) member reads 0 layouts');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (11, 'FAIL',
      format('removed member read %s of 4 layouts', v_n));
  END IF;
  RESET ROLE;

  -- ===========================================================================
  -- 13. save_asset_content is gone.
  --     FAILS BEFORE 20261109180001.
  -- ===========================================================================
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'save_asset_content';
  IF v_n = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _layout_results VALUES (13, 'PASS', 'save_asset_content absent');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _layout_results VALUES (13, 'FAIL',
      format('save_asset_content still present (%s overload(s))', v_n));
  END IF;

  -- ----- Cleanup, children before parents -----
  DELETE FROM layout_collaborations WHERE layout_id IN (v_l1, v_l2, v_l3, v_l4);
  DELETE FROM user_asset_page_layouts WHERE id IN (v_l1, v_l2, v_l3, v_l4);
  DELETE FROM org_chart_node_members WHERE node_id = v_node;
  DELETE FROM org_chart_nodes WHERE id = v_node;
  DELETE FROM team_memberships WHERE team_id = v_team;
  DELETE FROM teams WHERE id = v_team;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (v_owner, v_teammate, v_nodemember, v_plain, v_removed, v_outsider);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  -- Seeded per-user defaults, scoped to the six synthetic users. Must precede
  -- the auth.users delete.
  DELETE FROM list_statuses
   WHERE list_id IN (SELECT id FROM asset_lists
                      WHERE created_by IN (v_owner, v_teammate, v_nodemember,
                                           v_plain, v_removed, v_outsider));
  DELETE FROM asset_lists
   WHERE created_by IN (v_owner, v_teammate, v_nodemember, v_plain, v_removed, v_outsider);
  DELETE FROM auth.users
   WHERE id IN (v_owner, v_teammate, v_nodemember, v_plain, v_removed, v_outsider);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 13 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migrations, 1/2/3/9/10/11/13 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _layout_results ORDER BY n, result;
