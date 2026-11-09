-- =============================================================================
-- Theme page layouts (templates) — cross-org isolation test
--
-- Covers the three tables added by 20261104150001_theme_page_layouts and the
-- two field-library tables whose policies the same migration repaired:
--
--   user_theme_page_layouts        a named template
--   user_theme_layout_selections   which template a theme is using
--   theme_layout_collaborations    who else can see or edit a template
--   theme_research_sections        what a template is a template OF
--   theme_research_fields          "
--
-- ── The assertion this test exists for ───────────────────────────────────
--
-- Assertion 4. The asset equivalent of this feature leaks across tenants:
-- `layout_collaborations` admits a row with user_id, team_id and org_node_id
-- all NULL, meaning "shared organization-wide", and `user_has_layout_access`
-- treats that row as a grant to ANY authenticated caller. There is no
-- organization predicate in that arm and `user_asset_page_layouts` has no
-- organization column to write one against. The single such row in
-- production is therefore readable by a signed-in user of any organization.
--
-- The theme tables carry `organization_id` and `theme_layout_access` requires
-- ACTIVE MEMBERSHIP of the layout's own organization before any grant counts,
-- the owner included. Assertion 4 is what proves that: the same org-wide
-- grant that leaks on the asset side must NOT reach org B here.
--
-- The asset-side defect is NOT fixed by that migration and is NOT asserted
-- here. It is a separate change against the asset tables.
--
-- ── How to run it so that it means something ─────────────────────────────
--
-- Run it BEFORE 20261104150001 to watch it fail (the tables do not exist, so
-- it fails at the first insert), and after to watch it pass. A passing run on
-- its own proves nothing -- CLAUDE.md standing rule 3.
--
-- Assertion 4 has been proven non-vacuous against production, inside an
-- aborted transaction, by replacing `theme_layout_access` with a
-- line-for-line copy of the asset side's `user_has_layout_access` -- no
-- organization predicate, and the org-wide grant arm treated as a grant to
-- any caller:
--
--   #3 cross-org read, no grant      (expect 0) = 0
--   #4 org-wide grant must not cross (expect 0) = 1   <- GATE FIRED
--   #5 org-wide reaches its own org  (expect 1) = 1
--
-- So assertion 4 observes exactly the defect it names, and the asset side's
-- leak is not a reading of its source but a measured result.
--
-- ── Run it without touching production data ──────────────────────────────
--
-- This file inserts two organizations, two themes, a section, a field and
-- several layout rows, and it repoints four real users'
-- `current_organization_id`. The CLEANUP block undoes all of that, but a
-- failure before cleanup would leave residue, and the `users` repoint is the
-- part that matters.
--
-- To run it with no possibility of residue, run the DO block inside a
-- transaction that always aborts: replace the final RAISE NOTICE with
--
--   RAISE EXCEPTION 'ROLLBACK-BY-DESIGN :: %', <the formatted results>;
--
-- The abort is the cleanup, and the message carries every assertion's
-- outcome. That is how the 17/17 run above was taken, and residue was then
-- confirmed zero: 0 orgs, 0 themes, 0 layouts, 0 selections, 0
-- collaborations, 0 fields, 0 sections, and 0 users pointing at a deleted
-- organization.
--
-- Designed for the SQL editor (service role), psql, or CI against a shadow
-- database. Every probe assumes the `authenticated` role and forges the JWT
-- claim the way PostgREST presents a request, then drops back immediately.
-- Self-cleaning: two organizations, two themes, one section, one field and
-- every layout row are removed at the end, and the borrowed users' original
-- `current_organization_id` is restored.
--
-- 17 assertions.
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS tpl_authz_results (
  seq      int,
  label    text,
  passed   boolean,
  detail   text
) ON COMMIT DROP;

TRUNCATE tpl_authz_results;

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);

  v_org_a    uuid;   -- the layout's organization
  v_org_b    uuid;   -- a different tenant entirely
  v_owner    uuid;   -- org A, owns the template
  v_peer     uuid;   -- org A, active member, no grant of their own
  v_removed  uuid;   -- org A membership set inactive partway through
  v_outsider uuid;   -- org B only
  v_orig     jsonb;

  v_theme_a  uuid;
  v_theme_b  uuid;
  v_section  uuid;
  v_field    uuid;

  v_layout   uuid;
  v_sel      uuid;

  v_count    int;
  v_wrote    int;
  v_name     text;
  v_ok       boolean;

  PROCEDURE_NOTE constant text := 'theme page layouts tenant isolation';
BEGIN
  -- `users.id` references auth.users, so identities are borrowed.
  SELECT id INTO v_owner    FROM auth.users ORDER BY id OFFSET 0 LIMIT 1;
  SELECT id INTO v_peer     FROM auth.users ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_removed  FROM auth.users ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO v_outsider FROM auth.users ORDER BY id OFFSET 3 LIMIT 1;

  IF v_outsider IS NULL THEN
    INSERT INTO tpl_authz_results
      VALUES (0, 'SKIPPED: need 4 auth users to model four identities', true, null);
    RETURN;
  END IF;

  SELECT jsonb_object_agg(id::text, to_jsonb(current_organization_id))
    INTO v_orig
    FROM users
   WHERE id IN (v_owner, v_peer, v_removed, v_outsider);

  -- ---------------------------------------------------------------------------
  -- SETUP: two tenants, a template in A, a theme in each
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug)
    VALUES ('TPL Org A ' || v_suffix, 'tpl-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug)
    VALUES ('TPL Org B ' || v_suffix, 'tpl-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO organization_memberships (user_id, organization_id, role, status)
    VALUES (v_owner,    v_org_a, 'member', 'active'),
           (v_peer,     v_org_a, 'member', 'active'),
           (v_removed,  v_org_a, 'member', 'active'),
           (v_outsider, v_org_b, 'member', 'active');

  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_owner, v_peer, v_removed);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  INSERT INTO themes (name, organization_id)
    VALUES ('TPL theme A ' || v_suffix, v_org_a) RETURNING id INTO v_theme_a;
  INSERT INTO themes (name, organization_id)
    VALUES ('TPL theme B ' || v_suffix, v_org_b) RETURNING id INTO v_theme_b;

  INSERT INTO theme_research_sections (organization_id, name, slug, display_order)
    VALUES (v_org_a, 'TPL section ' || v_suffix, 'tpl_section_' || v_suffix, 0)
    RETURNING id INTO v_section;
  INSERT INTO theme_research_fields
      (organization_id, section_id, name, slug, field_type, display_order)
    VALUES (v_org_a, v_section, 'TPL field ' || v_suffix, 'tpl_field_' || v_suffix, 'rich_text', 0)
    RETURNING id INTO v_field;

  -- The template itself, written as the owner through the policy, so the
  -- insert path is exercised rather than bypassed by the service role.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  INSERT INTO user_theme_page_layouts
      (user_id, organization_id, name, field_config)
    VALUES (v_owner, v_org_a, 'TPL layout ' || v_suffix,
            jsonb_build_array(jsonb_build_object(
              'field_id', v_field, 'section_id', v_section,
              'is_visible', true, 'display_order', 0, 'is_collapsed', false)))
    RETURNING id INTO v_layout;
  RESET ROLE;

  -- ---------------------------------------------------------------------------
  -- READ
  -- ---------------------------------------------------------------------------

  -- 1. The legitimate case first, so a lockout cannot pass as isolation.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (1,
    'the owner can read their own template',
    v_count = 1, format('saw %s, expected 1', v_count));

  -- 2. A colleague in the same org sees nothing without a grant. A template
  --    is personal until shared, which is also true on the asset page.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (2,
    'a same-org colleague cannot read an unshared template',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- 3. An outsider cannot read it either, grant or no grant.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (3,
    'cross-org read of a template is denied',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- The organization-wide grant: the exact row shape that leaks on the asset
  -- side (user_id, team_id and org_node_id all NULL).
  INSERT INTO theme_layout_collaborations
      (layout_id, organization_id, permission, invited_by)
    VALUES (v_layout, v_org_a, 'view', v_owner);

  -- 4. THE ASSERTION THIS FILE EXISTS FOR. Same grant, other tenant: denied.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (4,
    'an organization-wide grant does NOT reach another organization',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- 5. And it DOES reach the org it names, or sharing is broken.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (5,
    'an organization-wide grant DOES reach the org it names',
    v_count = 1, format('saw %s, expected 1', v_count));

  -- 6. Membership is the floor. A removed member loses the shared template
  --    even though the grant still exists and their JWT still names the org.
  UPDATE organization_memberships SET status = 'inactive'
   WHERE user_id = v_removed AND organization_id = v_org_a;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_removed, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_page_layouts WHERE id = v_layout;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (6,
    'a removed member loses a template shared org-wide',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- WRITE
  -- ---------------------------------------------------------------------------

  -- 7. A 'view' grant is not an edit grant, within the same org.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
  UPDATE user_theme_page_layouts SET name = 'peer tampered' WHERE id = v_layout;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  SELECT name INTO v_name FROM user_theme_page_layouts WHERE id = v_layout;
  INSERT INTO tpl_authz_results VALUES (7,
    'a view grant cannot rename the template',
    v_count = 0 AND v_name <> 'peer tampered',
    format('updated %s (expected 0), name now %L', v_count, v_name));

  -- 8. Cross-org update is denied.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  UPDATE user_theme_page_layouts SET name = 'outsider tampered' WHERE id = v_layout;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  SELECT name INTO v_name FROM user_theme_page_layouts WHERE id = v_layout;
  INSERT INTO tpl_authz_results VALUES (8,
    'cross-org update of a template is denied',
    v_count = 0 AND v_name <> 'outsider tampered',
    format('updated %s (expected 0), name now %L', v_count, v_name));

  -- 9. Cross-org delete is denied.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  DELETE FROM user_theme_page_layouts WHERE id = v_layout;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (9,
    'cross-org delete of a template is denied',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 10. An outsider cannot plant a template inside org A. Tagging the row
  --     with org A is the obvious attempt and the insert check refuses it,
  --     because `organization_id` must be the CALLER's current org.
  v_ok := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    INSERT INTO user_theme_page_layouts (user_id, organization_id, name)
      VALUES (v_outsider, v_org_a, 'planted ' || v_suffix);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
    RESET ROLE;
  END;
  INSERT INTO tpl_authz_results VALUES (10,
    'cross-org insert of a template is denied',
    v_ok, CASE WHEN v_ok THEN 'refused' ELSE 'the insert was accepted' END);

  -- 11. A grant cannot be written by somebody who is not the owner or an
  --     admin, even inside the same org.
  v_ok := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
    INSERT INTO theme_layout_collaborations
        (layout_id, organization_id, user_id, permission, invited_by)
      VALUES (v_layout, v_org_a, v_peer, 'admin', v_peer);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
    RESET ROLE;
  END;
  INSERT INTO tpl_authz_results VALUES (11,
    'a view collaborator cannot promote themselves to admin',
    v_ok, CASE WHEN v_ok THEN 'refused' ELSE 'the grant was accepted' END);

  -- 12. And an outsider cannot write a grant at all.
  v_ok := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    INSERT INTO theme_layout_collaborations
        (layout_id, organization_id, user_id, permission, invited_by)
      VALUES (v_layout, v_org_b, v_outsider, 'admin', v_outsider);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
    RESET ROLE;
  END;
  INSERT INTO tpl_authz_results VALUES (12,
    'cross-org grant on another org''s template is denied',
    v_ok, CASE WHEN v_ok THEN 'refused' ELSE 'the grant was accepted' END);

  -- ---------------------------------------------------------------------------
  -- SELECTIONS: which template a given theme is using
  -- ---------------------------------------------------------------------------

  -- 13. The legitimate case.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  INSERT INTO user_theme_layout_selections (user_id, theme_id, layout_id)
    VALUES (v_owner, v_theme_a, v_layout) RETURNING id INTO v_sel;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (13,
    'the owner can point their own theme at their own template',
    v_sel IS NOT NULL, format('selection id %s', v_sel));

  -- 14. A selection cannot name a theme in another organization.
  v_ok := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    INSERT INTO user_theme_layout_selections (user_id, theme_id, layout_id)
      VALUES (v_owner, v_theme_b, v_layout);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
    RESET ROLE;
  END;
  INSERT INTO tpl_authz_results VALUES (14,
    'a selection cannot name a theme in another organization',
    v_ok, CASE WHEN v_ok THEN 'refused' ELSE 'the selection was accepted' END);

  -- 15. And one member's selections are invisible to another.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_layout_selections WHERE id = v_sel;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (15,
    'one member cannot read another member''s theme selection',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- THE FIELD LIBRARY, whose policies the same migration repaired
  -- ---------------------------------------------------------------------------

  -- 16. Cross-org read of the field library is denied. Before the repair the
  --     policy was `TO public` with `organization_id = current_org_id()`,
  --     which already denied this; what the repair adds is the membership
  --     check, asserted next.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM theme_research_fields WHERE id = v_field;
  RESET ROLE;
  INSERT INTO tpl_authz_results VALUES (16,
    'cross-org read of the theme field library is denied',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- 17. The repair itself: a removed member whose JWT still names org A can
  --     no longer read or write the org's field library. `v_removed` was set
  --     inactive at assertion 6 and `current_organization_id` still says
  --     org A, which is exactly the stale-token case.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_removed, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM theme_research_fields WHERE id = v_field;
  UPDATE theme_research_fields SET name = 'removed tampered' WHERE id = v_field;
  GET DIAGNOSTICS v_wrote = ROW_COUNT;
  RESET ROLE;
  SELECT name INTO v_name FROM theme_research_fields WHERE id = v_field;
  INSERT INTO tpl_authz_results VALUES (17,
    'a removed member can neither read nor write the field library',
    v_count = 0 AND v_wrote = 0 AND v_name <> 'removed tampered',
    format('read %s (expected 0), wrote %s (expected 0), name now %L',
           v_count, v_wrote, v_name));

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  DELETE FROM user_theme_layout_selections WHERE theme_id IN (v_theme_a, v_theme_b);
  DELETE FROM theme_layout_collaborations  WHERE layout_id = v_layout;
  DELETE FROM user_theme_page_layouts      WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM theme_research_fields        WHERE id = v_field;
  DELETE FROM theme_research_sections      WHERE id = v_section;
  DELETE FROM themes                       WHERE id IN (v_theme_a, v_theme_b);
  DELETE FROM organization_memberships     WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users u
     SET current_organization_id = NULLIF(v_orig ->> u.id::text, 'null')::uuid
   WHERE u.id IN (v_owner, v_peer, v_removed, v_outsider);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

  RAISE NOTICE '% — recorded % assertions', PROCEDURE_NOTE,
    (SELECT count(*) FROM tpl_authz_results);
END $$;

-- Turn the recorded results into a failure. Separate statement so the table
-- above survives a failing run and can be read.
DO $$
DECLARE
  v_failed int;
  v_total  int;
  v_names  text;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*),
         string_agg(format('#%s %s (%s)', seq, label, detail), E'\n  ')
           FILTER (WHERE NOT passed)
    INTO v_failed, v_total, v_names
    FROM tpl_authz_results;

  IF v_failed > 0 THEN
    RAISE EXCEPTION E'theme page layouts tenant isolation: % of % assertions FAILED\n  %',
      v_failed, v_total, v_names;
  END IF;
  RAISE NOTICE 'theme page layouts tenant isolation: all % assertions passed', v_total;
END $$;
