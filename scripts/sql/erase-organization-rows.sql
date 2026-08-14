-- ===========================================================================
-- Delete every row belonging to one organization.
--
-- The row half of organization erasure; scripts/erase-organization.mjs does
-- the storage half. Run this first, then the script.
--
-- IRREVERSIBLE. Take a database backup before running it. Set the uuid below
-- and read the report the dry run prints before switching v_apply to true.
-- ===========================================================================

DO $$
DECLARE
  -- ── set these two ────────────────────────────────────────────────────────
  v_org    UUID    := '00000000-0000-0000-0000-000000000000';
  v_apply  BOOLEAN := FALSE;
  -- ─────────────────────────────────────────────────────────────────────────

  v_name       TEXT;
  v_tbl        TEXT;
  v_remaining  TEXT[];
  v_next       TEXT[];
  v_count      BIGINT;
  v_total      BIGINT := 0;
  v_pass       INT := 0;
  v_progress   BOOLEAN;
BEGIN
  SELECT name INTO v_name FROM organizations WHERE id = v_org;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'No organization %', v_org;
  END IF;
  RAISE NOTICE '% — organization "%" (%)',
    CASE WHEN v_apply THEN 'ERASING' ELSE 'DRY RUN' END, v_name, v_org;

  -- Every table carrying organization_id, discovered rather than hardcoded: a
  -- fixed list silently rots as tables are added, and a missed table means
  -- leaving customer data behind after telling them it was deleted.
  SELECT array_agg(table_name ORDER BY table_name) INTO v_remaining
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name = 'organization_id'
    AND table_name <> 'organizations'
    AND table_name IN (
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    );

  RAISE NOTICE '% org-scoped tables to consider', coalesce(array_length(v_remaining, 1), 0);

  IF NOT v_apply THEN
    FOREACH v_tbl IN ARRAY v_remaining LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', v_tbl)
        INTO v_count USING v_org;
      IF v_count > 0 THEN
        RAISE NOTICE '  % rows  %', lpad(v_count::text, 8), v_tbl;
        v_total := v_total + v_count;
      END IF;
    END LOOP;
    RAISE NOTICE 'TOTAL % rows. Nothing deleted — set v_apply := TRUE to proceed.', v_total;
    RETURN;
  END IF;

  -- Delete what each pass can, keep the failures, repeat. Foreign keys make
  -- each pass unblock the next. Stops when a pass frees nothing, rather than
  -- looping forever on a cycle.
  LOOP
    v_pass := v_pass + 1;
    v_progress := FALSE;
    v_next := ARRAY[]::TEXT[];

    FOREACH v_tbl IN ARRAY v_remaining LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1', v_tbl) USING v_org;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_total := v_total + v_count;
        v_progress := TRUE;
        IF v_count > 0 THEN
          RAISE NOTICE '  pass % — deleted % from %', v_pass, v_count, v_tbl;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Still referenced by a table not yet cleared. Try again next pass.
        v_next := v_next || v_tbl;
      END;
    END LOOP;

    v_remaining := v_next;
    EXIT WHEN coalesce(array_length(v_remaining, 1), 0) = 0;
    EXIT WHEN NOT v_progress;
  END LOOP;

  IF coalesce(array_length(v_remaining, 1), 0) > 0 THEN
    -- Reported, not forced. A cycle or an unexpected constraint is something
    -- to look at; bulldozing it is how you corrupt another org's data.
    RAISE EXCEPTION
      'Stopped with % table(s) undeleted: %. Nothing has been committed — '
      'investigate the constraint before retrying.',
      array_length(v_remaining, 1), array_to_string(v_remaining, ', ');
  END IF;

  DELETE FROM organizations WHERE id = v_org;
  RAISE NOTICE 'Deleted % rows across % passes, and the organization row.', v_total, v_pass;
END $$;

-- ---------------------------------------------------------------------------
-- Verification — both should return zero.
-- ---------------------------------------------------------------------------
--
--   SELECT count(*) FROM organizations WHERE id = '<uuid>';
--
--   -- rows left anywhere:
--   SELECT string_agg(t, ', ') FROM (
--     SELECT table_name AS t FROM information_schema.columns
--     WHERE table_schema='public' AND column_name='organization_id'
--   ) s;   -- then spot-check the tables you care about
--
-- Then run scripts/erase-organization.mjs --org=<uuid> --confirm="<name>" --apply
-- to remove the files.
