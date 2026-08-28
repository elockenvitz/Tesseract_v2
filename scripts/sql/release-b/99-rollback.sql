-- =============================================================================
-- Security Release B — ROLLBACK
--
-- Restores the EXACT pre-release state, predicate for predicate, as captured in
-- prod-pre-deploy-20260826-234204.json on 2026-08-27.
--
-- Read this first: rolling back re-opens the findings. §1 restores a policy that
-- lets an unauthenticated caller rewrite any message; §2 restores a policy that
-- lets any authenticated user read and forge audit events. Roll back because
-- something broke, then fix forward — do not leave a rollback in place.
--
-- Each section is independent. Run only the ones you need, in any order.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1 — messages (undoes 01-messages-containment.sql AND 02-messages-permanent.sql)
-- -----------------------------------------------------------------------------
BEGIN;

-- Undo step 2 first, if it ran.
DROP TRIGGER  IF EXISTS trg_messages_set_organization_id ON public.messages;
DROP FUNCTION IF EXISTS public.messages_set_organization_id();
DROP FUNCTION IF EXISTS public.mark_messages_read(uuid[]);
DROP FUNCTION IF EXISTS public.set_message_pinned(uuid, boolean);
DROP POLICY   IF EXISTS messages_select ON public.messages;
DROP POLICY   IF EXISTS messages_insert ON public.messages;
DROP POLICY   IF EXISTS messages_delete ON public.messages;
DROP INDEX    IF EXISTS public.idx_messages_org_context;

-- The column is deliberately LEFT IN PLACE. Dropping it discards the backfill,
-- and it is inert once no policy reads it. Drop it manually only if you are sure
-- you will not retry:
--   ALTER TABLE public.messages DROP COLUMN organization_id;

-- Restore the four original policies exactly as production held them.
-- NOTE: "Users can mark messages as read" specified no role, so it defaulted to
-- PUBLIC. That is reproduced faithfully here, because a rollback that quietly
-- improves the thing it restores is not a rollback — and this one is the reason
-- anon could rewrite messages.
CREATE POLICY "Users can read messages in contexts they have access to"
  ON public.messages FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can mark messages as read"
  ON public.messages FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can create messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages TO anon, authenticated;

COMMIT;

-- -----------------------------------------------------------------------------
-- §2 — audit_events (undoes 03-audit-events.sql)
-- -----------------------------------------------------------------------------
BEGIN;

DROP POLICY IF EXISTS audit_events_select ON public.audit_events;
DROP FUNCTION IF EXISTS public.record_audit_event(text, uuid, text, text, text, text, uuid, jsonb, jsonb, text[], jsonb, text, uuid);

CREATE POLICY "Users can read audit events"
  ON public.audit_events FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can insert audit events"
  ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.audit_events TO anon, authenticated;

COMMENT ON COLUMN public.audit_events.checksum IS NULL;

COMMIT;

-- -----------------------------------------------------------------------------
-- §3 — notifications (undoes 04-notifications.sql)
-- -----------------------------------------------------------------------------
BEGIN;

DROP TRIGGER  IF EXISTS trg_notifications_guard_update ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_guard_update();
DROP POLICY   IF EXISTS notifications_insert ON public.notifications;
DROP INDEX    IF EXISTS public.idx_notifications_created_by;

-- As above: the column is left in place. It is inert without the policy.
--   ALTER TABLE public.notifications DROP COLUMN created_by;

CREATE POLICY "System can create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.notifications TO anon, authenticated;

COMMIT;

-- -----------------------------------------------------------------------------
-- §4 — verify the rollback landed
-- -----------------------------------------------------------------------------
SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles,
       qual IS NOT DISTINCT FROM 'true' AS qual_is_true,
       with_check IS NOT DISTINCT FROM 'true' AS check_is_true
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('messages', 'audit_events', 'notifications')
 ORDER BY tablename, cmd, policyname;
