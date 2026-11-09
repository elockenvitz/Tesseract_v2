-- =============================================================================
-- asset_list_items — own-row authorization regression test
--
-- Proves the gap closed by 20261026120000_list_items_own_row_authorization:
-- the DELETE and UPDATE policies admitted the list owner and ANY write/admin
-- collaborator for ANY row, with no reference to who added the row and no
-- reference to the parent list's `list_type`.
--
-- The product rule (`src/lib/lists/list-permissions.ts`) is narrower:
--
--   list_type = 'mutual'        -> any write-access user may remove any row
--   list_type = 'collaborative' -> only `added_by = auth.uid()` may remove it,
--                                  and that restriction applies to the list
--                                  OWNER too
--
-- So on a collaborative list a write collaborator could delete another
-- contributor's membership row, and edit its notes, by calling PostgREST
-- directly. The UI hides the control, which is not enforcement.
--
-- Run it BEFORE the migration to watch it fail, and after to watch it pass.
-- The passing run on its own proves nothing (CLAUDE.md standing rule 3).
--
-- Designed to run from the SQL editor (service role), psql, or CI against a
-- shadow database. Every probe assumes the `authenticated` role and forges a
-- JWT claim the way PostgREST presents a request, then drops back to the
-- owning role immediately. Self-cleaning.
--
-- ── Two statements on purpose ────────────────────────────────────────────
--
-- The first populates `ali_authz_results` and raises nothing, so a probe can
-- read every assertion's outcome. The second turns that table into a
-- failure. Splitting them is what makes the pre-migration run legible: an
-- exception in the first would abort the transaction and take the evidence
-- with it.
--
-- ── On the NULL `added_by` case (assertions 7-8) ─────────────────────────
--
-- `added_by` is nullable with no default. Under a policy that says only
-- `added_by = auth.uid()` may delete, a row with a NULL author is deletable
-- by NOBODY, forever — `NULL = uuid` is never true. There are 0 such rows in
-- production today, but the column permits them, so the policy gives the list
-- OWNER the fallback. That is deliberately BROADER than the product rule,
-- which would deny the owner too; it is the alternative to an undeletable
-- row. Asserted both ways so the choice is visible rather than incidental.
--
-- ── Why there is no 'admin' collaborator here ────────────────────────────
--
-- `asset_list_collaborations.permission` carries TWO check constraints:
-- `asset_list_collaborations_permission_check` permits read/write/admin, and
-- `valid_permission` permits read/write. Both must hold, so 'admin' cannot be
-- stored at all and every policy's `permission = ANY(ARRAY['admin','write'])`
-- branch is dead with respect to 'admin'. The second collaborator below is
-- therefore another 'write', which is the real second-contributor case.
-- Recorded as a separate finding; not reconciled here.
--
-- 16 assertions.
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS ali_authz_results (
  seq      int,
  label    text,
  passed   boolean,
  detail   text
) ON COMMIT DROP;

TRUNCATE ali_authz_results;

DO $$
DECLARE
  v_suffix     text := substr(md5(random()::text), 1, 8);
  v_org        uuid;
  v_owner      uuid;   -- creates both lists
  v_writer     uuid;   -- collaborator, permission 'write'
  v_admin      uuid;   -- a SECOND collaborator, permission 'write' (see header)
  v_reader     uuid;   -- collaborator, permission 'read'
  v_stranger   uuid;   -- no collaboration row at all
  v_orig       jsonb;

  v_collab     uuid;   -- list_type = 'collaborative'
  v_mutual     uuid;   -- list_type = 'mutual'

  v_c_owner    uuid;   -- collaborative row added by the owner
  v_c_writer   uuid;   -- collaborative row added by the writer
  v_c_admin    uuid;   -- collaborative row added by the admin
  v_c_null     uuid;   -- collaborative row with added_by IS NULL
  v_m_owner    uuid;   -- mutual row added by the owner
  v_m_writer   uuid;   -- mutual row added by the writer

  v_count      int;
  v_notes      text;

  PROCEDURE_NOTE constant text := 'asset_list_items own-row authorization';
BEGIN
  -- Five distinct identities. `users.id` references auth.users, so they must
  -- be borrowed rather than invented.
  SELECT id INTO v_owner    FROM auth.users ORDER BY id OFFSET 0 LIMIT 1;
  SELECT id INTO v_writer   FROM auth.users ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_admin    FROM auth.users ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO v_reader   FROM auth.users ORDER BY id OFFSET 3 LIMIT 1;
  SELECT id INTO v_stranger FROM auth.users ORDER BY id OFFSET 4 LIMIT 1;

  IF v_stranger IS NULL THEN
    INSERT INTO ali_authz_results
      VALUES (0, 'SKIPPED: need 5 auth users to model five identities', true, null);
    RETURN;
  END IF;

  SELECT jsonb_object_agg(id::text, to_jsonb(current_organization_id))
    INTO v_orig
    FROM users
   WHERE id IN (v_owner, v_writer, v_admin, v_reader, v_stranger);

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug)
    VALUES ('ALI Org ' || v_suffix, 'ali-' || v_suffix) RETURNING id INTO v_org;

  INSERT INTO organization_memberships (user_id, organization_id, role, status)
    VALUES (v_owner,    v_org, 'member', 'active'),
           (v_writer,   v_org, 'member', 'active'),
           (v_admin,    v_org, 'member', 'active'),
           (v_reader,   v_org, 'member', 'active'),
           (v_stranger, v_org, 'member', 'active');

  UPDATE users SET current_organization_id = v_org
   WHERE id IN (v_owner, v_writer, v_admin, v_reader, v_stranger);

  INSERT INTO asset_lists (name, created_by, list_type, organization_id)
    VALUES ('ALI collaborative ' || v_suffix, v_owner, 'collaborative', v_org)
    RETURNING id INTO v_collab;
  INSERT INTO asset_lists (name, created_by, list_type, organization_id)
    VALUES ('ALI mutual ' || v_suffix, v_owner, 'mutual', v_org)
    RETURNING id INTO v_mutual;

  -- The same three collaborators on both lists, so a difference in outcome is
  -- attributable to `list_type` and nothing else.
  INSERT INTO asset_list_collaborations (list_id, user_id, permission, invited_by)
    VALUES (v_collab, v_writer, 'write', v_owner),
           (v_collab, v_admin,  'write', v_owner),
           (v_collab, v_reader, 'read',  v_owner),
           (v_mutual, v_writer, 'write', v_owner),
           (v_mutual, v_admin,  'write', v_owner),
           (v_mutual, v_reader, 'read',  v_owner);

  -- `asset_id` is nullable, so the rows need no asset fixture.
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_collab, v_owner,  'owner row')   RETURNING id INTO v_c_owner;
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_collab, v_writer, 'writer row')  RETURNING id INTO v_c_writer;
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_collab, v_admin,  'admin row')   RETURNING id INTO v_c_admin;
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_collab, NULL,     'orphan row')  RETURNING id INTO v_c_null;
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_mutual, v_owner,  'owner row')   RETURNING id INTO v_m_owner;
  INSERT INTO asset_list_items (list_id, added_by, notes)
    VALUES (v_mutual, v_writer, 'writer row')  RETURNING id INTO v_m_writer;

  -- ---------------------------------------------------------------------------
  -- COLLABORATIVE: DELETE is restricted to the row's own author
  -- ---------------------------------------------------------------------------

  -- 1. The reported gap: a write collaborator reaching another member's row.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_owner;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (1,
    'collaborative: a write collaborator cannot delete the owner''s row',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 2. And another collaborator's row, not just the owner's.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_admin;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (2,
    'collaborative: a write collaborator cannot delete another collaborator''s row',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 3. The legitimate case must still work, or the fix is just a lockout.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (3,
    'collaborative: a write collaborator CAN delete their own row',
    v_count = 1, format('deleted %s, expected 1', v_count));
  -- Restore it for the assertions below.
  INSERT INTO asset_list_items (id, list_id, added_by, notes)
    VALUES (v_c_writer, v_collab, v_writer, 'writer row');

  -- 4. The restriction applies to the list OWNER too — this is the part of the
  --    product rule most likely to be "fixed" away by someone restoring owner
  --    override, so it is stated explicitly.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (4,
    'collaborative: the list OWNER cannot delete a contributor''s row',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 5. Nor does holding write access via a second collaboration row.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (5,
    'collaborative: a second write collaborator cannot delete a contributor''s row',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 6. The owner's own row remains the owner's to remove.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_owner;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (6,
    'collaborative: the owner CAN delete their own row',
    v_count = 1, format('deleted %s, expected 1', v_count));

  -- 7. The NULL-author fallback: deliberately broader than the product rule,
  --    because the alternative is a row no one can ever remove.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_null;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (7,
    'collaborative: the owner CAN delete a row whose added_by is NULL',
    v_count = 1, format('deleted %s, expected 1', v_count));
  INSERT INTO asset_list_items (id, list_id, added_by, notes)
    VALUES (v_c_null, v_collab, NULL, 'orphan row');

  -- 8. ...but that fallback is the OWNER's only, not every write collaborator's.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_c_null;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (8,
    'collaborative: a write collaborator cannot delete a NULL-author row',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 9. Read-only collaborators were never admitted and still are not.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reader, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE list_id = v_collab;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (9,
    'collaborative: a read-only collaborator deletes nothing',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- 10. And an authenticated identity with no collaboration row at all.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE list_id = v_collab;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (10,
    'collaborative: a non-collaborator deletes nothing',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- MUTUAL: shared ownership is the point, and must NOT regress
  -- ---------------------------------------------------------------------------

  -- 11. The behaviour the narrowing must preserve.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_m_owner;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (11,
    'mutual: a write collaborator CAN delete the owner''s row',
    v_count = 1, format('deleted %s, expected 1', v_count));

  -- 12. Symmetrically.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE id = v_m_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (12,
    'mutual: the owner CAN delete a contributor''s row',
    v_count = 1, format('deleted %s, expected 1', v_count));
  INSERT INTO asset_list_items (id, list_id, added_by, notes)
    VALUES (v_m_writer, v_mutual, v_writer, 'writer row');

  -- 13. Write access is still required on a mutual list.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  DELETE FROM asset_list_items WHERE list_id = v_mutual;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (13,
    'mutual: a non-collaborator deletes nothing',
    v_count = 0, format('deleted %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- UPDATE carries the identical gap, because it carries the identical policy
  -- ---------------------------------------------------------------------------

  -- 14. Editing someone else's note on a collaborative list.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  UPDATE asset_list_items SET notes = 'tampered' WHERE id = v_c_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (14,
    'collaborative: a write collaborator CAN edit the notes on their own row',
    v_count = 1, format('updated %s, expected 1', v_count));

  -- 15. The foreign case.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  UPDATE asset_list_items SET notes = 'tampered' WHERE id = v_c_admin;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  SELECT notes INTO v_notes FROM asset_list_items WHERE id = v_c_admin;
  INSERT INTO ali_authz_results VALUES (15,
    'collaborative: a write collaborator cannot edit another member''s notes',
    v_count = 0 AND v_notes = 'admin row',
    format('updated %s (expected 0), notes now %L (expected %L)',
           v_count, v_notes, 'admin row'));

  -- 16. Mutual notes stay shared.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
  UPDATE asset_list_items SET notes = 'shared edit' WHERE id = v_m_writer;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ali_authz_results VALUES (16,
    'mutual: a write collaborator CAN edit notes on any row',
    v_count = 1, format('updated %s, expected 1', v_count));

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  DELETE FROM asset_list_items         WHERE list_id IN (v_collab, v_mutual);
  DELETE FROM asset_list_collaborations WHERE list_id IN (v_collab, v_mutual);
  DELETE FROM asset_lists              WHERE id IN (v_collab, v_mutual);
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  UPDATE users u
     SET current_organization_id = NULLIF(v_orig ->> u.id::text, 'null')::uuid
   WHERE u.id IN (v_owner, v_writer, v_admin, v_reader, v_stranger);
  DELETE FROM organizations WHERE id = v_org;

  RAISE NOTICE '% — recorded % assertions', PROCEDURE_NOTE,
    (SELECT count(*) FROM ali_authz_results);
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
    FROM ali_authz_results;

  IF v_failed > 0 THEN
    RAISE EXCEPTION E'asset_list_items own-row authorization: % of % assertions FAILED\n  %',
      v_failed, v_total, v_names;
  END IF;
  RAISE NOTICE 'asset_list_items own-row authorization: all % assertions passed', v_total;
END $$;
