-- ============================================================
-- Fix morph session audit_events inserts
-- ============================================================
-- start_morph_session / end_morph_session failed with
-- "null value in column checksum of relation audit_events"
-- because they omitted org_id + checksum, and used an
-- entity_type / action_category not present in the CHECK
-- constraints on audit_events.
-- ============================================================

-- 1. Extend entity_type constraint to include 'morph_session'
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS valid_entity_type;
ALTER TABLE audit_events ADD CONSTRAINT valid_entity_type CHECK (
  entity_type = ANY (ARRAY[
    'trade_idea', 'pair_trade', 'order', 'execution', 'asset', 'coverage',
    'portfolio', 'simulation', 'user', 'team', 'comment', 'attachment',
    'audit_explorer', 'lab_variant', 'trade_lab_view', 'layout_template',
    'organization', 'morph_session'
  ])
);

-- 2. Replace start_morph_session to populate org_id + checksum,
--    and use an action_category already in the CHECK ('access').
CREATE OR REPLACE FUNCTION start_morph_session(
  p_target_user_id UUID,
  p_reason TEXT,
  p_duration_minutes INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_target_org_id UUID;
  v_target_user RECORD;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can morph';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot morph into yourself';
  END IF;

  SELECT id, email, current_organization_id, first_name, last_name
  INTO v_target_user
  FROM users WHERE id = p_target_user_id;

  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  v_target_org_id := v_target_user.current_organization_id;
  IF v_target_org_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no active organization';
  END IF;

  UPDATE morph_sessions
  SET is_active = false, ended_at = now()
  WHERE admin_user_id = auth.uid() AND is_active = true;

  v_expires_at := now() + (p_duration_minutes * INTERVAL '1 minute');

  INSERT INTO morph_sessions (admin_user_id, target_user_id, target_org_id, reason, expires_at)
  VALUES (auth.uid(), p_target_user_id, v_target_org_id, p_reason, v_expires_at)
  RETURNING id INTO v_session_id;

  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, metadata,
    org_id, checksum
  ) VALUES (
    auth.uid(), 'user', 'morph_session', v_session_id,
    'start_morph', 'access',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'target_email', v_target_user.email,
      'target_org_id', v_target_org_id,
      'reason', p_reason,
      'duration_minutes', p_duration_minutes,
      'expires_at', v_expires_at
    ),
    v_target_org_id,
    encode(sha256(convert_to(v_session_id::text || '-start_morph-' || now()::text, 'UTF8')), 'hex')
  );

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'target_user_id', p_target_user_id,
    'target_email', v_target_user.email,
    'target_name', COALESCE(v_target_user.first_name || ' ' || v_target_user.last_name, v_target_user.email),
    'target_org_id', v_target_org_id,
    'expires_at', v_expires_at
  );
END;
$$;

-- 3. Replace end_morph_session with same fixes
CREATE OR REPLACE FUNCTION end_morph_session(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_org_id UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT target_org_id INTO v_target_org_id
  FROM morph_sessions
  WHERE id = p_session_id AND admin_user_id = auth.uid();

  UPDATE morph_sessions
  SET is_active = false, ended_at = now()
  WHERE id = p_session_id AND admin_user_id = auth.uid();

  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category,
    org_id, checksum
  ) VALUES (
    auth.uid(), 'user', 'morph_session', p_session_id,
    'end_morph', 'access',
    COALESCE(v_target_org_id, (SELECT current_organization_id FROM users WHERE id = auth.uid())),
    encode(sha256(convert_to(p_session_id::text || '-end_morph-' || now()::text, 'UTF8')), 'hex')
  );
END;
$$;
