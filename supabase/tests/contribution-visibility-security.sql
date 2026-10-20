-- =============================================================================
-- asset_contributions visibility — security regression test
--
-- Proves that a contribution narrowed to specific org-chart nodes is readable
-- ONLY by its author and the members of those nodes — through the contribution
-- table AND through the two tables that carry the same prose:
-- asset_contribution_history (new_content) and asset_revision_events
-- (before_value / after_value).
--
-- Uses ACTUAL database roles (`authenticated`, `anon`) and a real
-- request.jwt.claims context, so RLS, role grants and policy dependencies are
-- all exercised. Application-level filtering is not involved and would not be
-- sufficient: every defect this guards is a policy that returns rows the
-- client never asked to hide.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE scripts/sql/contribution-visibility/10-policy-fix.sql:
--       9 PASS, 5 FAIL — assertions 3, 4, 6, 8 and 13 MUST fail.
--       If they pass, this test is decoration and must not be trusted.
--
--   AFTER 10-policy-fix.sql:
--       14 PASS, 0 FAIL.
--
-- Assertions 1, 2, 5, 7, 9, 10, 11, 12 and 14 pass in BOTH states by design:
-- they are the preserve-legitimate-access controls, and a fix that breaks one
-- is too tight.
--
-- ── What 11 and 12 pin, and why they are not a new rule ─────────────────────
--
-- The org chart is a real hierarchy (`org_chart_nodes.parent_id`), and the
-- picker offers the author their department and division by walking UP from
-- their own memberships (ContributionSection.tsx:781-794). The POLICY matches
-- on direct membership only — the convention stated in
-- 20260827090400_quick_thoughts_tenant_rls.sql:52-56, which refused to invent
-- subtree traversal inside a security change and left descent as an open
-- product question.
--
-- So the fixture nests team ⊂ department ⊂ division and asserts both halves of
-- what the code actually does: a DIRECT member of a targeted department reads
-- it (11), and a member of a team BENEATH a targeted division does not (12).
-- 12 documents the gap as a tested fact rather than a guess. It is not a
-- recommendation that descent stay unimplemented.
--
-- Self-cleaning. 14 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix    text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid := gen_random_uuid();
  v_org_b     uuid := gen_random_uuid();
  v_owner     uuid := gen_random_uuid();   -- org A, author of every contribution
  v_member    uuid := gen_random_uuid();   -- org A, member of the TARGETED node
  v_other     uuid := gen_random_uuid();   -- org A, member of an UNTARGETED node
  v_outsider  uuid := gen_random_uuid();   -- org B
  v_asset     uuid := gen_random_uuid();
  v_node_div  uuid := gen_random_uuid();   -- division  (no direct members)
  v_node_dept uuid := gen_random_uuid();   -- department, child of the division
  v_node_t1   uuid := gen_random_uuid();   -- team, child of the department; targeted
  v_node_t2   uuid := gen_random_uuid();   -- team, targeted (second target)
  v_node_t3   uuid := gen_random_uuid();   -- team, NOT targeted
  v_c_single  uuid;   -- visibility 'team', team_id set,  1 target   → restricted
  v_c_multi   uuid;   -- visibility 'team', team_id NULL, 2 targets  → restricted
  v_c_zero    uuid;   -- visibility 'team', team_id NULL, 0 targets  → owner-only
  v_c_firm    uuid;   -- visibility 'firm'                           → org-wide
  v_c_dept    uuid;   -- visibility 'department', targeted at the department
  v_c_div     uuid;   -- visibility 'division',   targeted at the division
  v_rev       uuid := gen_random_uuid();
  v_n2        int;
  v_pass      int := 0;
  v_fail      int := 0;
  v_seen      uuid[];
  v_msg       text;
  v_n         int;
  v_denied    boolean;
BEGIN
  RAISE NOTICE '=== asset_contributions visibility (suffix: %) ===', v_suffix;

  -- ----- Identities -----
  INSERT INTO auth.users(id) VALUES (v_owner), (v_member), (v_other), (v_outsider);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ Vis A '||v_suffix, 'zz-vis-a-'||v_suffix),
    (v_org_b, 'ZZ Vis B '||v_suffix, 'zz-vis-b-'||v_suffix);
  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_owner, v_member, v_other);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_owner, 'active'), (v_org_a, v_member, 'active'),
    (v_org_a, v_other, 'active'), (v_org_b, v_outsider, 'active');

  INSERT INTO assets(id, symbol, company_name)
  VALUES (v_asset, 'ZZV'||v_suffix, 'ZZ Visibility Co '||v_suffix);

  -- ----- Org chart -----
  --
  --   division  (no direct members)
  --     └ department          ← v_member is a DIRECT member
  --         └ team t1         ← v_member
  --   team t2 (flat)          ← v_member
  --   team t3 (flat)          ← v_other
  --
  -- The nesting is what makes 12 meaningful: v_member sits BENEATH the
  -- division without being a member of it.
  INSERT INTO org_chart_nodes(id, organization_id, node_type, name, parent_id) VALUES
    (v_node_div,  v_org_a, 'division',   'ZZ Division '||v_suffix,     NULL),
    (v_node_dept, v_org_a, 'department', 'ZZ Department '||v_suffix,   v_node_div),
    (v_node_t1,   v_org_a, 'team',       'ZZ Targeted One '||v_suffix, v_node_dept),
    (v_node_t2,   v_org_a, 'team',       'ZZ Targeted Two '||v_suffix, NULL),
    (v_node_t3,   v_org_a, 'team',       'ZZ Untargeted '||v_suffix,   NULL);
  INSERT INTO org_chart_node_members(node_id, user_id, role) VALUES
    (v_node_t1,   v_member, 'member'),
    (v_node_t2,   v_member, 'member'),
    (v_node_dept, v_member, 'member'),   -- DIRECT member of the department
    (v_node_t3,   v_other,  'member');
  -- Deliberately NO member of v_node_div.

  -- ----- Contributions, all authored by v_owner -----
  -- One per section: unique_user_asset_section is UNIQUE(created_by, asset_id,
  -- section), so the same author cannot hold two rows in one section.
  -- jwt is set so the org-stamping trigger computes org A.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', v_owner, 'role', 'authenticated')::text);

  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'thesis', 'ZZ RESTRICTED SINGLE '||v_suffix, v_owner, 'team', v_node_t1)
  RETURNING id INTO v_c_single;

  -- The V2 shape: narrowed to TWO nodes, so the client wrote team_id = NULL
  -- (useContributions.ts:193 — `targetIds.length === 1 ? targetIds[0] : null`).
  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'where_different', 'ZZ RESTRICTED MULTI '||v_suffix, v_owner, 'team', NULL)
  RETURNING id INTO v_c_multi;

  -- The other V2 shape: narrowed, but naming nobody. Reachable by editing a
  -- restricted section, because selectedTargetIds is never rehydrated
  -- (ContributionSection.tsx:655 — initialised [], never set from the row).
  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'risks_to_thesis', 'ZZ RESTRICTED ZERO '||v_suffix, v_owner, 'team', NULL)
  RETURNING id INTO v_c_zero;

  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'business_model', 'ZZ FIRM VISIBLE '||v_suffix, v_owner, 'firm', NULL)
  RETURNING id INTO v_c_firm;

  -- Department- and division-scoped, the two shapes the picker offers by
  -- walking up the hierarchy.
  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'key_catalysts', 'ZZ RESTRICTED DEPT '||v_suffix, v_owner, 'department', v_node_dept)
  RETURNING id INTO v_c_dept;

  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'competitive_position', 'ZZ RESTRICTED DIV '||v_suffix, v_owner, 'division', v_node_div)
  RETURNING id INTO v_c_div;

  INSERT INTO contribution_visibility_targets(contribution_id, node_id, organization_id) VALUES
    (v_c_single, v_node_t1,   v_org_a),
    (v_c_multi,  v_node_t1,   v_org_a),
    (v_c_multi,  v_node_t2,   v_org_a),
    (v_c_dept,   v_node_dept, v_org_a),
    (v_c_div,    v_node_div,  v_org_a);
  -- v_c_zero deliberately gets NONE.

  -- ----- The same prose, in the two side tables -----
  -- Inserted directly rather than by provoking the production trigger: the
  -- trigger that writes asset_contribution_history is SECURITY DEFINER and is
  -- NOT in version control (C1/07:38), so depending on it would make this test
  -- depend on an object nobody here can read.
  INSERT INTO asset_contribution_history(contribution_id, old_content, new_content, changed_by)
  VALUES (v_c_single, 'ZZ OLD SINGLE '||v_suffix, 'ZZ RESTRICTED SINGLE HISTORY '||v_suffix, v_owner),
         (v_c_multi,  'ZZ OLD MULTI  '||v_suffix, 'ZZ RESTRICTED MULTI HISTORY '||v_suffix,  v_owner),
         (v_c_firm,   'ZZ OLD FIRM   '||v_suffix, 'ZZ FIRM HISTORY '||v_suffix,              v_owner);

  -- One revision session by the owner, carrying three shapes of event. The
  -- actor IS the author — the invariant the derivation depends on, asserted in
  -- 14 rather than assumed.
  INSERT INTO asset_revisions(id, asset_id, actor_user_id, view_scope_type, organization_id)
  VALUES (v_rev, v_asset, v_owner, 'firm', v_org_a);
  INSERT INTO asset_revision_events(revision_id, category, field_key, before_value, after_value, significance_tier)
  VALUES
    -- (a) attributable to v_c_single, which is restricted
    (v_rev, 'thesis', 'thesis',
     'ZZ OLD SINGLE '||v_suffix, 'ZZ RESTRICTED SINGLE REVISION '||v_suffix, 2),
    -- (b) ORPHANED: no contribution holds this section, so nothing records
    --     who its prose was shared with
    (v_rev, 'thesis', 'zz_deleted_section_'||v_suffix,
     'ZZ OLD ORPHAN '||v_suffix, 'ZZ ORPHANED PROSE '||v_suffix, 2),
    -- (c) a price target: not contribution prose, org-visible by design
    (v_rev, 'valuation_targets', 'price_target', '100', '125', 1);

  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 1. anon cannot read asset_contributions at all.
  --    PASS before and after: the policies are TO authenticated.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_n FROM asset_contributions WHERE asset_id = v_asset;
    RESET ROLE;
    v_denied := (v_n = 0);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no contributions');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s contributions', v_n)); END IF;

  -- ===========================================================================
  -- 2. OWNER sees all four of their own, at every visibility.
  --    PASS before and after — preserve-access control.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT array_agg(id ORDER BY section) INTO v_seen
      FROM asset_contributions WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_seen := NULL;
  END;
  IF v_seen @> ARRAY[v_c_single, v_c_multi, v_c_zero, v_c_firm] THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'owner sees all 4 of their own');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (2, 'FAIL',
      format('owner saw %s of 4', coalesce(array_length(v_seen,1),0))); END IF;

  -- ===========================================================================
  -- 3. AUTHORIZED TEAM MEMBER sees the two contributions targeted at nodes they
  --    belong to (single-target and multi-target), and NOT the zero-target one.
  --
  --    FAILS BEFORE THE FIX: `OR team_id IS NULL` hands them v_c_zero, which
  --    names nobody and was never shared with them.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_member, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT array_agg(id) INTO v_seen FROM asset_contributions WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_seen := NULL;
  END;
  v_seen := coalesce(v_seen, '{}'::uuid[]);
  v_msg := '';
  IF NOT (v_seen @> ARRAY[v_c_single]) THEN v_msg := v_msg || 'lost single-target '; END IF;
  IF NOT (v_seen @> ARRAY[v_c_multi])  THEN v_msg := v_msg || 'lost MULTI-target '; END IF;
  IF NOT (v_seen @> ARRAY[v_c_firm])   THEN v_msg := v_msg || 'lost firm '; END IF;
  IF v_seen @> ARRAY[v_c_zero]         THEN v_msg := v_msg || 'LEAKED zero-target '; END IF;
  IF v_msg = '' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (3, 'PASS', 'targeted member: both targeted + firm, not zero-target');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 4. UNAUTHORIZED SAME-ORG MEMBER sees ONLY the firm-visible contribution.
  --
  --    FAILS BEFORE THE FIX: v_c_multi and v_c_zero both have team_id NULL, so
  --    the policy grants them to every member of the organization. This is the
  --    leak, stated as one assertion.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT array_agg(id) INTO v_seen FROM asset_contributions WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_seen := NULL;
  END;
  v_seen := coalesce(v_seen, '{}'::uuid[]);
  v_msg := '';
  IF NOT (v_seen @> ARRAY[v_c_firm])  THEN v_msg := v_msg || 'lost firm-visible '; END IF;
  IF v_seen @> ARRAY[v_c_single]      THEN v_msg := v_msg || 'LEAKED single-target '; END IF;
  IF v_seen @> ARRAY[v_c_multi]       THEN v_msg := v_msg || 'LEAKED multi-target '; END IF;
  IF v_seen @> ARRAY[v_c_zero]        THEN v_msg := v_msg || 'LEAKED zero-target '; END IF;
  IF v_msg = '' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (4, 'PASS', 'untargeted same-org member sees only the firm row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 5. CROSS-ORG: the org-B user sees none of them, at any visibility.
  --    PASS before and after — the tenant boundary is already sound (C1/08).
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_outsider, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_contributions WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (5, 'PASS', 'cross-org reads 0 contributions');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (5, 'FAIL', format('cross-org read %s rows', v_n)); END IF;

  -- ===========================================================================
  -- 6. HISTORY does not bypass visibility. The untargeted same-org member must
  --    not read the history of a restricted contribution.
  --
  --    FAILS BEFORE THE FIX: asset_contribution_history_select (C1/07) checks
  --    only the parent's organization_id, never its visibility, so the full
  --    prose of every restricted contribution is readable org-wide —
  --    unconditionally, with no team_id state required.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_contribution_history
     WHERE contribution_id IN (v_c_single, v_c_multi);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (6, 'PASS', 'restricted history denied to untargeted member');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (6, 'FAIL',
      format('untargeted member read %s restricted history rows (prose)', v_n)); END IF;

  -- ===========================================================================
  -- 7. HISTORY still reaches the people it should: the targeted member reads
  --    the history of the contribution shared with them.
  --    PASS before and after — this is what stops the fix being too tight.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_member, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_contribution_history WHERE contribution_id = v_c_single;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n >= 1 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (7, 'PASS', 'targeted member still reads shared history');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (7, 'FAIL',
      format('targeted member lost shared history (count %s)', v_n)); END IF;

  -- ===========================================================================
  -- 8. REVISION EVENTS do not bypass visibility. The untargeted same-org
  --    member must not read before/after prose for a restricted section.
  --
  --    FAILS BEFORE THE FIX: asset_revision_events_select (C1/06) is
  --    organization-scoped only. Same class as 6, second table.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    -- Only the event attributable to the restricted contribution. The
    -- price-target event in the same session is NOT contribution prose and is
    -- asserted separately in 14.
    SELECT count(*) INTO v_n FROM asset_revision_events
     WHERE revision_id = v_rev AND field_key = 'thesis';
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (8, 'PASS', 'restricted revision prose denied to untargeted member');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (8, 'FAIL',
      format('untargeted member read %s restricted revision events (prose)', v_n)); END IF;

  -- ===========================================================================
  -- 9. The ACTOR still reads their own revision events.
  --    PASS before and after — preserve-access control.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_revision_events WHERE revision_id = v_rev;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 3 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (9, 'PASS', 'actor still reads all 3 of their own revision events');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (9, 'FAIL',
      format('actor read %s of their own 3 revision events', v_n)); END IF;

  -- ===========================================================================
  -- 10. CROSS-ORG on both side tables.
  --     PASS before and after — guards the fix against introducing a
  --     contribution-derived path that leaks across tenants.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_outsider, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_contribution_history
     WHERE contribution_id IN (v_c_single, v_c_multi, v_c_firm);
    IF v_n <> 0 THEN v_msg := v_msg || format('history:%s ', v_n); END IF;
    SELECT count(*) INTO v_n FROM asset_revision_events WHERE revision_id = v_rev;
    IF v_n <> 0 THEN v_msg := v_msg || format('revision_events:%s ', v_n); END IF;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := v_msg || '(call failed) ';
  END;
  IF v_msg = '' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (10, 'PASS', 'cross-org denied on history and revision events');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (10, 'FAIL', 'cross-org leaked: '||v_msg); END IF;

  -- ===========================================================================
  -- 11. DEPARTMENT target, DIRECT member. v_member is a direct member of the
  --     targeted department, so they read it; v_other is not, so they do not.
  --     PASS before and after — the single-target path already worked.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_member, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n  FROM asset_contributions WHERE id = v_c_dept;
    RESET ROLE;
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n2 FROM asset_contributions WHERE id = v_c_dept;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1; v_n2 := -1;
  END;
  IF v_n <> 1  THEN v_msg := v_msg || 'direct department member cannot read it '; END IF;
  IF v_n2 <> 0 THEN v_msg := v_msg || 'LEAKED to a non-member '; END IF;
  IF v_msg = '' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (11, 'PASS', 'department target: direct member yes, non-member no');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 12. DIVISION target with NO direct members. v_member sits in a team
  --     BENEATH that division and still cannot read it, because the policy
  --     matches direct membership only.
  --
  --     PASS before and after. This asserts WHAT THE CODE DOES, documenting
  --     the unimplemented descent as a tested fact — it is not an endorsement.
  --     If descent is ever implemented, this assertion must be INVERTED, and
  --     the failure is the signal to do so deliberately.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_member, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_contributions WHERE id = v_c_div;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (12, 'PASS',
      'division target does NOT reach a descendant team member (descent unimplemented, by convention)');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (12, 'FAIL',
      format('descendant read a division-targeted contribution (count %s) — descent semantics changed', v_n)); END IF;

  -- ===========================================================================
  -- 13. ORPHANED revision prose. An event whose section has no contribution
  --     cannot be attributed, so nothing records who it was shared with and it
  --     must be denied to everyone but the actor.
  --
  --     FAILS BEFORE THE FIX: organization-scoped, so the whole org reads it.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_revision_events
     WHERE revision_id = v_rev AND field_key = 'zz_deleted_section_'||v_suffix;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (13, 'PASS', 'unattributable revision prose denied to non-actor');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (13, 'FAIL',
      format('orphaned prose readable org-wide (count %s)', v_n)); END IF;

  -- ===========================================================================
  -- 14. Two things the fix must NOT change.
  --
  --     (a) Price-target events stay organization-visible. They are not
  --         contribution prose, and they are the only revision category the
  --         Evolution Timeline renders.
  --     (b) actor == author: the invariant the whole derivation rests on. If a
  --         revision event ever has an actor who is not the author of the
  --         matching contribution, the actor branch hands out somebody else's
  --         prose. Asserted, not assumed.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM asset_revision_events
     WHERE revision_id = v_rev AND category = 'valuation_targets';
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
  END;
  IF v_n <> 1 THEN v_msg := v_msg || format('price-target event no longer org-visible (count %s) ', v_n); END IF;

  -- (b) run unprivileged: every contribution-category event with a matching
  --     section must match on the ACTOR, and exactly one row.
  SELECT count(*) INTO v_n2
    FROM asset_revision_events e
    JOIN asset_revisions r ON r.id = e.revision_id
   WHERE r.id = v_rev
     AND e.category <> 'valuation_targets'
     AND EXISTS (SELECT 1 FROM asset_contributions c
                  WHERE c.asset_id = r.asset_id AND c.section = e.field_key)
     AND NOT EXISTS (SELECT 1 FROM asset_contributions c
                      WHERE c.asset_id = r.asset_id AND c.section = e.field_key
                        AND c.created_by = r.actor_user_id);
  IF v_n2 <> 0 THEN
    v_msg := v_msg || format('%s event(s) attributable to a section whose author is NOT the actor ', v_n2);
  END IF;
  IF v_msg = '' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (14, 'PASS', 'price targets stay org-visible; actor == author holds');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (14, 'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_revision_events WHERE revision_id = v_rev;
  DELETE FROM asset_revisions       WHERE id = v_rev;
  DELETE FROM asset_contribution_history
   WHERE contribution_id IN (v_c_single, v_c_multi, v_c_zero, v_c_firm, v_c_dept, v_c_div);
  DELETE FROM contribution_visibility_targets
   WHERE contribution_id IN (v_c_single, v_c_multi, v_c_zero, v_c_firm, v_c_dept, v_c_div);
  DELETE FROM asset_contributions
   WHERE id IN (v_c_single, v_c_multi, v_c_zero, v_c_firm, v_c_dept, v_c_div);
  DELETE FROM org_chart_node_members
   WHERE node_id IN (v_node_t1, v_node_t2, v_node_t3, v_node_dept, v_node_div);
  -- Children before parents: parent_id references org_chart_nodes.
  DELETE FROM org_chart_nodes WHERE id IN (v_node_t1, v_node_t2, v_node_t3);
  DELETE FROM org_chart_nodes WHERE id = v_node_dept;
  DELETE FROM org_chart_nodes WHERE id = v_node_div;
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (v_owner, v_member, v_other, v_outsider);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_other, v_outsider);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 14 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the fix, 3/4/6/8/13 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
