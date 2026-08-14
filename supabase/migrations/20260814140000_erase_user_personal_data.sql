/**
 * erase_user_personal_data(uuid) — a real deletion path for a person.
 *
 * Until now the only thing the product could do with a departing user was
 * deactivate them. That is a defensible position for a B2B recordkeeping
 * system, but it is not deletion, and a privacy policy that promises deletion
 * while the software only suspends is a misrepresentation. This closes that
 * gap for the part that can honestly be closed.
 *
 * ── What it erases ────────────────────────────────────────────────────────
 *
 * The person: their name and email on the `users` row, and the rows that exist
 * only to serve them — preferences, saved views, layouts, bookmarks,
 * notifications, AI prompt history, calendar connections.
 *
 * ── What it deliberately keeps ────────────────────────────────────────────
 *
 * Everything they authored: notes, theses, ratings, trade ideas, decisions,
 * committed trades, audit entries. Those are the customer firm's business
 * records, and for an SEC-registered adviser they are records it is required
 * to retain (Advisers Act Rule 204-2). Deleting them on an individual's
 * request would destroy the firm's compliance record, and the firm — not
 * Tesseract, and not the individual — is the controller of that data.
 *
 * The `users` row itself is kept and anonymised rather than deleted, because
 * ~92 tables carry a user_id and most are authorship. Dropping the row would
 * either cascade through the firm's records or leave dangling references that
 * render as a crash. An anonymised row makes authored work show as a
 * tombstone: present, attributable to "a former user", not to a named person.
 *
 * This split is what docs/legal/PRIVACY-POLICY.draft.md describes. If the two
 * ever diverge, the policy is the thing that becomes false.
 *
 * ── Authorisation ─────────────────────────────────────────────────────────
 *
 * Org admins of an org the subject belongs to, or service_role. Deliberately
 * not the subject themselves: erasure of a firm employee is the firm's call,
 * and a self-service button here would let someone unilaterally anonymise
 * their own authorship of a trade decision.
 *
 * Does NOT touch auth.users — that needs the admin API. scripts/erase-user.mjs
 * calls this and then deletes the auth identity, in that order.
 */

CREATE OR REPLACE FUNCTION public.erase_user_personal_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_is_service   BOOLEAN := current_setting('request.jwt.claim.role', true) = 'service_role';
  v_authorised   BOOLEAN := FALSE;
  v_tbl          TEXT;
  v_deleted      JSONB := '{}'::jsonb;
  v_count        BIGINT;
  v_email_before  TEXT;

  -- Tables that exist solely to serve one person. Each is deleted outright.
  -- Anything not on this list is treated as a business record and kept.
  v_personal_tables TEXT[] := ARRAY[
    'user_preferences', 'user_profile_extended', 'user_onboarding_status',
    'user_ai_config', 'user_ai_column_selections', 'user_quick_prompt_history',
    'user_saved_views', 'user_actions', 'user_asset_flags',
    'user_asset_layout_selections', 'user_asset_page_layouts',
    'user_asset_page_preferences', 'user_asset_priorities',
    'user_asset_references', 'user_asset_widget_values', 'user_asset_widgets',
    'personal_tasks', 'attention_user_state', 'author_follows',
    'idea_bookmarks', 'outcome_preferences', 'rating_ev_suppressions',
    'asset_followup_suppressions', 'individual_allocation_views',
    'calendar_connections', 'connected_calendars', 'external_calendar_events',
    'calendar_sync_logs', 'calendar_event_reminders', 'chart_annotations',
    'notifications'
  ];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_is_service THEN
    v_authorised := TRUE;
  ELSIF v_caller IS NOT NULL THEN
    -- Caller must be an active admin of an org the subject is a member of.
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

  SELECT email INTO v_email_before FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such user %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 1. Drop the per-person rows. to_regclass guards each name so a table that
  --    does not exist in this environment is skipped rather than aborting the
  --    erasure half-done.
  FOREACH v_tbl IN ARRAY v_personal_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_tbl) USING p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        v_deleted := v_deleted || jsonb_build_object(v_tbl, v_count);
      END IF;
    END IF;
  END LOOP;

  -- 2. Revoke access everywhere.
  UPDATE organization_memberships
  SET status = 'revoked'
  WHERE user_id = p_user_id AND status <> 'revoked';

  -- 3. Anonymise the identity. The email keeps the id so it stays unique
  --    without carrying anything about the person; .invalid is reserved by
  --    RFC 2606 and can never be routed.
  UPDATE users
  SET email                   = 'erased-' || p_user_id::text || '@deleted.invalid',
      first_name              = NULL,
      last_name               = NULL,
      full_name               = 'Former user',
      timezone                = NULL,
      is_active               = FALSE,
      current_organization_id = NULL,
      pilot_progress          = '{}'::jsonb,
      is_pilot_user           = FALSE,
      updated_at              = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',        p_user_id,
    'erased_at',      now(),
    'rows_deleted',   v_deleted,
    'authored_content_retained', TRUE,
    'note', 'Authored records are retained as the customer organization''s '
            'business records and are now attributed to "Former user". '
            'auth.users is NOT touched — delete the auth identity separately.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.erase_user_personal_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_user_personal_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.erase_user_personal_data(UUID) IS
  'Erases a user''s personal data and preferences, anonymises their identity, '
  'and revokes all org access. Authored business records are retained as the '
  'customer organization''s records. Org admins or service_role only. Does not '
  'touch auth.users.';
