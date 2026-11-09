-- =============================================================================
-- workflow_stages — tenant isolation regression test
--
-- Proves the exposure closed by 20261023150000_workflow_stages_tenant_
-- isolation: `workflow_stages` carried the SELECT policy it was given before
-- workflows belonged to organizations, whose second branch called the
-- SECURITY DEFINER helper `user_has_workflow_access`. That helper returned
-- TRUE for any `is_public` workflow without checking who was asking or which
-- organization owned it — so an unauthenticated caller holding the anon key
-- read 76 stage rows across 18 workflows and 4 organizations.
--
-- Run it BEFORE the migration to watch it fail, and after to watch it pass.
-- The passing run on its own proves nothing (CLAUDE.md standing rule 3).
--
-- Designed to run from the SQL editor (service role), psql, or CI against a
-- shadow database. Every probe assumes the `authenticated` or `anon` role and
-- forges a JWT claim the way PostgREST presents a request, then drops back to
-- the owning role immediately. Self-cleaning, and it restores the borrowed
-- users' real current organization.
--
-- ── Two statements on purpose ────────────────────────────────────────────
--
-- The first populates `ws_isolation_results` and raises nothing, so a probe
-- can read every assertion's outcome. The second turns that table into a
-- failure. Splitting them is what makes the pre-migration run legible: an
-- exception in the first would abort the transaction and take the evidence
-- with it.
--
-- ── Added on review (14-19) ──────────────────────────────────────────────
--
-- The stage policy is not the only consumer of the helper, and the helper is
-- itself reachable as a PostgREST RPC. 14-16 cover those paths;
-- `workflow_rule_executions` is given a row first, because it was EMPTY
-- during the original investigation and emptiness, not its policy, was doing
-- the work. 17-18 cover a cross-organization collaboration row, which is the
-- case the helper's deliberately organization-blind collaborator branch does
-- NOT catch and the policy's organization term does. 19 covers a membership
-- that is `active` but past `expires_at`, which 11 ('inactive') does not.
--
-- 19 assertions.
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS ws_isolation_results (
  seq      int,
  label    text,
  passed   boolean,
  detail   text
) ON COMMIT DROP;

TRUNCATE ws_isolation_results;

DO $$
DECLARE
  v_suffix      text := substr(md5(random()::text), 1, 8);
  v_org_a       uuid;
  v_org_b       uuid;
  v_u_member    uuid;   -- active in org A, creator of the workflows
  v_u_other     uuid;   -- active in org A, no relationship to the private wf
  v_u_outsider  uuid;   -- active in org B only
  v_u_none      uuid;   -- inactive in org A: authenticated, no active org
  v_u_expired   uuid;   -- active in org A but past expires_at
  v_orig        jsonb;
  v_wf_public   uuid;
  v_wf_private  uuid;
  v_rule_id     uuid;
  v_count       int;
  v_bool        boolean;

  -- Records one assertion. `expected` is stated so a failure says what it
  -- wanted, not just that it was unhappy.
  PROCEDURE_NOTE constant text := 'workflow_stages tenant isolation';
BEGIN
  -- Five distinct identities. `users.id` references auth.users, so they must
  -- be borrowed rather than invented.
  SELECT id INTO v_u_member   FROM auth.users ORDER BY id OFFSET 0 LIMIT 1;
  SELECT id INTO v_u_other    FROM auth.users ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_u_outsider FROM auth.users ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO v_u_none     FROM auth.users ORDER BY id OFFSET 3 LIMIT 1;
  SELECT id INTO v_u_expired  FROM auth.users ORDER BY id OFFSET 4 LIMIT 1;

  IF v_u_expired IS NULL THEN
    INSERT INTO ws_isolation_results
      VALUES (0, 'SKIPPED: need 5 auth users to model five identities', true, null);
    RETURN;
  END IF;

  -- Remember the borrowed users' real current organization.
  SELECT jsonb_object_agg(id::text, to_jsonb(current_organization_id))
    INTO v_orig
    FROM users
   WHERE id IN (v_u_member, v_u_other, v_u_outsider, v_u_none, v_u_expired);

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug)
    VALUES ('WS Org A ' || v_suffix, 'ws-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug)
    VALUES ('WS Org B ' || v_suffix, 'ws-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO organization_memberships (user_id, organization_id, role, status)
    VALUES (v_u_member,   v_org_a, 'member', 'active'),
           (v_u_other,    v_org_a, 'member', 'active'),
           (v_u_outsider, v_org_b, 'member', 'active'),
           -- Inactive, so "denied" cannot be explained by having no row.
           -- `chk_org_membership_status` allows active/inactive/invited/pending.
           (v_u_none,     v_org_a, 'member', 'inactive');

  /*
   * An ACTIVE membership that has already expired. Inserted in this state
   * rather than transitioned into it: `enforce_org_membership_status_
   * transition` raises P0011 on inactive -> active unless auth.uid() is an
   * active org admin, and this block runs with no JWT.
   */
  INSERT INTO organization_memberships (user_id, organization_id, role, status, expires_at)
    VALUES (v_u_expired, v_org_a, 'member', 'active', now() - interval '1 day');

  UPDATE users SET current_organization_id = v_org_a
   WHERE id IN (v_u_member, v_u_other, v_u_none, v_u_expired);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_u_outsider;

  -- Org A's workflows: one public to the firm, one private to its creator.
  INSERT INTO workflows (name, is_public, created_by, organization_id)
    VALUES ('WS Public ' || v_suffix, true, v_u_member, v_org_a) RETURNING id INTO v_wf_public;
  INSERT INTO workflows (name, is_public, created_by, organization_id)
    VALUES ('WS Private ' || v_suffix, false, v_u_member, v_org_a) RETURNING id INTO v_wf_private;

  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, sort_order)
    VALUES (v_wf_public,  'research', 'Research', 'How this firm does diligence', 0),
           (v_wf_public,  'decide',   'Decide',   'How this firm decides',        1),
           (v_wf_private, 'secret',   'Secret',   'Private to its creator',       0);

  -- ===========================================================================
  -- SAME-ORGANIZATION USE MUST KEEP WORKING
  -- ===========================================================================

  -- 1. Authorized read of a public workflow's stages.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_member, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_public;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (1,
    'same-org member reads stages of a public workflow',
    v_count = 2, format('saw %s, expected 2', v_count));

  -- 2. The creator reads their own private workflow's stages.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_member, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_private;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (2,
    'creator reads stages of their own private workflow',
    v_count = 1, format('saw %s, expected 1', v_count));

  -- 3. The public contract: public means public TO THE ORGANIZATION. Another
  --    member of org A sees it; the private workflow stays private to them.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_other, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_public;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (3,
    'another member of the owning org sees the public stages',
    v_count = 2, format('saw %s, expected 2', v_count));

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_other, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_private;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (4,
    'a private workflow stays private from other members of the same org',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- 5. The collaborator contract: an admin collaborator reads it.
  /*
   * `invited_by` is set deliberately. The AFTER INSERT trigger
   * `notify_workflow_sharing()` builds its notification message by
   * concatenating the inviter's name, and a NULL inviter makes the whole
   * string NULL, which then violates `notifications.message NOT NULL`. So a
   * collaboration row inserted without an inviter raises 23502 in
   * production. That is a real defect in that trigger, reported separately;
   * this test routes around it rather than exercising it.
   */
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
    VALUES (v_wf_private, v_u_other, 'admin', v_u_member);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_other, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_private;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (5,
    'an admin collaborator reads the private workflow''s stages',
    v_count = 1, format('saw %s, expected 1', v_count));
  DELETE FROM workflow_collaborations WHERE workflow_id = v_wf_private AND user_id = v_u_other;

  -- 6. Authorized write: the creator edits a stage in their own organization.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_member, 'role', 'authenticated')::text, true);
  UPDATE workflow_stages SET stage_label = 'Research (edited)'
   WHERE workflow_id = v_wf_public AND stage_key = 'research';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (6,
    'creator updates a stage in their own organization',
    v_count = 1, format('updated %s, expected 1', v_count));

  -- 7. Unauthorized write inside the same organization: a member who is
  --    neither the creator nor an admin collaborator on this workflow.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_other, 'role', 'authenticated')::text, true);
  UPDATE workflow_stages SET stage_label = 'Hijacked' WHERE workflow_id = v_wf_public;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (7,
    'a non-owning org member cannot edit the public workflow''s stages',
    v_count = 0, format('edited %s, expected 0', v_count));

  -- ===========================================================================
  -- THE TENANT BOUNDARY
  -- ===========================================================================

  -- 8. Cross-organization READ. This is the vulnerability.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id IN (v_wf_public, v_wf_private);
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (8,
    'a member of another organization cannot read public stages',
    v_count = 0, format('read %s rows across the tenant boundary, expected 0', v_count));

  -- 9. Cross-organization WRITE.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  UPDATE workflow_stages SET stage_label = 'Cross-org write' WHERE workflow_id = v_wf_public;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (9,
    'a member of another organization cannot edit stages',
    v_count = 0, format('wrote %s rows across the tenant boundary, expected 0', v_count));

  -- 10. Cross-organization INSERT: a stage smuggled into another org's process.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order)
      VALUES (v_wf_public, 'smuggled', 'Smuggled', 99);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_count := 0;
  END;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (10,
    'a member of another organization cannot insert a stage',
    v_count = 0, format('inserted %s, expected 0', v_count));

  -- 11. An authenticated identity whose only membership is INACTIVE.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_none, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id IN (v_wf_public, v_wf_private);
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (11,
    'an inactive member of the owning organization is denied',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- 12. ANON — the worst form. The anon key ships in the browser bundle, so
  --     this assertion is "readable by anyone on the internet".
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_count FROM workflow_stages;
  EXCEPTION WHEN insufficient_privilege THEN
    -- The grant was revoked outright, which is the stronger outcome.
    v_count := 0;
  END;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (12,
    'the anon role reads no stages at all',
    v_count = 0, format('anon read %s rows, expected 0', v_count));

  -- 13. The helper itself, not just the policy calling it. Any future policy
  --     calling `user_has_workflow_access` alone inherits this answer —
  --     `workflow_rule_executions` already does.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  SELECT user_has_workflow_access(v_wf_public, v_u_outsider) INTO v_bool;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (13,
    'user_has_workflow_access denies a public workflow across organizations',
    v_bool IS NOT TRUE, format('helper returned %s, expected false', v_bool));

  -- ===========================================================================
  -- THE DEPENDENT PATHS (added on review)
  -- ===========================================================================

  -- 14. The helper invoked DIRECTLY by anon. Every function in `public` is an
  --     RPC endpoint under PostgREST, so this is a real call path and not a
  --     theoretical one. The policy being correct does not make it safe.
  SET LOCAL ROLE anon;
  BEGIN
    SELECT user_has_workflow_access(v_wf_public, NULL) INTO v_bool;
  EXCEPTION WHEN insufficient_privilege THEN
    v_bool := false;
  END;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (14,
    'user_has_workflow_access answers false when anon calls it directly',
    v_bool IS NOT TRUE, format('helper returned %s to anon, expected false', v_bool));

  -- 15/16. `workflow_rule_executions` SELECT is the bare helper call with no
  --     organization term of its own. It held 0 rows during the original
  --     investigation, so its emptiness was doing the work its policy was
  --     credited with. Give it one row and ask again.
  INSERT INTO workflow_automation_rules
      (workflow_id, rule_name, rule_type, condition_type, action_type, rule_category, created_by)
    VALUES (v_wf_public, 'WS Rule ' || v_suffix, 'time', 'time_interval',
            'branch_nocopy', 'branch_creation', v_u_member)
    RETURNING id INTO v_rule_id;
  INSERT INTO workflow_rule_executions
      (workflow_id, rule_id, trigger_source, status, executed_by)
    VALUES (v_wf_public, v_rule_id, 'manual', 'success', v_u_member);

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_count FROM workflow_rule_executions;
  EXCEPTION WHEN insufficient_privilege THEN
    v_count := 0;
  END;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (15,
    'the anon role reads no rule executions',
    v_count = 0, format('anon read %s rows, expected 0', v_count));

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_rule_executions WHERE workflow_id = v_wf_public;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (16,
    'another organization cannot read this workflow''s rule executions',
    v_count = 0, format('read %s rows across the tenant boundary, expected 0', v_count));

  -- 17/18. A CROSS-ORGANIZATION collaboration row, read and write. The
  --     helper's collaborator branch is deliberately organization-blind, so
  --     these two prove the boundary is carried by the POLICY's organization
  --     term rather than by the helper. No such row exists in production
  --     today (0 of 16 verified), and nothing stops one being written.
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
    VALUES (v_wf_private, v_u_outsider, 'admin', v_u_member);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_private;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (17,
    'a cross-organization admin collaborator cannot read stages',
    v_count = 0, format('read %s rows, expected 0', v_count));

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_outsider, 'role', 'authenticated')::text, true);
  UPDATE workflow_stages SET stage_label = 'Cross-org collaborator write'
   WHERE workflow_id = v_wf_private;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (18,
    'a cross-organization admin collaborator cannot edit stages',
    v_count = 0, format('wrote %s rows, expected 0', v_count));

  DELETE FROM workflow_collaborations
   WHERE workflow_id = v_wf_private AND user_id = v_u_outsider;

  -- 19. A membership that is `active` but past `expires_at`. `current_org_id()`
  --     requires `expires_at IS NULL OR expires_at > now()`; assertion 11
  --     only covers a status of 'inactive', which is a different column.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u_expired, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id IN (v_wf_public, v_wf_private);
  RESET ROLE;
  INSERT INTO ws_isolation_results VALUES (19,
    'a member of the owning organization whose membership has expired is denied',
    v_count = 0, format('saw %s, expected 0', v_count));

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  DELETE FROM workflow_rule_executions   WHERE workflow_id IN (v_wf_public, v_wf_private);
  DELETE FROM workflow_automation_rules  WHERE workflow_id IN (v_wf_public, v_wf_private);
  DELETE FROM workflow_collaborations  WHERE workflow_id IN (v_wf_public, v_wf_private);
  DELETE FROM workflow_stages          WHERE workflow_id IN (v_wf_public, v_wf_private);
  DELETE FROM workflows                WHERE id IN (v_wf_public, v_wf_private);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users u
     SET current_organization_id = NULLIF(v_orig ->> u.id::text, 'null')::uuid
   WHERE u.id IN (v_u_member, v_u_other, v_u_outsider, v_u_none, v_u_expired);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

  RAISE NOTICE '% — recorded % assertions', PROCEDURE_NOTE,
    (SELECT count(*) FROM ws_isolation_results);
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
    FROM ws_isolation_results;

  IF v_failed > 0 THEN
    RAISE EXCEPTION E'workflow_stages tenant isolation: % of % assertions FAILED\n  %',
      v_failed, v_total, v_names;
  END IF;
  RAISE NOTICE 'workflow_stages tenant isolation: all % assertions passed', v_total;
END $$;
