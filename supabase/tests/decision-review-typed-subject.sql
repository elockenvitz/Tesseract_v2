-- =============================================================================
-- decision_reviews typed subject — authorization + derivation regression test
--
-- Proves what 20261115120000_decision_review_typed_subject.sql claims, and
-- proves it does not take the review away from the colleague it exists for.
--
-- ── What is under test ──────────────────────────────────────────────────────
--
-- The migration adds `subject_type` plus three typed foreign keys to
-- `decision_reviews`, and derives all four SERVER-SIDE from `decision_id` in a
-- BEFORE INSERT OR UPDATE trigger, discarding whatever the client sent.
--
-- Two things could go wrong, and they fail in opposite directions:
--
--   TOO LOOSE  the trigger trusts the client, so a caller can point a review
--              at a decision it does not own, or mislabel what it reviewed.
--              Assertions 4, 5 and 6 are the ones that catch this, and they
--              are the whole reason the derivation is in the database rather
--              than in `useUpsertDecisionReview`.
--
--   TOO TIGHT  the new CHECK or the trigger refuses a legitimate review, or
--              the FKs make a reviewed idea undeletable, or ON DELETE CASCADE
--              silently destroys the learning. Assertions 3, 9, 10 and 11
--              catch these, and 10 is the one that would get the migration
--              reverted in production.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
-- BEFORE the migration: assertions 4 through 11 are expected to FAIL or ERROR,
-- because `subject_type` and the typed columns do not exist. 1, 2, 3 and 12
-- must PASS both before and after -- they are the pre-existing PR #251 tenant
-- boundary, and this change must not move them in either direction.
--
-- AFTER the migration: all 12 must PASS.
--
-- Running it before and after is the non-vacuity proof: a suite that only ever
-- runs against the fixed schema cannot show it is observing anything.
--
-- ── Running it ──────────────────────────────────────────────────────────────
--
--     SUPABASE_ACCESS_TOKEN=... node scripts/security-suite.mjs \
--       decision-review-typed-subject pdajkwtrrjcqnjsyvyqt
--
-- STAGING (pdajkwtrrjcqnjsyvyqt), not production. This suite writes fixtures
-- -- organizations, users, portfolios, ideas, decision requests, trade events
-- and reviews -- and deletes them again at the end. It is self-cleaning, but
-- it is not read-only, so it does not belong on the production project without
-- being wrapped in BEGIN ... ROLLBACK.
--
-- NOT YET EXECUTED. No database has run this. See the phase report.
--
-- Self-cleaning. 12 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid;
  v_org_b    uuid;
  v_pm_a     uuid := gen_random_uuid();   -- org A, raises and reviews
  v_pm_a2    uuid := gen_random_uuid();   -- org A colleague, reviews nothing
  v_gone_a   uuid := gen_random_uuid();   -- org A, membership later removed
  v_pm_b     uuid := gen_random_uuid();   -- org B, the outsider
  v_pf_a     uuid;
  v_pf_b     uuid;
  v_asset    uuid;
  v_idea_a   uuid;                        -- trade_queue_items, org A
  v_idea_b   uuid;                        -- trade_queue_items, org B
  v_dr_a     uuid;                        -- decision_requests, org A
  v_evt_a    uuid;                        -- portfolio_trade_events, org A
  v_idea_del uuid;                        -- an idea deleted mid-test
  v_rev_a    uuid;
  v_rev_del  uuid;
  v_count    int;
  v_text     text;
  v_uuid     uuid;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== decision_reviews typed subject (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('DRT Org A ' || v_suffix, 'drt-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('DRT Org B ' || v_suffix, 'drt-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_pm_a,   'drt_a_'    || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_pm_a2,  'drt_a2_'   || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_gone_a, 'drt_gone_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_pm_b,   'drt_b_'    || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_pm_a,   'active', false),
    (v_org_a, v_pm_a2,  'active', false),
    (v_org_a, v_gone_a, 'active', false),
    (v_org_b, v_pm_b,   'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_pm_a, v_pm_a2, v_gone_a);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_pm_b;

  INSERT INTO portfolios (name, organization_id) VALUES ('DRT Core A ' || v_suffix, v_org_a) RETURNING id INTO v_pf_a;
  INSERT INTO portfolios (name, organization_id) VALUES ('DRT Core B ' || v_suffix, v_org_b) RETURNING id INTO v_pf_b;

  -- Global reference data, shared by both firms on purpose: the tenant
  -- boundary must come from the portfolio, never from the ticker.
  INSERT INTO assets (symbol, company_name)
    VALUES ('ZD' || upper(substr(v_suffix, 1, 4)), 'Decision Review Subject Test Co ' || v_suffix)
    RETURNING id INTO v_asset;

  -- Fixtures seeded as the table owner, bypassing RLS, so nothing here depends
  -- on the policies under test.
  INSERT INTO trade_queue_items (portfolio_id, asset_id, stage, status, created_by)
    VALUES (v_pf_a, v_asset, 'deciding', 'approved', v_pm_a) RETURNING id INTO v_idea_a;
  INSERT INTO trade_queue_items (portfolio_id, asset_id, stage, status, created_by)
    VALUES (v_pf_b, v_asset, 'deciding', 'approved', v_pm_b) RETURNING id INTO v_idea_b;
  INSERT INTO trade_queue_items (portfolio_id, asset_id, stage, status, created_by)
    VALUES (v_pf_a, v_asset, 'deciding', 'approved', v_pm_a) RETURNING id INTO v_idea_del;

  INSERT INTO decision_requests (trade_queue_item_id, portfolio_id, requested_by, status)
    VALUES (v_idea_a, v_pf_a, v_pm_a, 'pending') RETURNING id INTO v_dr_a;

  INSERT INTO portfolio_trade_events (portfolio_id, asset_id)
    VALUES (v_pf_a, v_asset) RETURNING id INTO v_evt_a;

  -- ===========================================================================
  -- 1. anon reads no review. (PR #251 boundary; must not move.)
  -- ===========================================================================
  INSERT INTO decision_reviews (decision_id, decision_quality, reviewed_by, reviewed_at)
    VALUES (v_idea_a::text, 'good', v_pm_a, now()) RETURNING id INTO v_rev_a;

  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM decision_reviews WHERE id = v_rev_a;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no review row');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s review row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. Org B cannot read org A's review.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_pm_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM decision_reviews WHERE id = v_rev_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  SET LOCAL request.jwt.claims = '';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org B cannot read org A''s review');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('org B read org A''s review (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. A same-org colleague who reviewed nothing can still READ the review.
  --    The desk's learning is shared; if this fails the feature is pointless.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_pm_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM decision_reviews WHERE id = v_rev_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  SET LOCAL request.jwt.claims = '';
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'same-org colleague reads a teammate''s review');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('same-org colleague CANNOT read the review (count %s) — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 4. THE CORE CLAIM — the subject is derived, not accepted.
  --
  --    The row inserted above sent NO subject_type and NO typed id. It must
  --    come out labelled 'idea' and pointing at the trade_queue_item.
  -- ===========================================================================
  BEGIN
    SELECT subject_type, trade_queue_item_id INTO v_text, v_uuid
      FROM decision_reviews WHERE id = v_rev_a;
    IF v_text = 'idea' AND v_uuid = v_idea_a THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'subject derived server-side: idea -> trade_queue_item_id');
    ELSE
      v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL',
        format('expected (idea, %s); got (%s, %s)', v_idea_a, coalesce(v_text, 'NULL'), coalesce(v_uuid::text, 'NULL')));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('could not read the typed subject (%s) — migration not applied?', SQLSTATE));
  END;

  -- ===========================================================================
  -- 5. A LYING CLIENT IS CORRECTED, not trusted.
  --
  --    Insert a review of a decision_request while CLAIMING it is an idea and
  --    supplying a typed pointer at a DIFFERENT org's idea. The server must
  --    overwrite all of it. This is the assertion that justifies putting the
  --    derivation in the database: `useUpsertDecisionReview` sends a
  --    `subjectType` inferred in the UI from (source, category), and a review
  --    row's identity must not depend on that inference being right.
  -- ===========================================================================
  BEGIN
    INSERT INTO decision_reviews
      (decision_id, subject_type, trade_queue_item_id, decision_quality, reviewed_by, reviewed_at)
    VALUES
      (v_dr_a::text, 'idea', v_idea_b, 'mixed', v_pm_a, now());

    SELECT subject_type, decision_request_id INTO v_text, v_uuid
      FROM decision_reviews WHERE decision_id = v_dr_a::text;

    SELECT count(*) INTO v_count
      FROM decision_reviews
     WHERE decision_id = v_dr_a::text AND trade_queue_item_id IS NOT NULL;

    IF v_text = 'decision' AND v_uuid = v_dr_a AND v_count = 0 THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'a client-supplied subject_type and typed id are discarded and re-derived');
    ELSE
      v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL',
        format('client claim survived: subject_type=%s decision_request_id=%s stray trade_queue_item_id rows=%s',
               coalesce(v_text, 'NULL'), coalesce(v_uuid::text, 'NULL'), v_count));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('insert with a false subject claim errored (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 6. The third subject kind resolves too — a discretionary trade event.
  --    Pinned because `portfolio_trade_events` is the kind the Outcomes page
  --    reaches only through the `discretionary` source, so it is the one most
  --    likely to be left out of a resolver.
  -- ===========================================================================
  BEGIN
    INSERT INTO decision_reviews (decision_id, decision_quality, reviewed_by, reviewed_at)
      VALUES (v_evt_a::text, 'bad', v_pm_a, now());
    SELECT subject_type, portfolio_trade_event_id INTO v_text, v_uuid
      FROM decision_reviews WHERE decision_id = v_evt_a::text;
    IF v_text = 'trade' AND v_uuid = v_evt_a THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'trade event resolves to trade -> portfolio_trade_event_id');
    ELSE
      v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL',
        format('expected (trade, %s); got (%s, %s)', v_evt_a, coalesce(v_text, 'NULL'), coalesce(v_uuid::text, 'NULL')));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('trade-event review errored (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 7. Org B cannot create a review for org A's idea.
  --    Pre-existing (`can_review_decision`), re-asserted because the new typed
  --    columns are derived from `decision_id` and must not become a second way
  --    in.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_pm_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO decision_reviews (decision_id, decision_quality, reviewed_by, reviewed_at)
      VALUES (v_idea_del::text, 'good', v_pm_b, now());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM decision_reviews WHERE decision_id = v_idea_del::text;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'org B cannot review org A''s idea');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('org B created %s review(s) for org A''s idea', v_count)); END IF;

  -- ===========================================================================
  -- 8. A REMOVED member cannot review, and cannot read.
  --    `is_member_of_org` keys on an active membership, so a departed analyst
  --    must lose both directions at once.
  -- ===========================================================================
  UPDATE organization_memberships SET status = 'removed'
   WHERE organization_id = v_org_a AND user_id = v_gone_a;

  v_count := 0;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_gone_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM decision_reviews WHERE id = v_rev_a;
    BEGIN
      INSERT INTO decision_reviews (decision_id, decision_quality, reviewed_by, reviewed_at)
        VALUES (v_idea_del::text, 'good', v_gone_a, now());
      v_count := v_count + 100;   -- the write got through: mark it distinctly
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  DELETE FROM decision_reviews WHERE decision_id = v_idea_del::text;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'a removed member can neither read nor write a review');
  ELSIF v_count >= 100 THEN v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', 'a REMOVED member successfully wrote a review');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('a removed member read %s review row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 9. The CHECK refuses a mislabelled pair even for the table owner.
  --    Written with the trigger temporarily off, because the trigger would
  --    otherwise silently CORRECT the bad pair and the CHECK would never be
  --    reached — which would make this assertion test nothing.
  -- ===========================================================================
  BEGIN
    ALTER TABLE decision_reviews DISABLE TRIGGER decision_reviews_subject;
    BEGIN
      INSERT INTO decision_reviews
        (decision_id, subject_type, decision_request_id, decision_quality, reviewed_by, reviewed_at)
      VALUES
        (v_idea_del::text, 'idea', v_dr_a, 'good', v_pm_a, now());
      v_count := 1;    -- it got in: the CHECK is not holding
    EXCEPTION WHEN check_violation THEN v_count := 0;
              WHEN OTHERS THEN v_count := -1;
    END;
    ALTER TABLE decision_reviews ENABLE TRIGGER decision_reviews_subject;
    DELETE FROM decision_reviews WHERE decision_id = v_idea_del::text;

    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'CHECK refuses subject_type=idea carrying a decision_request_id');
    ELSIF v_count = 1 THEN v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'a mislabelled subject pair was accepted');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'mislabelled pair rejected, but not by the CHECK');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN ALTER TABLE decision_reviews ENABLE TRIGGER decision_reviews_subject; EXCEPTION WHEN OTHERS THEN NULL; END;
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', format('could not exercise the CHECK (%s) — migration not applied?', SQLSTATE));
  END;

  -- ===========================================================================
  -- 10. DELETING THE SUBJECT MUST NOT DELETE THE LEARNING.
  --
  --     The assertion that would get this migration reverted. ON DELETE
  --     CASCADE here would destroy the review -- the only record of what the
  --     desk concluded -- and ON DELETE RESTRICT would make a reviewed idea
  --     permanently undeletable, which is the PR #285 defect class.
  --
  --     Correct behaviour: the idea deletes, the review survives, its typed
  --     pointer goes NULL, and `subject_type` + `decision_id` still say what
  --     it was about.
  -- ===========================================================================
  INSERT INTO decision_reviews (decision_id, decision_quality, process_note, reviewed_by, reviewed_at)
    VALUES (v_idea_del::text, 'mixed', 'the learning that must survive', v_pm_a, now())
    RETURNING id INTO v_rev_del;

  BEGIN
    DELETE FROM decision_requests WHERE trade_queue_item_id = v_idea_del;
    DELETE FROM trade_queue_items WHERE id = v_idea_del;

    SELECT count(*) INTO v_count
      FROM decision_reviews
     WHERE id = v_rev_del
       AND process_note = 'the learning that must survive'
       AND trade_queue_item_id IS NULL
       AND subject_type = 'idea'
       AND decision_id = v_idea_del::text;

    IF v_count = 1 THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'subject deleted; review survives with a NULL typed id and its subject_type intact');
    ELSE
      SELECT count(*) INTO v_count FROM decision_reviews WHERE id = v_rev_del;
      IF v_count = 0 THEN
        v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', 'deleting the idea DESTROYED the review — decision history was rewritten');
      ELSE
        v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', 'review survived but its subject_type/decision_id no longer describe it');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('deleting a reviewed idea was REFUSED (%s) — the FK is blocking deletes', SQLSTATE));
  END;

  -- ===========================================================================
  -- 11. The resolver helper is not callable over the wire.
  --     Every new public function in this project is born anon-executable, so
  --     this is asserted rather than assumed.
  -- ===========================================================================
  BEGIN
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('decision_review_subject_type', 'decision_reviews_set_subject')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'neither new helper is executable by anon or authenticated');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('%s new helper grant(s) reachable by anon/authenticated', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('could not check helper grants (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 12. The upsert conflict key still exists.
  --     `useUpsertDecisionReview` upserts with onConflict: 'decision_id',
  --     which needs a unique constraint on exactly that column. If a later
  --     edit swaps it for a composite, the only writer breaks at runtime with
  --     no typecheck or unit test catching it.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_constraint c
   WHERE c.conrelid = 'public.decision_reviews'::regclass
     AND c.contype = 'u'
     AND (SELECT array_agg(a.attname ORDER BY a.attname)
            FROM unnest(c.conkey) k JOIN pg_attribute a
              ON a.attrelid = c.conrelid AND a.attnum = k) = ARRAY['decision_id'];
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (12, 'PASS', 'UNIQUE(decision_id) intact — the client upsert key still resolves');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (12, 'FAIL', format('found %s single-column UNIQUE(decision_id); the client upsert will fail', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM decision_reviews
   WHERE decision_id IN (v_idea_a::text, v_idea_b::text, v_idea_del::text, v_dr_a::text, v_evt_a::text);
  DELETE FROM decision_requests WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM portfolio_trade_events WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM trade_queue_items WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM portfolios WHERE id IN (v_pf_a, v_pf_b);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_pm_a, v_pm_a2, v_gone_a, v_pm_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_pm_a, v_pm_a2, v_gone_a, v_pm_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 12 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
