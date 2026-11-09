-- =============================================================================
-- save_theme_layout_customization — cross-org isolation test
--
-- The function is SECURITY DEFINER, so RLS does not apply to anything it
-- does. Every boundary it has is one it enforces itself, and this file is
-- what proves those are there. It is the companion to
-- `theme-page-layouts-tenant-isolation.sql`, which covers the TABLES; this
-- covers the only thing that writes them.
--
-- ── What is actually at risk ──────────────────────────────────────────────
--
-- The function creates rows in `theme_research_sections`, which is an
-- ORG-LEVEL library, from a jsonb parameter, and upserts
-- `user_theme_layout_selections` for a theme named by a parameter. If it did
-- not check membership of the theme's organization, any authenticated user
-- could add sections to another firm's research library and pin a layout
-- selection onto another firm's theme. Assertions 3, 4 and 5 are that.
--
-- The three assertions that are NOT about crossing a tenant line are here
-- for the same reason: 2 (the legitimate case) so that a lockout cannot pass
-- as isolation, 9 (version conflict) and 10 (the empty selection) because
-- both are states the table's own CHECK constraint would otherwise turn into
-- a 23514 the user never typed.
--
-- ── Assertion 6 is the one that is not a copy ─────────────────────────────
--
-- `save_asset_layout_customization` resolves the organization as
--
--   SELECT organization_id FROM organization_memberships
--    WHERE user_id = auth.uid() AND status = 'active' LIMIT 1
--
-- For a user who belongs to two organizations that returns an arbitrary one.
-- The theme function reads the organization from the THEME instead.
-- Assertion 6 gives one user active membership of both tenants and saves
-- against org B's theme, then checks which organization the created section
-- and the audit event landed in. Under the asset function's shape this would
-- be whichever row `LIMIT 1` happened to return.
--
-- ── Run it so that it means something ────────────────────────────────────
--
-- Run the DO block BEFORE 20261108190000 to watch it fail: the function does
-- not exist, so assertion 2 fails 42883 and takes the block with it. A
-- passing run on its own proves nothing (CLAUDE.md standing rule 3).
--
-- ── Run it without touching production data ──────────────────────────────
--
-- It inserts two organizations, two themes, a section, a field, a layout and
-- several selections, and repoints four real users'
-- `current_organization_id`. THE BLOCK ABORTS ITSELF: it builds the report,
-- then raises `ROLLBACK-BY-DESIGN` carrying it, so every row it wrote is
-- unwound whether or not the CLEANUP block was reached. Read the results out
-- of the error message.
--
-- To keep the rows instead -- CI against a shadow database, or debugging --
--
--   SET stlc.persist = 'on';
--
-- and the block ends with a NOTICE and leaves `stlc_results` to be queried.
--
-- 12 assertions.
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS stlc_results (
  seq    int,
  label  text,
  passed boolean,
  detail text
) ON COMMIT DROP;

TRUNCATE stlc_results;

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);

  v_org_a    uuid;
  v_org_b    uuid;
  v_owner    uuid;   -- org A only; owns the template
  v_peer     uuid;   -- org A only; no grant on the template
  v_outsider uuid;   -- org B only
  v_dual     uuid;   -- active in BOTH orgs (assertion 6)
  v_orig     jsonb;

  v_theme_a  uuid;
  v_theme_b  uuid;
  v_section  uuid;
  v_field    uuid;
  v_layout   uuid;

  v_count    int;
  v_version  int;
  v_res      jsonb;
  v_sqlstate text;
  v_report   text;
  v_new_sec  uuid;
  v_sec_org  uuid;
  v_aud_org  uuid;
BEGIN
  SELECT id INTO v_owner    FROM auth.users ORDER BY id OFFSET 0 LIMIT 1;
  SELECT id INTO v_peer     FROM auth.users ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_outsider FROM auth.users ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO v_dual     FROM auth.users ORDER BY id OFFSET 3 LIMIT 1;

  IF v_dual IS NULL THEN
    INSERT INTO stlc_results
      VALUES (0, 'SKIPPED: need 4 auth users to model four identities', true, null);
    RETURN;
  END IF;

  SELECT jsonb_object_agg(id::text, to_jsonb(current_organization_id))
    INTO v_orig FROM users
   WHERE id IN (v_owner, v_peer, v_outsider, v_dual);

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug)
    VALUES ('STLC Org A ' || v_suffix, 'stlc-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug)
    VALUES ('STLC Org B ' || v_suffix, 'stlc-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO organization_memberships (user_id, organization_id, role, status)
    VALUES (v_owner,    v_org_a, 'member', 'active'),
           (v_peer,     v_org_a, 'member', 'active'),
           (v_outsider, v_org_b, 'member', 'active'),
           (v_dual,     v_org_a, 'member', 'active'),
           (v_dual,     v_org_b, 'member', 'active');

  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_owner, v_peer, v_dual);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  INSERT INTO themes (name, organization_id)
    VALUES ('STLC theme A ' || v_suffix, v_org_a) RETURNING id INTO v_theme_a;
  INSERT INTO themes (name, organization_id)
    VALUES ('STLC theme B ' || v_suffix, v_org_b) RETURNING id INTO v_theme_b;

  INSERT INTO theme_research_sections (organization_id, name, slug, display_order)
    VALUES (v_org_a, 'STLC section ' || v_suffix, 'stlc_section_' || v_suffix, 0)
    RETURNING id INTO v_section;
  INSERT INTO theme_research_fields
      (organization_id, section_id, name, slug, field_type, display_order)
    VALUES (v_org_a, v_section, 'STLC field ' || v_suffix,
            'stlc_field_' || v_suffix, 'rich_text', 0)
    RETURNING id INTO v_field;

  INSERT INTO user_theme_page_layouts (user_id, organization_id, name, field_config)
    VALUES (v_owner, v_org_a, 'STLC layout ' || v_suffix, '[]'::jsonb)
    RETURNING id INTO v_layout;

  -- ---------------------------------------------------------------------------
  -- 1. anon cannot execute it at all.
  --    A function created in `public` is born executable by anon; the
  --    migration revokes that explicitly because REVOKE FROM PUBLIC does
  --    not remove it.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims',
      json_build_object('role', 'anon')::text, true);
    PERFORM save_theme_layout_customization(v_theme_a);
    RESET ROLE;
    INSERT INTO stlc_results VALUES (1,
      'anon cannot execute the function', false, 'the call succeeded');
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    RESET ROLE;
    INSERT INTO stlc_results VALUES (1,
      'anon cannot execute the function',
      v_sqlstate = '42501',
      format('sqlstate %s, expected 42501 (insufficient_privilege)', v_sqlstate));
  END;

  -- ---------------------------------------------------------------------------
  -- 2. THE LEGITIMATE CASE, first, so that a lockout cannot pass as
  --    isolation. A member of the theme's org saves an override.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_res := save_theme_layout_customization(
      v_theme_a, v_layout,
      jsonb_build_array(jsonb_build_object(
        'field_id', v_field, 'section_id', v_section,
        'is_visible', true, 'display_order', 0, 'width', 6)),
      '[]'::jsonb, '[]'::jsonb, false, null);
    RESET ROLE;
    SELECT count(*) INTO v_count FROM user_theme_layout_selections
     WHERE user_id = v_owner AND theme_id = v_theme_a;
    INSERT INTO stlc_results VALUES (2,
      'a member of the theme''s org can save a layout for it',
      (v_res->>'status') = 'saved' AND v_count = 1,
      format('status %s, rows %s, expected saved/1', v_res->>'status', v_count));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO stlc_results VALUES (2,
      'a member of the theme''s org can save a layout for it',
      false, format('raised %s: %s', SQLSTATE, SQLERRM));
  END;

  -- ---------------------------------------------------------------------------
  -- 3. CROSS-ORG WRITE. An outsider saving against org A's theme must be
  --    refused. Existence of the theme is not authorization.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    PERFORM save_theme_layout_customization(
      v_theme_a, null,
      jsonb_build_array(jsonb_build_object(
        'field_id', v_field, 'section_id', v_section, 'is_visible', false)),
      '[]'::jsonb, '[]'::jsonb, false, null);
    RESET ROLE;
    INSERT INTO stlc_results VALUES (3,
      'an outsider cannot save a layout against another org''s theme',
      false, 'the call succeeded');
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    RESET ROLE;
    INSERT INTO stlc_results VALUES (3,
      'an outsider cannot save a layout against another org''s theme',
      v_sqlstate = '42501',
      format('sqlstate %s, expected 42501', v_sqlstate));
  END;

  -- 4. And it wrote nothing. A refusal that leaves a row behind is not one.
  SELECT count(*) INTO v_count FROM user_theme_layout_selections
   WHERE user_id = v_outsider AND theme_id = v_theme_a;
  INSERT INTO stlc_results VALUES (4,
    'the refused cross-org save left no selection row',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- 5. CROSS-ORG LIBRARY WRITE. The new-sections parameter inserts into an
  --    org-level library. An outsider must not be able to add a section to
  --    org A's library through org A's theme.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    PERFORM save_theme_layout_customization(
      v_theme_a, null, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'temp_id', 'tmp1', 'name', 'STLC intruder ' || v_suffix)),
      false, null);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM theme_research_sections
   WHERE organization_id = v_org_a AND name = 'STLC intruder ' || v_suffix;
  INSERT INTO stlc_results VALUES (5,
    'an outsider cannot add a section to another org''s library',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- 6. THE ORGANIZATION IS THE THEME'S, NOT THE CALLER'S.
  --    `v_dual` is active in both tenants, so a membership lookup with
  --    LIMIT 1 -- which is what the asset function does -- could resolve
  --    either. Saving against org B's theme must land in org B.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dual, 'role', 'authenticated')::text, true);
    PERFORM save_theme_layout_customization(
      v_theme_b, null, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'temp_id', 'tmp1', 'name', 'STLC dual ' || v_suffix)),
      false, null);
    RESET ROLE;

    SELECT id, organization_id INTO v_new_sec, v_sec_org
      FROM theme_research_sections WHERE name = 'STLC dual ' || v_suffix;
    SELECT org_id INTO v_aud_org FROM audit_events
     WHERE actor_id = v_dual AND action_category = 'research_layout'
       AND metadata->>'theme_id' = v_theme_b::text
     ORDER BY created_at DESC LIMIT 1;

    INSERT INTO stlc_results VALUES (6,
      'the organization comes from the theme, not from the caller''s memberships',
      v_sec_org = v_org_b AND v_aud_org = v_org_b,
      format('section org %s, audit org %s, expected both %s',
             v_sec_org, v_aud_org, v_org_b));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO stlc_results VALUES (6,
      'the organization comes from the theme, not from the caller''s memberships',
      false, format('raised %s: %s', SQLSTATE, SQLERRM));
  END;

  -- ---------------------------------------------------------------------------
  -- 7. TEMPLATE ACCESS. A same-org colleague with no grant cannot pin
  --    somebody else's private template onto a theme. This goes through
  --    `theme_layout_access`, never an inline collaboration subquery -- the
  --    asset side's inline version is the documented cross-org leak.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_peer, 'role', 'authenticated')::text, true);
    PERFORM save_theme_layout_customization(v_theme_a, v_layout);
    RESET ROLE;
    INSERT INTO stlc_results VALUES (7,
      'a colleague cannot use a template they have no grant on',
      false, 'the call succeeded');
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    RESET ROLE;
    INSERT INTO stlc_results VALUES (7,
      'a colleague cannot use a template they have no grant on',
      v_sqlstate = '42501',
      format('sqlstate %s, expected 42501', v_sqlstate));
  END;

  -- ---------------------------------------------------------------------------
  -- 8. IDENTITY. The row belongs to auth.uid(). There is no user parameter
  --    to forge, and this asserts that absence has the effect it should:
  --    the owner's save in assertion 2 is the owner's row, and nobody
  --    else's selection was touched.
  -- ---------------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM user_theme_layout_selections
   WHERE theme_id = v_theme_a AND user_id <> v_owner;
  INSERT INTO stlc_results VALUES (8,
    'the selection is written for the caller and nobody else',
    v_count = 0, format('saw %s other users'' rows, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- 9. CONCURRENCY. A stale expected version must be refused, not merged.
  -- ---------------------------------------------------------------------------
  SELECT version INTO v_version FROM user_theme_layout_selections
   WHERE user_id = v_owner AND theme_id = v_theme_a;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    PERFORM save_theme_layout_customization(
      v_theme_a, v_layout, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      false, v_version + 7);
    RESET ROLE;
    INSERT INTO stlc_results VALUES (9,
      'a stale expected version is refused', false, 'the call succeeded');
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    RESET ROLE;
    INSERT INTO stlc_results VALUES (9,
      'a stale expected version is refused',
      v_sqlstate = '40001',
      format('sqlstate %s, expected 40001 (serialization_failure)', v_sqlstate));
  END;

  -- ---------------------------------------------------------------------------
  -- 10. THE EMPTY SELECTION. `theme_selection_has_layout_or_overrides`
  --     forbids a row with no template and no overrides, so that case must
  --     DELETE rather than attempt an insert the CHECK would reject with a
  --     23514 the user never typed.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_res := save_theme_layout_customization(
      v_theme_a, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null);
    RESET ROLE;
    SELECT count(*) INTO v_count FROM user_theme_layout_selections
     WHERE user_id = v_owner AND theme_id = v_theme_a;
    INSERT INTO stlc_results VALUES (10,
      'an empty selection deletes the row instead of violating the CHECK',
      v_count = 0 AND (v_res->>'status') = 'saved',
      format('rows %s (expected 0), status %s', v_count, v_res->>'status'));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO stlc_results VALUES (10,
      'an empty selection deletes the row instead of violating the CHECK',
      false, format('raised %s: %s', SQLSTATE, SQLERRM));
  END;

  -- ---------------------------------------------------------------------------
  -- 11. CROSS-ORG READ of what was written. Belt and braces over the table
  --     policies, because this function is the only thing that writes them.
  -- ---------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM save_theme_layout_customization(v_theme_a, v_layout);
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM user_theme_layout_selections
   WHERE theme_id = v_theme_a;
  RESET ROLE;
  INSERT INTO stlc_results VALUES (11,
    'an outsider cannot read the selection it wrote',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- 12. CLEAR ALL removes only the caller's own row.
  -- ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_res := save_theme_layout_customization(
      v_theme_a, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, null);
    RESET ROLE;
    SELECT count(*) INTO v_count FROM user_theme_layout_selections
     WHERE theme_id IN (v_theme_a, v_theme_b);
    INSERT INTO stlc_results VALUES (12,
      'clear-all removes the caller''s row and leaves other themes alone',
      (v_res->>'status') = 'cleared',
      format('status %s, remaining rows across both themes %s',
             v_res->>'status', v_count));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO stlc_results VALUES (12,
      'clear-all removes the caller''s row and leaves other themes alone',
      false, format('raised %s: %s', SQLSTATE, SQLERRM));
  END;

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  DELETE FROM audit_events
   WHERE action_category = 'research_layout'
     AND org_id IN (v_org_a, v_org_b);
  DELETE FROM user_theme_layout_selections WHERE theme_id IN (v_theme_a, v_theme_b);
  DELETE FROM theme_layout_collaborations WHERE layout_id = v_layout;
  DELETE FROM user_theme_page_layouts WHERE id = v_layout;
  DELETE FROM theme_research_fields WHERE id = v_field;
  DELETE FROM theme_research_sections WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM themes WHERE id IN (v_theme_a, v_theme_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);

  UPDATE users u
     SET current_organization_id = NULLIF(v_orig->>u.id::text, 'null')::uuid
   WHERE u.id IN (v_owner, v_peer, v_outsider, v_dual);

  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

  /*
   * ── Abort by default ───────────────────────────────────────────────────
   *
   * The sibling test (`theme-page-layouts-tenant-isolation.sql`) tells the
   * reader to hand-edit its last line into a RAISE EXCEPTION to get a
   * zero-residue run. That is a instruction a tired reader skips, and the
   * run that skips it is the one that leaves two organizations and four
   * repointed users behind if an assertion raises before CLEANUP.
   *
   * So the abort is the default here and persisting is the opt-in. The
   * report is built BEFORE the raise, so it travels out in the error
   * message; the raise then unwinds every insert, update and delete above,
   * including the borrowed users' `current_organization_id`, whether or not
   * CLEANUP was reached.
   *
   * To keep the rows instead (CI against a shadow database, or debugging):
   *
   *   SET stlc.persist = 'on';
   *
   * then run the block and read `stlc_results`.
   */
  SELECT string_agg(
           format('#%s %s :: %s -- %s', seq,
                  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END, label, detail),
           E'\n' ORDER BY seq)
    INTO v_report
    FROM stlc_results;

  v_report := format('%s PASS, %s FAIL%s%s',
    (SELECT count(*) FROM stlc_results WHERE passed),
    (SELECT count(*) FROM stlc_results WHERE NOT passed),
    E'\n', v_report);

  IF coalesce(current_setting('stlc.persist', true), 'off') = 'on' THEN
    RAISE NOTICE '%', v_report;
  ELSE
    RAISE EXCEPTION 'ROLLBACK-BY-DESIGN :: %s', v_report
      USING DETAIL = v_report;
  END IF;
END $$;

SELECT seq,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       label,
       detail
  FROM stlc_results
 ORDER BY seq;

SELECT count(*) FILTER (WHERE passed)       AS passed,
       count(*) FILTER (WHERE NOT passed)   AS failed
  FROM stlc_results;
