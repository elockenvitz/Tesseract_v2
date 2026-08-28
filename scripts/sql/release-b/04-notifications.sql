-- =============================================================================
-- Security Release B · Step 4 — notifications CONTAINMENT (V1)
--
-- STATUS: not executed anywhere. §0 is MANDATORY and must be read before §2.
--
-- Supersedes the earlier "Stage 1 attribution" draft of this file. Attribution
-- alone was rejected as closure, correctly: knowing who forged a notification is
-- not the same as preventing it. This version removes direct client INSERT.
--
-- ── What is live right now ───────────────────────────────────────────────────
--
--   "Users can read their own notifications"   SELECT USING (auth.uid() = user_id)
--   "Users can update their own notifications" UPDATE USING/CHECK (auth.uid() = user_id)
--   "System can create notifications"          INSERT WITH CHECK (true)
--
-- Read and update are correctly own-user scoped and are KEPT. INSERT is not:
-- any authenticated user can create a notification addressed to any user, with
-- any title and body — an attacker-authored message rendered inside the
-- product's own notification centre, with the product's chrome lending it
-- credibility. That is what this step closes.
--
-- ── The trap in this change, and why §0 is mandatory ─────────────────────────
--
-- "Revoke INSERT from authenticated, the triggers are SECURITY DEFINER so they
-- are fine" is WRONG here, and would take down core write paths.
--
-- Of the 25 `notify_*` trigger functions, 21 are SECURITY DEFINER and are
-- genuinely unaffected. FOUR ARE SECURITY INVOKER, and so are the three
-- `create_*_notification` helpers they delegate to. Invoker-rights functions run
-- as the calling user, so they are subject to exactly the grant this step
-- removes — and they are attached to triggers on core tables:
--
--   assets              -> asset_field_changes_notification -> notify_asset_field_changes
--   price_targets       -> price_target_changes_notification -> notify_price_target_changes
--   note_collaborations -> note_collaboration_notification  -> notify_note_sharing
--
-- A trigger failure aborts the statement that fired it. Without §1, revoking the
-- grant would mean **editing an asset field, saving a price target, or sharing a
-- note would start failing outright** — a far worse outcome than the fabricated
-- notifications this is meant to stop.
--
-- The bodies were reviewed in migration 20250827230714_crimson_paper.sql: each
-- one reads the triggering row (a note title, an asset symbol), inserts a
-- notification, and dedupes with an UPDATE. That is the same shape as the 21
-- siblings that are already SECURITY DEFINER, so promoting them grants no
-- capability those 21 do not already have.
--
-- I could not enumerate function BODIES from the sanitized inventory, only their
-- security mode. §0 is therefore a discovery query, not a formality: it is the
-- only way to be sure no other invoker-rights function writes this table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. MANDATORY. Run this FIRST and read the output. Read-only.
-- -----------------------------------------------------------------------------
--
-- Every SECURITY INVOKER function whose body touches `notifications`. Each one
-- will break when the grant is revoked unless it appears in §1. If this returns
-- a row that §1 does not ALTER, STOP and add it (after reading its body).

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS is_security_definer,
       (p.prosrc ~* '\minsert\s+into\s+(public\.)?notifications\M') AS inserts,
       (p.prosrc ~* '\mupdate\s+(public\.)?notifications\M')        AS updates
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT p.prosecdef
   AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?notifications\M'
 ORDER BY p.proname;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Keep the legitimate server-side producers working
-- -----------------------------------------------------------------------------
--
-- These are owned by `postgres`, so SECURITY DEFINER makes them run with
-- BYPASSRLS and the revoked grant stops applying to them. `search_path` is
-- pinned at the same time: promoting a function to definer rights WITHOUT
-- pinning it would turn each one into a fresh privilege-escalation surface,
-- which is how this kind of fix usually goes wrong.
--
-- ALTER FUNCTION changes only the security attribute — no body is rewritten, so
-- this cannot alter notification behaviour.

ALTER FUNCTION public.notify_asset_field_changes()      SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_price_target_changes()     SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_note_sharing()             SECURITY DEFINER SET search_path = public, pg_temp;
-- No trigger currently references this one, but it is the same family and would
-- be a landmine for whoever wires it up next.
ALTER FUNCTION public.notify_asset_content_changes()    SECURITY DEFINER SET search_path = public, pg_temp;

-- The helpers the four above delegate to. These are where the INSERT actually
-- happens, so promoting only the wrappers would not have been enough.
ALTER FUNCTION public.create_asset_change_notification(asset_id_param uuid, notification_type_param notification_type, title_param text, message_param text, context_data_param jsonb)
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.create_note_collaboration_notification(note_id_param uuid, note_type_param text, notification_type_param notification_type, title_param text, message_param text, exclude_user_id uuid)
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.create_list_share_notification()
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public._emit_coverage_notification(recipient_id uuid, action_kind text, symbols text[], asset_ids uuid[], actor_id uuid)
  SECURITY DEFINER SET search_path = public, pg_temp;

-- NOT promoted, deliberately: mark_notification_read(uuid) and
-- mark_all_notifications_read() are invoker-rights and only UPDATE, which the
-- own-user UPDATE policy still permits. They must stay invoker-rights — as
-- definer they would mark ANY user's notification read.

-- -----------------------------------------------------------------------------
-- 2. Close direct client INSERT
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;

REVOKE INSERT ON public.notifications FROM authenticated;
REVOKE ALL    ON public.notifications FROM anon;

-- Belt and braces: with no INSERT policy, RLS denies the write even if the
-- grant is restored by a later migration that does not know why it was removed.

-- -----------------------------------------------------------------------------
-- 3. Keep read and acknowledgement exactly as they are — and no wider
-- -----------------------------------------------------------------------------
--
-- The two existing policies are correct and are NOT touched:
--   SELECT USING (auth.uid() = user_id)
--   UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
--
-- They scope the ROW correctly and leave every COLUMN writable, so a recipient
-- can currently rewrite the title and body of a notification they were sent.
-- RLS cannot express a column-level rule, so a trigger does it.

CREATE OR REPLACE FUNCTION public.notifications_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Server-side writers (triggers running as postgres/service_role) dedupe and
  -- rewrite notifications legitimately. Only constrain a real end-user session.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.user_id, NEW.type, NEW.title, NEW.message,
      NEW.context_type, NEW.context_id, NEW.context_data, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.type, OLD.title, OLD.message,
      OLD.context_type, OLD.context_id, OLD.context_data, OLD.created_at)
  THEN
    RAISE EXCEPTION 'notifications: only is_read and read_at may be updated';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notifications_guard_update ON public.notifications;
CREATE TRIGGER trg_notifications_guard_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_guard_update();

-- -----------------------------------------------------------------------------
-- 4. Prove the outcome
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_insert_policies int;
  v_insert_grants   int;
  v_select_policies int;
  v_invoker_writers int;
BEGIN
  SELECT count(*) INTO v_insert_policies FROM pg_policies
   WHERE schemaname='public' AND tablename='notifications' AND cmd IN ('INSERT','ALL');
  SELECT count(*) INTO v_insert_grants FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='notifications'
     AND grantee IN ('authenticated','anon') AND privilege_type='INSERT';
  SELECT count(*) INTO v_select_policies FROM pg_policies
   WHERE schemaname='public' AND tablename='notifications' AND cmd='SELECT';
  SELECT count(*) INTO v_invoker_writers FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND NOT p.prosecdef
     AND p.prosrc ~* '\minsert\s+into\s+(public\.)?notifications\M';

  IF v_insert_policies <> 0 THEN
    RAISE EXCEPTION 'containment incomplete: % INSERT/ALL policy(ies) remain', v_insert_policies;
  END IF;
  IF v_insert_grants <> 0 THEN
    RAISE EXCEPTION 'containment incomplete: % client INSERT grant(s) remain', v_insert_grants;
  END IF;
  IF v_select_policies = 0 THEN
    RAISE EXCEPTION 'over-tightened: the own-user SELECT policy is gone';
  END IF;
  IF v_invoker_writers <> 0 THEN
    RAISE EXCEPTION 'BREAKAGE: % invoker-rights function(s) still INSERT into notifications and will now fail — see §0', v_invoker_writers;
  END IF;

  RAISE NOTICE 'notifications contained: no client INSERT, own-user SELECT/UPDATE intact, 0 invoker-rights writers.';
END $$;

COMMIT;

-- =============================================================================
-- WHAT STOPS PRODUCING NOTIFICATIONS
--
-- 20 direct client INSERT sites stop (the audit said "18"; a re-count against
-- the code found 20). Reads, acknowledgement, and every trigger-driven
-- notification keep working.
--
-- Nineteen fail SILENTLY — they are written fire-and-forget, either ignoring the
-- error or logging it. The in-app action still succeeds; the recipient simply is
-- not told:
--
--   AssignmentSelector.tsx:167, :208        task/stage assignment      (silent)
--   ShareToUserModal.tsx:105                "shared with you"          (silent)
--   AccessRequestModal.tsx:83, :112         access request + approval  (silent)
--   WorkflowManager.tsx:387                 workflow sharing           (silent)
--   CollaborationManager.tsx:164            collaboration invites      (silent)
--   PromptModal.tsx:419                     prompt to a colleague      (silent)
--   MessagingSection.tsx:322                @mention in a comment      (silent)
--   DirectMessaging.tsx:472                 added to a conversation    (silent)
--   ThemeTab.tsx:385                        theme sharing              (silent)
--   accepted-trade-service.ts:607           accepted trade notices     (silent)
--   inbox-accept-pipeline.ts:155            inbox acceptance           (silent)
--   recommendation-service.ts:378           recommendations            (silent)
--   AssetTab.tsx:2230                       asset sharing              (logged)
--   TradeIdeaDetailModal.tsx:1734           trade idea mentions        (logged)
--   DecisionItemCard.tsx:388                decision item responses    (logged)
--   simulation-share-service.ts:259, :353   simulation shares          (logged)
--
-- ONE fails VISIBLY, and should:
--
--   DecisionInbox.tsx:234                   "nudge" a PM for a decision
--
-- It is the only site whose mutation exists SOLELY to send the notification —
-- there is no other side effect — so its `if (error) throw error` and its
-- "Follow-up failed" toast are telling the truth. That call site is deliberately
-- left throwing: making it silent would report "Follow-up sent" when nothing was
-- sent, which is worse than an honest failure. Expect user reports of nudges
-- failing in the Decision Inbox for as long as containment is in place.
--
-- This is a real product regression and it is the accepted trade: a notification
-- nobody receives is better than one anybody can forge.
--
-- No client code is changed here. Leaving the call sites in place means Stage 2
-- is a call-site swap rather than a re-implementation.
--
-- STAGE 2 (not in Release B): a trusted creation RPC per workflow that derives
-- the recipient from the object being acted on, then migrate these 18. Arbitrary
-- client INSERT is never restored.
-- =============================================================================
