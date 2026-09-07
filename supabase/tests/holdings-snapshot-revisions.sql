-- =============================================================================
-- Snapshot revision semantics — pre-freeze regression
--
-- 20260909100000 made snapshots restatable: a corrected file for a day already
-- loaded writes a new revision and supersedes the old one. That put a filter
-- between every historical reader and a correct answer, and this pins the
-- properties that make the filter safe to rely on rather than a thing people
-- have to remember.
--
-- Written after a real defect reached a commit. The "has the book moved since
-- the recorded snapshot" check was built from EXCEPT and UNION ALL without
-- brackets, and set operators associate left, so it read as
-- ((A EXCEPT B) UNION ALL B) EXCEPT A. That is empty whenever the working book
-- is a SUPERSET of the recorded one, so a book that had GAINED a position
-- compared as unchanged and the stale snapshot stayed current. Assertion [3]
-- is the one that would have caught it.
--
-- 8 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org      uuid;
  v_user     uuid;
  v_book     uuid;
  v_a        uuid;
  v_b        uuid;
  v_s1       uuid;
  v_s2       uuid;
  v_n        int;
  v_orig_org uuid;
  v_today    date := current_date;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== Snapshot revision semantics (suffix: %) ===', v_suffix;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE NOTICE 'SKIP: no auth users'; RETURN; END IF;

  INSERT INTO organizations (name, slug) VALUES ('REV Org ' || v_suffix, 'rev-' || v_suffix)
    RETURNING id INTO v_org;
  INSERT INTO portfolios (name, organization_id) VALUES ('REV Book ' || v_suffix, v_org)
    RETURNING id INTO v_book;

  SELECT id INTO v_a FROM assets ORDER BY symbol LIMIT 1;
  SELECT id INTO v_b FROM assets WHERE id <> v_a ORDER BY symbol LIMIT 1;
  IF v_b IS NULL THEN
    RAISE NOTICE 'SKIP: fewer than two assets';
    DELETE FROM portfolios WHERE id = v_book;
    DELETE FROM organizations WHERE id = v_org;
    RETURN;
  END IF;

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org, v_user, 'active', false) ON CONFLICT DO NOTHING;
  INSERT INTO portfolio_memberships (portfolio_id, user_id)
    VALUES (v_book, v_user) ON CONFLICT DO NOTHING;

  SELECT current_organization_id INTO v_orig_org FROM users WHERE id = v_user;
  UPDATE users SET current_organization_id = v_org WHERE id = v_user;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- ===========================================================================
  -- 1-2. The database guarantees ONE current revision per portfolio/date
  -- ===========================================================================
  v_s1 := (reconcile_portfolio_book(v_book,
    jsonb_build_array(jsonb_build_object('asset_id', v_a, 'shares', 100, 'price', 10, 'cost', 9)),
    v_today, 'upload')->>'snapshot_id')::uuid;

  BEGIN
    INSERT INTO portfolio_holdings_snapshots (portfolio_id, organization_id, snapshot_date, source, revision)
    VALUES (v_book, v_org, v_today, 'upload', 99);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] a second current revision was accepted';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] one current revision per portfolio/date, enforced';
  END;

  -- The guarantee must also survive an attempt to revive a retired revision.
  v_s2 := (reconcile_portfolio_book(v_book,
    jsonb_build_array(jsonb_build_object('asset_id', v_a, 'shares', 555, 'price', 10, 'cost', 9)),
    v_today, 'upload')->>'snapshot_id')::uuid;

  BEGIN
    UPDATE portfolio_holdings_snapshots SET superseded_at = NULL WHERE id = v_s1;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- refused outright is an equally good answer
  END;
  SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_book AND snapshot_date = v_today AND superseded_at IS NULL;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [2] a retired revision cannot be revived into a second current';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] % current revision(s)', v_n;
  END IF;

  -- ===========================================================================
  -- 3. THE DEFECT THIS FILE EXISTS FOR
  --
  -- A book that GAINED a position must restate the day. The unbracketed
  -- symmetric difference reported "unchanged" here, so the recorded snapshot
  -- kept describing a book that no longer existed.
  -- ===========================================================================
  PERFORM reconcile_portfolio_book(v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_a, 'shares', 555, 'price', 10, 'cost', 9),
      jsonb_build_object('asset_id', v_b, 'shares', 50, 'price', 20, 'cost', 20)),
    v_today, 'upload');

  SELECT total_positions INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_book AND snapshot_date = v_today AND superseded_at IS NULL;
  IF v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] a book that gained a position restates the day';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3] the current snapshot claims % position(s); the book holds 2', v_n;
  END IF;

  -- ===========================================================================
  -- 4-5. Ordinary readers cannot mix revisions; auditors see all of them
  -- ===========================================================================
  SELECT count(DISTINCT id) INTO v_n FROM portfolio_book_snapshots_current
   WHERE portfolio_id = v_book AND snapshot_date = v_today;
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] the canonical current view returns one book per date';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] % row(s) from the current view', v_n; END IF;

  SELECT count(*) INTO v_n FROM portfolio_book_revisions
   WHERE portfolio_id = v_book AND snapshot_date = v_today;
  IF v_n >= 3 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5] the audit view keeps every revision (% found)', v_n;
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] only % revision(s) survive', v_n; END IF;

  -- ===========================================================================
  -- 6. portfolio_book_history is position-level AND current-only
  -- ===========================================================================
  SELECT count(*) INTO v_n FROM portfolio_book_history
   WHERE portfolio_id = v_book AND snapshot_date = v_today;
  IF v_n = 2 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6] portfolio_book_history returns the current book, not every revision';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [6] % position row(s) — superseded revisions are leaking in', v_n;
  END IF;

  -- ===========================================================================
  -- 7-8. The append-only trigger: refuses edits, permits the purge cascade
  -- ===========================================================================
  BEGIN
    DELETE FROM portfolio_holdings_snapshots WHERE id = v_s2;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7] a snapshot was deleted while its portfolio lives';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] a snapshot cannot be deleted while its portfolio lives';
  END;

  -- The one permitted deletion: the portfolio itself going away. Everything
  -- below it cascades, and the triggers have to let that through or a book can
  -- never be offboarded.
  DELETE FROM portfolio_holdings WHERE portfolio_id = v_book;
  DELETE FROM portfolio_memberships WHERE portfolio_id = v_book;
  BEGIN
    DELETE FROM portfolios WHERE id = v_book;
    SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots WHERE portfolio_id = v_book;
    IF v_n = 0 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] purging a portfolio takes its history with it';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8] % snapshot(s) orphaned', v_n;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] the purge cascade was blocked: %', SQLERRM;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  UPDATE users SET current_organization_id = v_orig_org WHERE id = v_user;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 8 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'REVISION SEMANTICS TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
