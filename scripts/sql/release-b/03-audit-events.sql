-- =============================================================================
-- Security Release B · Step 3 — audit_events
--
-- STATUS: not executed anywhere. §0 must be run and read FIRST.
--
-- ── What is live right now ───────────────────────────────────────────────────
--
--   "Users can read audit events"    SELECT TO authenticated  USING (true)
--   "Users can insert audit events"  INSERT TO authenticated  WITH CHECK (true)
--
-- Two policies, both unconditional, and nothing else. Every organization's
-- decision record — actor, entity, from_state/to_state, changed_fields — is
-- readable by any authenticated user, and any authenticated user can insert an
-- event attributing any action to any actor in any org.
--
-- Every authoritative field is supplied by the client. From
-- src/lib/audit/audit-service.ts the insert payload includes actor_id, org_id,
-- actor_email, actor_name and checksum — all chosen by the caller. There is no
-- trigger on this table and no server-side derivation of any kind.
--
-- ── The checksum decision: (B) it stops being a security claim ───────────────
--
-- The brief asked for an explicit choice. It is B, and the reasoning is short:
--
--   * `calculateChecksum` (src/lib/audit/checksum.ts) is an UNKEYED SHA-256 over
--     nine fields, computed in the browser. The recipe is in the repository. Any
--     party who can forge a row can compute the matching checksum for it, so it
--     detects nothing that an attacker would fail to do.
--   * It is not even consistently produced. src/hooks/useUserAssetPagePreferences.ts:1532
--     writes `${userId}-${entityId}-${Date.now()}` into the same NOT NULL column.
--     Whatever verification would mean, it cannot mean one thing today.
--   * `verifyChecksum` is exported and has no caller.
--
-- So the column keeps existing rows valid and is computed server-side from now
-- on, but it stops being described as tamper detection. Decorative security is
-- worse than none: it is the reason `audit_events` was nominated as the
-- tamper-evident home for relationship-edge governance.
--
-- If genuine tamper-evidence is required for the compliance story, the mechanism
-- is per-org HASH CHAINING — each row commits to its predecessor's hash, so a
-- deletion or edit breaks the chain — computed inside the function below. That
-- is a real design with real cost (ordering, contention, backfill of 2,845
-- existing rows) and it is a decision for Main Control, not a line in this file.
--
-- ── org_id NOT NULL ─────────────────────────────────────────────────────────
--
-- The brief asked to check for NULL org_id before requiring NOT NULL. The
-- creating migration (20260201100000) already declares `org_id UUID NOT NULL`,
-- so there should be none — but this repository is known to drift from
-- production, so §0 checks rather than assumes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. READ THIS OUTPUT BEFORE RUNNING ANYTHING BELOW. Read-only.
-- -----------------------------------------------------------------------------
SELECT
  count(*)                                            AS total_rows,
  count(*) FILTER (WHERE org_id IS NULL)              AS null_org_id,
  count(*) FILTER (WHERE actor_id IS NULL)            AS null_actor,
  count(*) FILTER (WHERE checksum !~ '^[0-9a-f]{64}$') AS non_sha256_checksums,
  count(DISTINCT org_id)                              AS orgs
FROM public.audit_events;

-- If null_org_id > 0, STOP: an org-scoped read policy makes those rows
-- invisible to everyone, which is a silent deletion of audit history. Decide
-- their disposition with Main Control first.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Read: org-scoped
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can read audit events" ON public.audit_events;

CREATE POLICY audit_events_select ON public.audit_events
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- 2. Write: through a trusted path only
-- -----------------------------------------------------------------------------
--
-- The caller keeps describing WHAT happened. It stops asserting WHO did it,
-- WHERE, and under what identity — those are read from auth.uid(), from the
-- caller's current org, and from `users`.

DROP POLICY IF EXISTS "Users can insert audit events" ON public.audit_events;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated;
REVOKE ALL ON public.audit_events FROM anon;

CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_entity_type          text,
  p_entity_id            uuid,
  p_action_type          text,
  p_action_category      text,
  p_entity_display_name  text    DEFAULT NULL,
  p_parent_entity_type   text    DEFAULT NULL,
  p_parent_entity_id     uuid    DEFAULT NULL,
  p_from_state           jsonb   DEFAULT NULL,
  p_to_state             jsonb   DEFAULT NULL,
  p_changed_fields       text[]  DEFAULT NULL,
  p_metadata             jsonb   DEFAULT '{}'::jsonb,
  p_asset_symbol         text    DEFAULT NULL,
  p_team_id              uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_org    uuid := public.current_org_id();
  v_email  text;
  v_name   text;
  v_now    timestamptz := now();
  v_id     uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_audit_event: no session';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'record_audit_event: caller has no current organization';
  END IF;

  -- Actor identity is read, never accepted.
  SELECT u.email,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)
    INTO v_email, v_name
    FROM public.users u WHERE u.id = v_actor;

  INSERT INTO public.audit_events (
    occurred_at, recorded_at,
    actor_id, actor_type, actor_role,
    entity_type, entity_id, entity_display_name,
    parent_entity_type, parent_entity_id,
    action_type, action_category,
    from_state, to_state, changed_fields,
    metadata, search_text,
    actor_email, actor_name, asset_symbol,
    org_id, team_id, checksum
  ) VALUES (
    v_now, v_now,
    v_actor, 'user', NULL,
    p_entity_type, p_entity_id, p_entity_display_name,
    p_parent_entity_type, p_parent_entity_id,
    p_action_type, p_action_category,
    p_from_state, p_to_state, p_changed_fields,
    COALESCE(p_metadata, '{}'::jsonb),
    NULLIF(CONCAT_WS(' ', p_entity_display_name, p_action_type,
                     p_metadata->>'reason', array_to_string(p_changed_fields, ' '),
                     p_asset_symbol, v_email), ''),
    v_email, v_name, p_asset_symbol,
    v_org, p_team_id,
    -- Computed here rather than accepted. This makes the column consistent and
    -- server-derived; it does NOT make the row tamper-evident. See the header.
    encode(sha256(convert_to(jsonb_build_object(
      'occurred_at', v_now, 'actor_id', v_actor, 'actor_type', 'user',
      'entity_type', p_entity_type, 'entity_id', p_entity_id,
      'action_type', p_action_type, 'from_state', p_from_state,
      'to_state', p_to_state, 'org_id', v_org)::text, 'UTF8')), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_audit_event(text, uuid, text, text, text, text, uuid, jsonb, jsonb, text[], jsonb, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_audit_event(text, uuid, text, text, text, text, uuid, jsonb, jsonb, text[], jsonb, text, uuid) TO authenticated;

COMMENT ON COLUMN public.audit_events.checksum IS
  'Server-computed SHA-256 of the core fields. Consistency and change detection only — NOT tamper evidence: it is unkeyed, so anyone able to write a row can compute it. Do not cite it as an integrity control.';

COMMIT;

-- =============================================================================
-- REQUIRED APPLICATION CHANGE
--
--   src/lib/audit/audit-service.ts:76    .from('audit_events').insert({...})
--   src/hooks/useUserAssetPagePreferences.ts:1521
--   supabase/functions/auto-archive/index.ts:240, :319   (service_role — unaffected)
--
-- The two client paths must call `record_audit_event` instead, dropping
-- actor_id / org_id / actor_email / actor_name / checksum from their payloads.
-- src/lib/audit/checksum.ts becomes dead and should be deleted with them.
--
-- Not made on this branch. Sequence with Main Control.
--
-- `sha256()` is built in since PG11 and needs no extension: the repository's own
-- scripts/audit/schema-baseline.mjs already runs it against production.
-- =============================================================================
