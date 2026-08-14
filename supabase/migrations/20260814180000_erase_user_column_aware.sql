/**
 * Fix: erase_user_personal_data assumed every personal table has `user_id`.
 *
 * Five of them do not, and the first one reached aborted the whole function
 * with `column "user_id" does not exist` — after the earlier tables had
 * already been deleted. Half-erased, and reported as a failure rather than a
 * partial, which is the worst shape this could fail in.
 *
 *   author_follows            keys on follower_id
 *   connected_calendars       chains via connection_id
 *   calendar_sync_logs        chains via connection_id
 *   external_calendar_events  chains via connected_calendar_id
 *
 * This is the third defect found by actually running the erasure against
 * disposable fixtures, after the service-role check (20260814160000) and the
 * generated column (20260814170000). None was visible by reading the SQL.
 *
 * Two changes beyond the column names:
 *
 *   - Tables are now (table, column) pairs, and a table whose column is
 *     missing is *reported in the return value* rather than skipped silently.
 *     A silent skip is how personal data survives an erasure we have told a
 *     customer succeeded.
 *
 *   - The calendar chain is deleted deepest-first from calendar_connections.
 *     That table holds OAuth access_token and refresh_token — live
 *     credentials to a third-party account. They must not outlive the person.
 *
 * calendar_event_reminders is deliberately NOT erased: it hangs off
 * calendar_events, which belongs to the organization rather than the user.
 */

CREATE OR REPLACE FUNCTION public.erase_user_personal_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_is_service   BOOLEAN := COALESCE(
                     (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
                     current_setting('request.jwt.claim.role', true) = 'service_role',
                     FALSE
                   );
  v_authorised   BOOLEAN := FALSE;
  v_pair         TEXT;
  v_tbl          TEXT;
  v_col          TEXT;
  v_deleted      JSONB := '{}'::jsonb;
  v_skipped      JSONB := '[]'::jsonb;
  v_count        BIGINT;

  -- 'table:column'. The column is named per table because several of these
  -- do not use user_id, and assuming they did is what broke this before.
  v_personal TEXT[] := ARRAY[
    'user_preferences:user_id',
    'user_profile_extended:user_id',
    'user_onboarding_status:user_id',
    'user_ai_config:user_id',
    'user_ai_column_selections:user_id',
    'user_quick_prompt_history:user_id',
    'user_saved_views:user_id',
    'user_actions:user_id',
    'user_asset_flags:user_id',
    'user_asset_layout_selections:user_id',
    'user_asset_page_layouts:user_id',
    'user_asset_page_preferences:user_id',
    'user_asset_priorities:user_id',
    'user_asset_references:user_id',
    'user_asset_widget_values:user_id',
    'user_asset_widgets:user_id',
    'personal_tasks:user_id',
    'attention_user_state:user_id',
    'author_follows:follower_id',
    'idea_bookmarks:user_id',
    'outcome_preferences:user_id',
    'rating_ev_suppressions:user_id',
    'asset_followup_suppressions:user_id',
    'individual_allocation_views:user_id',
    'chart_annotations:user_id',
    'notifications:user_id'
  ];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_is_service THEN
    v_authorised := TRUE;
  ELSIF v_caller IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM organization_memberships subject
      JOIN organization_memberships admin
        ON admin.organization_id = subject.organization_id
      WHERE subject.user_id = p_user_id
        AND admin.user_id = v_caller
        AND admin.status = 'active'
        AND admin.is_org_admin = TRUE
    ) INTO v_authorised;
  END IF;

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'Not authorised to erase this user' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'No such user %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 1. Per-person rows.
  FOREACH v_pair IN ARRAY v_personal LOOP
    v_tbl := split_part(v_pair, ':', 1);
    v_col := split_part(v_pair, ':', 2);

    IF to_regclass('public.' || v_tbl) IS NULL THEN
      v_skipped := v_skipped || to_jsonb(v_tbl || ' (no such table)');
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = v_col
    ) THEN
      -- Reported, never silent: a column rename here would otherwise leave
      -- personal data behind in an erasure we reported as complete.
      v_skipped := v_skipped || to_jsonb(v_tbl || '.' || v_col || ' (no such column)');
      CONTINUE;
    END IF;

    EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_tbl, v_col) USING p_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      v_deleted := v_deleted || jsonb_build_object(v_tbl, v_count);
    END IF;
  END LOOP;

  -- 2. Calendar chain, deepest first. calendar_connections holds live OAuth
  --    access and refresh tokens for a third-party account; those must not
  --    survive the person they belong to.
  IF to_regclass('public.calendar_connections') IS NOT NULL THEN
    IF to_regclass('public.external_calendar_events') IS NOT NULL THEN
      DELETE FROM external_calendar_events WHERE connected_calendar_id IN (
        SELECT cc.id FROM connected_calendars cc
        JOIN calendar_connections c ON c.id = cc.connection_id
        WHERE c.user_id = p_user_id);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN v_deleted := v_deleted || jsonb_build_object('external_calendar_events', v_count); END IF;
    END IF;

    IF to_regclass('public.calendar_sync_logs') IS NOT NULL THEN
      DELETE FROM calendar_sync_logs WHERE connection_id IN (
        SELECT id FROM calendar_connections WHERE user_id = p_user_id);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN v_deleted := v_deleted || jsonb_build_object('calendar_sync_logs', v_count); END IF;
    END IF;

    IF to_regclass('public.connected_calendars') IS NOT NULL THEN
      DELETE FROM connected_calendars WHERE connection_id IN (
        SELECT id FROM calendar_connections WHERE user_id = p_user_id);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN v_deleted := v_deleted || jsonb_build_object('connected_calendars', v_count); END IF;
    END IF;

    DELETE FROM calendar_connections WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN v_deleted := v_deleted || jsonb_build_object('calendar_connections', v_count); END IF;
  END IF;

  -- 3. Revoke access.
  UPDATE organization_memberships
  SET status = 'revoked'
  WHERE user_id = p_user_id AND status <> 'revoked';

  -- 4. Anonymise. full_name is GENERATED from first/last, so it is produced
  --    rather than assigned.
  UPDATE users
  SET email                   = 'erased-' || p_user_id::text || '@deleted.invalid',
      first_name              = 'Former',
      last_name               = 'user',
      timezone                = NULL,
      is_active               = FALSE,
      current_organization_id = NULL,
      pilot_progress          = '{}'::jsonb,
      is_pilot_user           = FALSE,
      updated_at              = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',      p_user_id,
    'erased_at',    now(),
    'rows_deleted', v_deleted,
    'skipped',      v_skipped,
    'authored_content_retained', TRUE,
    'note', 'Authored records are retained as the customer organization''s '
            'business records and are now attributed to "Former user". '
            'auth.users is NOT touched — delete the auth identity separately. '
            'Any entry in "skipped" means personal data was NOT erased there.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.erase_user_personal_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_user_personal_data(UUID) TO authenticated;
