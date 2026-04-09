-- ============================================================
-- User Sessions — Login & Usage Tracking
-- ============================================================
--
-- Tracks user sessions with heartbeat-based duration measurement.
-- Client sends a heartbeat every 2 minutes while tab is active.
-- Session ends when heartbeats stop (inferred from last_heartbeat_at).
--
-- Also logs discrete login events for historical reporting.
-- ============================================================

-- ============================================================
-- 1. User sessions (active + historical)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT,  -- Computed on end or inferred from heartbeats
  user_agent TEXT,
  ip_address INET,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Users can insert/update their own sessions
CREATE POLICY "Sessions: users can insert own"
  ON user_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Sessions: users can update own"
  ON user_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Platform admins can read all
CREATE POLICY "Sessions: platform admins can read all"
  ON user_sessions FOR SELECT TO authenticated
  USING (is_platform_admin());

-- Users can read their own
CREATE POLICY "Sessions: users can read own"
  ON user_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_org ON user_sessions(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true;

-- ============================================================
-- 2. Heartbeat RPC — lightweight upsert
-- ============================================================

CREATE OR REPLACE FUNCTION session_heartbeat(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_sessions
  SET last_heartbeat_at = now()
  WHERE id = p_session_id
    AND user_id = auth.uid()
    AND is_active = true;
END;
$$;

-- ============================================================
-- 3. End session RPC
-- ============================================================

CREATE OR REPLACE FUNCTION end_session(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_sessions
  SET is_active = false,
      ended_at = now(),
      duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
  WHERE id = p_session_id
    AND user_id = auth.uid();
END;
$$;

-- ============================================================
-- 4. Cleanup stale sessions (heartbeat > 5 min ago)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_sessions
  SET is_active = false,
      ended_at = last_heartbeat_at,
      duration_seconds = EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))::int
  WHERE is_active = true
    AND last_heartbeat_at < now() - INTERVAL '5 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Schedule stale session cleanup every 10 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup-stale-sessions');
    PERFORM cron.schedule(
      'cleanup-stale-sessions',
      '*/10 * * * *',
      $cron$SELECT cleanup_stale_sessions();$cron$
    );
  END IF;
END;
$$;
