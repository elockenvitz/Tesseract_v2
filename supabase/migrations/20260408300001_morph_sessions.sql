-- ============================================================
-- Morph Sessions — User Impersonation for Platform Support
-- ============================================================
--
-- Allows platform admins to view the platform as a specific user
-- for debugging. Sessions are time-limited, read-only (enforced
-- client-side), and fully audited.
-- ============================================================

CREATE TABLE IF NOT EXISTS morph_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  target_user_id UUID NOT NULL REFERENCES users(id),
  target_org_id UUID NOT NULL REFERENCES organizations(id),
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE morph_sessions ENABLE ROW LEVEL SECURITY;

-- Only platform admins can create morph sessions
CREATE POLICY "Morph sessions: platform admins can insert"
  ON morph_sessions FOR INSERT TO authenticated
  WITH CHECK (
    admin_user_id = auth.uid()
    AND is_platform_admin()
  );

-- Platform admins can read their own sessions
CREATE POLICY "Morph sessions: admins can read own sessions"
  ON morph_sessions FOR SELECT TO authenticated
  USING (
    admin_user_id = auth.uid()
    AND is_platform_admin()
  );

-- Platform admins can end their own sessions
CREATE POLICY "Morph sessions: admins can update own sessions"
  ON morph_sessions FOR UPDATE TO authenticated
  USING (
    admin_user_id = auth.uid()
    AND is_platform_admin()
  );

CREATE INDEX IF NOT EXISTS idx_morph_sessions_admin ON morph_sessions(admin_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_morph_sessions_target ON morph_sessions(target_user_id);

-- ============================================================
-- Start morph session RPC
-- ============================================================

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
  -- Gate: only platform admins
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can morph';
  END IF;

  -- Cannot morph into yourself
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot morph into yourself';
  END IF;

  -- Get target user info
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

  -- End any existing active sessions for this admin
  UPDATE morph_sessions
  SET is_active = false, ended_at = now()
  WHERE admin_user_id = auth.uid() AND is_active = true;

  -- Create new session
  v_expires_at := now() + (p_duration_minutes * INTERVAL '1 minute');

  INSERT INTO morph_sessions (admin_user_id, target_user_id, target_org_id, reason, expires_at)
  VALUES (auth.uid(), p_target_user_id, v_target_org_id, p_reason, v_expires_at)
  RETURNING id INTO v_session_id;

  -- Audit event
  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, metadata
  ) VALUES (
    auth.uid(), 'user', 'morph_session', v_session_id,
    'start_morph', 'security',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'target_email', v_target_user.email,
      'target_org_id', v_target_org_id,
      'reason', p_reason,
      'duration_minutes', p_duration_minutes,
      'expires_at', v_expires_at
    )
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

-- ============================================================
-- End morph session RPC
-- ============================================================

CREATE OR REPLACE FUNCTION end_morph_session(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE morph_sessions
  SET is_active = false, ended_at = now()
  WHERE id = p_session_id AND admin_user_id = auth.uid();

  -- Audit event
  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category
  ) VALUES (
    auth.uid(), 'user', 'morph_session', p_session_id,
    'end_morph', 'security'
  );
END;
$$;
