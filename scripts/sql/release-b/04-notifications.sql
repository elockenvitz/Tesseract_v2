-- =============================================================================
-- Security Release B · Step 4 — notifications (STAGE 1 ONLY)
--
-- STATUS: not executed anywhere.
--
-- ── What is live right now ───────────────────────────────────────────────────
--
--   "Users can read their own notifications"   SELECT TO authenticated  USING (auth.uid() = user_id)
--   "Users can update their own notifications" UPDATE TO authenticated  USING/CHECK (auth.uid() = user_id)
--   "System can create notifications"          INSERT TO authenticated  WITH CHECK (true)
--
-- Read and update are correct. INSERT is not: any authenticated user can create
-- a notification addressed to any user, with any title, body and context_data.
-- That is a phishing primitive inside the product — an attacker-authored message
-- rendered in the notification centre with full product chrome around it.
--
-- ── Why this step is deliberately partial, and what it does NOT fix ──────────
--
-- Tracing the producers gives the reason. There are two populations:
--
--   * ~25 SECURITY DEFINER trigger functions (`notify_*`) that already write
--     through a trusted path and are unaffected by anything here.
--   * 18 CLIENT call sites that insert directly, in AssignmentSelector,
--     ShareToUserModal, DecisionInbox, AccessRequestModal, WorkflowManager,
--     CollaborationManager, PromptModal, TradeIdeaDetailModal, MessagingSection,
--     DirectMessaging, accepted-trade-service, inbox-accept-pipeline,
--     recommendation-service and simulation-share-service.
--
-- Those 18 are legitimate: a user mentioning, assigning or sharing genuinely
-- does cause a notification for someone else. So there is NO client-side
-- predicate that separates them from an attacker — "notify another user" is
-- exactly what they all do.
--
-- Worse, the table cannot even record who is asking. `user_id` is the RECIPIENT.
-- There is no sender, actor or created_by column, so today a notification is
-- unattributable: nothing in the row says who wrote it.
--
-- Closing fabrication therefore requires moving all 18 sites behind per-workflow
-- RPCs that derive the recipient from the workflow rather than accepting it —
-- a product-code refactor across 14 files. That is Stage 2, it is not security
-- source control, and this lane does not own those files.
--
-- STAGE 1, below, makes every notification ATTRIBUTABLE without touching a
-- single client file, and removes the anonymous path. After it, a fabricated
-- notification still succeeds — but it carries the identity of whoever created
-- it, which is the precondition for both detection and Stage 2.
--
-- Do not record this table as fixed when this step lands. It is not.
-- =============================================================================

BEGIN;

-- 1. `anon` holds the full grant set here and no first-party client uses it.
REVOKE ALL ON public.notifications FROM anon;

-- 2. Attribution. DEFAULT auth.uid() means the 18 existing call sites keep
--    working unchanged — they never set this column, so the default applies and
--    the new WITH CHECK passes. Existing rows stay NULL: they predate
--    attribution and are not retro-attributed to anyone.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) DEFAULT auth.uid();

COMMENT ON COLUMN public.notifications.created_by IS
  'Who caused this notification. Defaults to auth.uid() and cannot be set to anyone else (see notifications_insert). NULL on rows predating 2026-08-28. Trigger-written rows are service_role and may be NULL.';

CREATE INDEX IF NOT EXISTS idx_notifications_created_by
  ON public.notifications(created_by) WHERE created_by IS NOT NULL;

-- 3. A caller may still notify anyone — but only as themselves.
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- 4. `created_by` must not be rewritable by the recipient. The existing UPDATE
--    policy is `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`,
--    which lets a recipient edit every other column of their own notification —
--    including, once it exists, the attribution. Narrow it to the read-state
--    columns via a trigger, since RLS cannot express column-level rules.
CREATE OR REPLACE FUNCTION public.notifications_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A recipient may acknowledge. Nothing else about the row may move.
  IF (NEW.user_id, NEW.type, NEW.title, NEW.message, NEW.context_type,
      NEW.context_id, NEW.context_data, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.type, OLD.title, OLD.message, OLD.context_type,
      OLD.context_id, OLD.context_data, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'notifications: only is_read and read_at may be updated';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notifications_guard_update ON public.notifications;
CREATE TRIGGER trg_notifications_guard_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_guard_update();

COMMIT;

-- =============================================================================
-- No application change is required for Stage 1.
--
-- STAGE 2 (not in Release B) — close fabrication. Move the 18 client inserts
-- behind RPCs that derive the recipient from the workflow being acted on:
-- notify_assignment(task_id), notify_share(item_id, target_user_id) checking the
-- caller may share that item, and so on. Track separately; it is product work.
-- =============================================================================
