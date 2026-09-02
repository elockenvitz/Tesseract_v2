-- =============================================================================
-- Feed dispositions — ownership and isolation regression test
--
-- Proves the boundary established by:
--   20260902090000_feed_dispositions_personal_state.sql.draft
--
-- NEVER RUN. This test has not been executed against any database, and the
-- migration it proves is a DRAFT that has never been applied. The `.draft`
-- suffix keeps the migration out of any runner; this file is inert until
-- somebody points it at a NON-PRODUCTION environment on purpose.
--
-- It creates and deletes organizations, auth users and memberships. Do not run
-- it against production for any reason, including "just to see".
--
-- Run it BEFORE that migration to watch it fail and after to watch it pass; a
-- passing run on its own proves only that the test is not wired to anything.
-- Before the migration, expect assertions 1-4 to fail on missing columns and
-- the missing function, and 9-11 to fail on the `anon` grant and `TO public`
-- policies.
--
-- ── What it is actually asserting ─────────────────────────────────────────
--
-- One property, from several directions: **a personal disposition is one
-- person's, and nothing about it can reach a colleague or a shared object.**
--
-- The read probes assume the `authenticated` role and forge a JWT claim the way
-- PostgREST presents a request, then drop back immediately. A read made as the
-- owning role would bypass RLS entirely and prove nothing — which is the trap
-- this file exists to avoid, because "user B cannot see it" is precisely the
-- claim that looks true from a superuser session no matter what the policy says.
--
-- Self-cleaning. 12 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid;
  v_org_b    uuid;
  v_alice    uuid := gen_random_uuid();
  v_bob      uuid := gen_random_uuid();
  v_key      text;
  v_count    int;
  v_org      uuid;
  v_until    timestamptz;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== Feed disposition ownership (suffix: %) ===', v_suffix;

  -- ---------------------------------------------------------------------------
  -- SETUP — two analysts in one organization, which is the interesting case.
  -- Isolation between strangers is easy; isolation between colleagues looking
  -- at the same object is the thing that matters.
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('FD Org A ' || v_suffix, 'fd-a-' || v_suffix)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('FD Org B ' || v_suffix, 'fd-b-' || v_suffix)
    RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_alice, 'fd_alice_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_bob,   'fd_bob_'   || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status) VALUES
    (v_org_a, v_alice, 'active'),
    (v_org_a, v_bob,   'active'),
    -- Alice is in both, so assertion 5 can check that a suppression in one org
    -- is not automatically a suppression in the other.
    (v_org_b, v_alice, 'active');

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_alice, v_bob);

  -- The card both of them are looking at. One asset, one finding, one key.
  v_key := 'signal:no_research:' || v_suffix;

  -- ===========================================================================
  -- 1. The write verb exists, takes no user id, and derives the caller
  -- ===========================================================================
  BEGIN
    PERFORM 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_feed_disposition';
    IF FOUND THEN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'set_feed_disposition'
           AND pg_get_function_arguments(p.oid) ILIKE '%user%'
      ) THEN
        RAISE NOTICE 'FAIL 1: set_feed_disposition accepts a user argument';
        v_fail := v_fail + 1;
      ELSE
        RAISE NOTICE 'PASS 1: set_feed_disposition takes no user id';
        v_pass := v_pass + 1;
      END IF;
    ELSE
      RAISE NOTICE 'FAIL 1: set_feed_disposition does not exist';
      v_fail := v_fail + 1;
    END IF;
  END;

  -- ===========================================================================
  -- 2. search_path is pinned — the standard the seven existing attention RPCs
  --    miss, and one this new function must not also miss.
  -- ===========================================================================
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_feed_disposition'
       AND p.proconfig IS NOT NULL
       AND array_to_string(p.proconfig, ',') LIKE '%search_path%'
  ) THEN
    RAISE NOTICE 'PASS 2: search_path pinned';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 2: search_path not pinned on set_feed_disposition';
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 3. Alice defers. The row is hers, keyed on her, and stamped with her org.
  -- ===========================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);

  PERFORM public.set_feed_disposition(
    v_key, 'no_research', 'defer', 'attention',
    now() + interval '3 days', NULL
  );

  SELECT count(*) INTO v_count
    FROM attention_user_state
   WHERE user_id = v_alice AND attention_id = v_key;

  IF v_count = 1 THEN
    RAISE NOTICE 'PASS 3: Alice''s disposition written to her own row';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 3: expected 1 row for Alice, found %', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 4. It persists — the whole reason this left localStorage. A fresh read in a
  --    fresh session (a reload, another device) finds the same window.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);

  SELECT snoozed_until INTO v_until
    FROM attention_user_state
   WHERE user_id = v_alice AND attention_id = v_key;

  IF v_until IS NOT NULL AND v_until > now() THEN
    RAISE NOTICE 'PASS 4: the deferral survives a new session';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 4: snoozed_until absent or already past (%)', v_until;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 5. The org was derived, not supplied. Alice is a member of two; the row
  --    belongs to the one she is currently in.
  -- ===========================================================================
  SELECT org_id INTO v_org
    FROM attention_user_state
   WHERE user_id = v_alice AND attention_id = v_key;

  IF v_org = v_org_a THEN
    RAISE NOTICE 'PASS 5: org_id stamped from the session';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 5: org_id is % (expected %)', v_org, v_org_a;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 6. THE ASSERTION THIS FILE EXISTS FOR.
  --    Bob is Alice's colleague, in the same org, looking at the same finding.
  --    Her deferral is invisible to him.
  -- ===========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count FROM attention_user_state WHERE attention_id = v_key;

  IF v_count = 0 THEN
    RAISE NOTICE 'PASS 6: Bob cannot see Alice''s disposition';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 6: Bob sees % rows for Alice''s key', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 7. And cannot write into it. Not a UNIQUE-violation error, which would be
  --    the wrong reason to pass — RLS must not let the row be found at all, so
  --    Bob's write becomes his own separate row.
  -- ===========================================================================
  PERFORM public.set_feed_disposition(
    v_key, 'no_research', 'feed_dismissed', 'triage',
    NULL, now() + interval '30 days'
  );

  SELECT count(*) INTO v_count
    FROM attention_user_state
   WHERE attention_id = v_key;  -- still RLS-filtered to Bob

  IF v_count = 1 THEN
    RAISE NOTICE 'PASS 7: Bob''s answer is his own row, not an edit of Alice''s';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 7: Bob sees % rows after writing', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 8. Two rows exist, one per user, on one object. Checked with RLS off,
  --    because this is the only assertion about what is really in the table.
  -- ===========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO v_count
    FROM attention_user_state
   WHERE attention_id = v_key;

  IF v_count = 2 THEN
    RAISE NOTICE 'PASS 8: user x object, two independent dispositions';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 8: expected 2 rows across both users, found %', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 9. Alice's deferral did not become Bob's. Different keys, different windows
  --    — the disposition is not shared truth wearing a per-user column.
  -- ===========================================================================
  IF EXISTS (
    SELECT 1 FROM attention_user_state
     WHERE attention_id = v_key AND user_id = v_alice
       AND disposition_key = 'defer' AND snoozed_until IS NOT NULL AND dismissed_until IS NULL
  ) AND EXISTS (
    SELECT 1 FROM attention_user_state
     WHERE attention_id = v_key AND user_id = v_bob
       AND disposition_key = 'feed_dismissed' AND dismissed_until IS NOT NULL AND snoozed_until IS NULL
  ) THEN
    RAISE NOTICE 'PASS 9: each answer kept its own key and window';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 9: the two dispositions were conflated';
    v_fail := v_fail + 1;
  END IF;

  -- ===========================================================================
  -- 10. The namespace is enforced server-side. A feed write must not be able to
  --     land on an attention row and suppress a colleague's queue item.
  -- ===========================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.set_feed_disposition(
      'a3f9c2b18e4d5a6f7b8c9d0e1f2a3b4c', 'no_research', 'defer', 'attention',
      now() + interval '3 days', NULL
    );
    RAISE NOTICE 'FAIL 10: an un-namespaced key was accepted';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS 10: un-namespaced keys refused';
    v_pass := v_pass + 1;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ===========================================================================
  -- 11. `anon` holds nothing. RLS already denies it (auth.uid() is NULL), but
  --     this is the grant pattern the Quick Thoughts work removed, and this
  --     migration is making the table more interesting rather than less.
  -- ===========================================================================
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'attention_user_state'
       AND grantee = 'anon'
  ) THEN
    RAISE NOTICE 'FAIL 11: anon still holds grants on attention_user_state';
    v_fail := v_fail + 1;
  ELSE
    RAISE NOTICE 'PASS 11: anon holds no grant';
    v_pass := v_pass + 1;
  END IF;

  -- ===========================================================================
  -- 12. Every policy is `TO authenticated` and compares to auth.uid(). The
  --     predicate is the line that makes assertion 6 true; assert it directly
  --     so a future policy edit cannot quietly widen it.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'attention_user_state'
     AND (
       'authenticated' <> ALL(roles)
       OR (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%auth.uid()%'
     );

  IF v_count = 0 THEN
    RAISE NOTICE 'PASS 12: every policy is TO authenticated and keyed on auth.uid()';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE 'FAIL 12: % policies are broader than auth.uid() = user_id', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  DELETE FROM attention_user_state WHERE user_id IN (v_alice, v_bob);
  DELETE FROM organization_memberships WHERE user_id IN (v_alice, v_bob);
  DELETE FROM users WHERE id IN (v_alice, v_bob);
  DELETE FROM auth.users WHERE id IN (v_alice, v_bob);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);

  RAISE NOTICE '=== % passed, % failed ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'feed-disposition-ownership: % assertions failed', v_fail;
  END IF;
END $$;
