-- =============================================================================
-- Writer-controlled publication: ai_column_library and rating_scales
--
-- THE DEFECT
--
--   Both tables decide who may READ a row from a column the WRITER controls.
--
--     ai_column_library  SELECT TO public USING (is_system = true OR user_id = auth.uid())
--                        ALL    TO public USING/CHECK (user_id = auth.uid())
--
--     rating_scales      SELECT TO public USING (is_system = true
--                                            OR organization_id IS NULL
--                                            OR (organization_id = current_org_id()
--                                                AND is_active_member_of_current_org()))
--                        ALL    TO public USING (created_by = auth.uid()
--                                            OR (organization_id = current_org_id()
--                                                AND is_active_org_admin_of_current_org()))
--                               -- WITH CHECK omitted, so it falls back to USING
--
--   Nothing in either write rule constrains `is_system`, and nothing in
--   rating_scales constrains `organization_id`. So any authenticated user could
--   write a row of their own and flip it into the branch that admits everyone:
--   set is_system = true, or (on rating_scales) clear organization_id. Both
--   tables also carried an anon SELECT grant with a `TO public` policy, so the
--   published row was readable with no session at all.
--
--   That is a self-service pre-authentication publishing primitive. It is the
--   same mistake as a `created_by IS NULL` provenance claim: a column the
--   client can write cannot be the thing that says "this row is ours".
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE the fix:  7 PASS / 8 FAIL  (measured 2026-11-10 against production)
--   AFTER the fix:  15 PASS / 0 FAIL  (measured in a rolled-back transaction
--                                      carrying the migration, then again
--                                      against production after deployment)
--
--   The 8 failures are 1, 2, 3, 4, 5, 7, 8 and 9.
--
--   Assertion 6 -- clearing organization_id on an existing org row -- ALREADY
--   PASSED before the fix, which was not what I predicted when I wrote it. The
--   reason is worth keeping: the old write policy declared no WITH CHECK, so
--   the post-image check fell back to its USING clause, and a row with
--   organization_id NULL satisfies neither `created_by = auth.uid()` (NULL on
--   every production row) nor `organization_id = current_org_id()`. So that one
--   channel was closed by accident rather than by design. Assertion 7 shows the
--   same goal reached by INSERT instead, and that one DID work.
--
--   Assertions 10-15 are the preserve half and pass in BOTH states -- which is
--   the point of including them, because a fix that denied everyone would pass
--   1-9 and be worthless.
--
--   Every attack assertion deletes whatever it managed to write before the next
--   one runs. Without that, a SUCCESSFUL attack inflates the system-row counts
--   that 12, 13 and 15 check, and the preserve half fails in the before-state
--   for a reason that has nothing to do with what it is testing. That is not
--   hypothetical: it is what the first run of this suite did.
--
-- ── What this does NOT prove ────────────────────────────────────────────────
--
--   That `is_default` cannot be hijacked. A rating scale's `is_default` flag is
--   also writer-controlled; after this fix its blast radius is the writer's own
--   organization, which is a product question rather than a tenant boundary.
--   Listed as a separate finding, deliberately not fixed here.
--
-- Self-cleaning. 15 assertions. Safe to run against production: every write is
-- made as a synthetic user, and the fixtures are deleted at the end.
-- =============================================================================

DROP TABLE IF EXISTS _sfp_results;
CREATE TEMP TABLE _sfp_results(n int, result text, detail text);

DO $$
DECLARE
  v_sfx     text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_member  uuid := gen_random_uuid();   -- plain active member of org A
  v_admin   uuid := gen_random_uuid();   -- org admin of org A
  v_outside uuid := gen_random_uuid();   -- active member of org B
  v_col     uuid;                        -- an ai_column_library row owned by v_member
  v_scale   uuid;                        -- a rating_scales row owned by org A
  v_denied  boolean;
  v_count   int;
  v_sys_cols int;
  v_sys_scl  int;
  v_pass    int := 0;
  v_fail    int := 0;

  -- Every probe writes a name carrying the suffix, so cleanup is exact and a
  -- half-failed run cannot leave a row that a later run mistakes for a seed.
  c_name text := 'SFP probe ' || v_sfx;
  c_vals jsonb := '[{"value":"1","label":"Yes","sort":1}]'::jsonb;
BEGIN
  RAISE NOTICE '=== writer-controlled publication (suffix: %) ===', v_sfx;

  SELECT count(*) INTO v_sys_cols FROM ai_column_library WHERE is_system;
  SELECT count(*) INTO v_sys_scl  FROM rating_scales     WHERE is_system;

  -- ===========================================================================
  -- FIXTURES. Written as the table owner, which is what a migration or the
  -- platform-admin RPC looks like.
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('SFP A ' || v_sfx, 'sfp-a-' || v_sfx) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('SFP B ' || v_sfx, 'sfp-b-' || v_sfx) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_member,  'sfp_m_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_admin,   'sfp_a_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outside, 'sfp_o_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_member,  'active', false),
    (v_org_a, v_admin,   'active', true),
    (v_org_b, v_outside, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_member, v_admin);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outside;

  -- A column the member legitimately owns, and an org scale org A legitimately owns.
  INSERT INTO ai_column_library (user_id, name, prompt)
    VALUES (v_member, c_name || ' col', 'summarise the thesis') RETURNING id INTO v_col;
  INSERT INTO rating_scales (name, values, organization_id)
    VALUES (c_name || ' scale', c_vals, v_org_a) RETURNING id INTO v_scale;

  -- ===========================================================================
  -- 1. INSERT with is_system = true, as a plain member (ai_column_library).
  --    This is the primitive: the row is the member's own, so the write rule
  --    admits it, and `is_system = true` then admits every reader.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_column_library (user_id, name, prompt, is_system)
      VALUES (v_member, c_name || ' pub-insert', 'p', true);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (1,'PASS','ai_column_library: INSERT with is_system=true is denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (1,'FAIL','ai_column_library: a plain member PUBLISHED a row by inserting is_system=true'); END IF;
  -- Remove whatever the attack managed to create. Without this, a SUCCESSFUL
  -- attack inflates the system-row counts that assertions 12, 13 and 15 check,
  -- so the preserve half would fail in the before-state for a reason that has
  -- nothing to do with the behaviour it is testing. Every attack assertion
  -- below cleans up after itself for the same reason.
  DELETE FROM ai_column_library WHERE name = c_name || ' pub-insert';

  -- ===========================================================================
  -- 2. UPDATE own row to is_system = true (ai_column_library).
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_column_library SET is_system = true WHERE id = v_col;
    IF NOT FOUND THEN v_denied := true; END IF;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  -- Read back as the owner: a policy that silently filtered the row would make
  -- NOT FOUND look like a denial, so confirm the stored value too.
  SELECT count(*) INTO v_count FROM ai_column_library WHERE id = v_col AND is_system;
  IF v_denied AND v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (2,'PASS','ai_column_library: UPDATE own row to is_system=true is denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (2,'FAIL','ai_column_library: the owner PUBLISHED an existing row by setting is_system=true'); END IF;
  UPDATE ai_column_library SET is_system = false WHERE id = v_col;

  -- ===========================================================================
  -- 3. Upsert. ON CONFLICT DO UPDATE runs the UPDATE policy, and an upsert is
  --    how the client library writes, so it needs its own assertion.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_column_library (id, user_id, name, prompt, is_system)
      VALUES (v_col, v_member, c_name || ' col', 'p', true)
      ON CONFLICT (id) DO UPDATE SET is_system = true;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  SELECT count(*) INTO v_count FROM ai_column_library WHERE id = v_col AND is_system;
  IF v_denied AND v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (3,'PASS','ai_column_library: upsert cannot set is_system=true');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (3,'FAIL','ai_column_library: an upsert PUBLISHED the row'); END IF;
  UPDATE ai_column_library SET is_system = false WHERE id = v_col;

  -- ===========================================================================
  -- 4. INSERT with is_system = true, as an ORG ADMIN (rating_scales). The most
  --    privileged client role still must not be able to publish globally.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO rating_scales (name, values, organization_id, is_system, created_by)
      VALUES (c_name || ' pub-scale', c_vals, v_org_a, true, v_admin);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (4,'PASS','rating_scales: INSERT with is_system=true is denied even for an org admin');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (4,'FAIL','rating_scales: an org admin PUBLISHED a scale globally via is_system=true'); END IF;
  DELETE FROM rating_scales WHERE name = c_name || ' pub-scale';

  -- ===========================================================================
  -- 5. UPDATE an existing ORG-OWNED scale to is_system = true. This is the
  --    worst shape: real tenant data becomes world-readable in place.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE rating_scales SET is_system = true WHERE id = v_scale;
    IF NOT FOUND THEN v_denied := true; END IF;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  SELECT count(*) INTO v_count FROM rating_scales WHERE id = v_scale AND is_system;
  IF v_denied AND v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (5,'PASS','rating_scales: an org row cannot be flipped to is_system=true');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (5,'FAIL','rating_scales: TENANT DATA was published in place via is_system=true'); END IF;
  UPDATE rating_scales SET is_system = false WHERE id = v_scale;

  -- ===========================================================================
  -- 6. Clear organization_id on an org-owned scale. The old SELECT policy had
  --    an `organization_id IS NULL` branch, so orphaning a row published it.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE rating_scales SET organization_id = NULL WHERE id = v_scale;
    IF NOT FOUND THEN v_denied := true; END IF;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  SELECT count(*) INTO v_count FROM rating_scales WHERE id = v_scale AND organization_id IS NULL;
  IF v_denied AND v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (6,'PASS','rating_scales: organization_id cannot be cleared by a client');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (6,'FAIL','rating_scales: TENANT DATA was orphaned to organization_id=NULL and became readable'); END IF;
  UPDATE rating_scales SET organization_id = v_org_a WHERE id = v_scale;

  -- ===========================================================================
  -- 7. INSERT with organization_id = NULL. Same hole, reached by creation
  --    rather than by mutation.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO rating_scales (name, values, organization_id, created_by)
      VALUES (c_name || ' orphan', c_vals, NULL, v_admin);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (7,'PASS','rating_scales: INSERT with organization_id=NULL is denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (7,'FAIL','rating_scales: a client created an org-less, world-readable scale'); END IF;
  DELETE FROM rating_scales WHERE name = c_name || ' orphan';

  -- ===========================================================================
  -- 8. Plant a row into ANOTHER organization. The old write rule accepted any
  --    organization_id as long as `created_by = auth.uid()` held.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO rating_scales (name, values, organization_id, created_by)
      VALUES (c_name || ' planted', c_vals, v_org_b, v_admin);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (8,'PASS','rating_scales: a row cannot be planted into another organization');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (8,'FAIL','rating_scales: an org-A admin wrote a scale into org B'); END IF;
  DELETE FROM rating_scales WHERE name = c_name || ' planted';

  -- ===========================================================================
  -- 9. anon reads nothing from either table. Both carried an anon SELECT grant
  --    and a `TO public` policy, so the published row needed no session.
  -- ===========================================================================
  v_count := -1;
  BEGIN
    SET LOCAL ROLE anon;
    SELECT (SELECT count(*) FROM ai_column_library) + (SELECT count(*) FROM rating_scales) INTO v_count;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;  -- no grant at all
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (9,'PASS','anon reads nothing from ai_column_library or rating_scales');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (9,'FAIL',format('anon read %s row(s) with no session', v_count)); END IF;

  -- ===========================================================================
  -- PRESERVE. 10-15 must pass BEFORE and AFTER. A fix that denied everyone
  -- would satisfy 1-9 and be worthless.
  -- ===========================================================================

  -- 10. A member can still create a column of their own.
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_column_library (user_id, name, prompt)
      VALUES (v_member, c_name || ' mine', 'what are the catalysts');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF NOT v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (10,'PASS','a member can still create their own AI column');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (10,'FAIL','OVER-TIGHTENED: a member can no longer create their own AI column'); END IF;

  -- 11. ...and still rename and delete it.
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_column_library SET name = c_name || ' renamed' WHERE id = v_col;
    IF NOT FOUND THEN v_denied := true; END IF;
    DELETE FROM ai_column_library WHERE name = c_name || ' mine' AND user_id = v_member;
    IF NOT FOUND THEN v_denied := true; END IF;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF NOT v_denied THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (11,'PASS','a member can still rename and delete their own AI column');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (11,'FAIL','OVER-TIGHTENED: a member can no longer edit or delete their own AI column'); END IF;

  -- 12. A member still reads the system columns plus their own.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_column_library
      WHERE is_system OR user_id = v_member;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count >= v_sys_cols + 1 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (12,'PASS',format('a member reads %s column(s): the %s system seeds plus their own', v_count, v_sys_cols));
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (12,'FAIL',format('OVER-TIGHTENED: a member reads only %s of the expected %s+', v_count, v_sys_cols + 1)); END IF;

  -- 13. An org member still reads their own org's scales and the system seeds.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM rating_scales
      WHERE is_system OR id = v_scale;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = v_sys_scl + 1 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (13,'PASS',format('an org member reads the %s system scales plus their own org scale', v_sys_scl));
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (13,'FAIL',format('OVER-TIGHTENED: an org member reads %s, expected %s', v_count, v_sys_scl + 1)); END IF;

  -- 14. A member of ANOTHER org reads none of org A's scale. The tenant
  --     boundary that already worked must keep working.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outside, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM rating_scales WHERE id = v_scale;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (14,'PASS','a member of another org reads none of org A''s scales');
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (14,'FAIL',format('CROSS-ORG READ: org B read %s of org A''s scales', v_count)); END IF;

  -- 15. The trusted seed path still works: an owner-context insert carrying an
  --     explicit organization_id, which is exactly what provision_client_org
  --     does for every new client org. A CHECK constraint would have broken it.
  v_denied := false;
  BEGIN
    INSERT INTO rating_scales (name, values, organization_id)
      VALUES (c_name || ' provisioned', c_vals, v_org_b);
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  SELECT count(*) INTO v_count FROM ai_column_library WHERE is_system;
  IF NOT v_denied AND v_count = v_sys_cols THEN v_pass := v_pass + 1; INSERT INTO _sfp_results VALUES (15,'PASS',format('the trusted seed path still writes, and the %s system seeds are untouched', v_sys_cols));
  ELSE v_fail := v_fail + 1; INSERT INTO _sfp_results VALUES (15,'FAIL','the trusted provisioning insert was blocked, or a system seed changed'); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM ai_column_library WHERE name LIKE c_name || '%' OR user_id IN (v_member, v_admin, v_outside);
  DELETE FROM rating_scales     WHERE name LIKE c_name || '%' OR created_by IN (v_member, v_admin, v_outside);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_member, v_admin, v_outside);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  -- Drop each probe user's own lists BEFORE the user. `handle_new_user` gives a
  -- new auth user a default asset_list, whose list_statuses carry
  --   created_by -> users(id)     ON DELETE SET NULL
  --   list_id    -> asset_lists   ON DELETE CASCADE
  -- Deleting the user fires both: the list cascades away and the SET NULL then
  -- re-validates list_id against the row that just went, so the whole DELETE
  -- fails 23503. Removing the lists first makes the cascade single-sided.
  -- This is a real production defect, not a test artifact: deleting any user
  -- who owns a list hits it. Recorded as an adjacent finding, not fixed here.
  DELETE FROM list_statuses WHERE created_by IN (v_member, v_admin, v_outside);
  DELETE FROM asset_lists   WHERE created_by IN (v_member, v_admin, v_outside);
  DELETE FROM auth.users WHERE id IN (v_member, v_admin, v_outside);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 15 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sfp_results ORDER BY n, result;
