-- =============================================================================
-- Security Release B · Step 1 — messages CONTAINMENT
--
-- STATUS: executed and ACCEPTED on staging 2026-08-28. NOT executed on production.
-- RUN ORDER: FIRST of the five. Production execution by Main Control only.
--
-- ── What is live right now ───────────────────────────────────────────────────
--
--   "Users can read messages in contexts they have access to"
--       SELECT TO authenticated  USING (true)
--   "Users can mark messages as read"
--       UPDATE TO public         USING (true)  WITH CHECK (true)
--
-- The names describe an intent the predicates do not implement. Every
-- authenticated user can read every message in every organization, and — because
-- the UPDATE policy names no role and therefore defaults to PUBLIC, while `anon`
-- holds the UPDATE grant — anyone holding the publishable key can rewrite any
-- message's content, author (`user_id`) and context without logging in.
--
-- The provenance is in this repository: scripts/sql/rls_fix_mark_messages_read.sql
-- created that policy to make "mark as read" work, with the comment "This allows
-- marking any message as read without allowing full edit permissions". It grants
-- full edit permissions. Its own suggested alternative, `auth.uid() IS NOT NULL`,
-- would not have helped either.
--
-- ── Why containment rather than going straight to the permanent policy ───────
--
-- `messages` has no tenant column. It is a polymorphic comment table keyed by
-- (context_type, context_id), and one of its context types is `asset` — which is
-- a GLOBAL table. So an asset-context message has no organization to inherit,
-- and no correct SELECT policy can be written until an explicit
-- `organization_id` exists and is backfilled. That is step 2, it needs a
-- backfill whose correctness must be checked against real rows, and it cannot be
-- validated from here.
--
-- Cross-tenant read and unauthenticated write should not stay open while that is
-- built. This step closes both today, at the cost of messaging going dark.
--
-- ── What breaks ──────────────────────────────────────────────────────────────
--
-- Deny-by-default: RLS stays ON and every policy is removed, so `authenticated`
-- and `anon` match no rows. `service_role` and `postgres` are unaffected
-- (BYPASSRLS), so triggers, edge functions and Ops keep working.
--
-- Five surfaces go blank. All are secondary panels; none is on a startup path:
--
--   src/components/communication/MessagingSection.tsx    (Communication pane)
--   src/components/ideas/social/IdeaComments.tsx         (idea comments)
--   src/components/thoughts/TradeIdeaDiscussion.tsx      (trade idea discussion)
--   src/components/trading/TradeIdeaDetailModal.tsx      (modal discussion tab)
--   src/components/ui/checklist/DecisionItemCard.tsx     (inline question thread)
--
-- Each reads through react-query with a `= []` default, so an empty or failed
-- read renders an empty thread rather than throwing. Sends fail with a visible
-- error. No other table's policies reference `messages`, and its only trigger is
-- `update_messages_updated_at`, which does not read the table.
--
-- Reversible by 99-rollback.sql §1, which restores the exact policies below.
-- =============================================================================

BEGIN;

-- 1. Remove the unauthenticated path entirely. `anon` holds the full grant set
--    (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on this table; no
--    first-party client ever authenticates as `anon` against it.
REVOKE ALL ON public.messages FROM anon;

-- 2. Deny by default. RLS remains enabled, so removing every policy denies every
--    row to every non-BYPASSRLS role. Dropped by name and asserted afterwards,
--    rather than trusting that these four are all there is.
DROP POLICY IF EXISTS "Users can read messages in contexts they have access to" ON public.messages;
DROP POLICY IF EXISTS "Users can mark messages as read"                          ON public.messages;
DROP POLICY IF EXISTS "Users can create messages"                                ON public.messages;
DROP POLICY IF EXISTS "Users can delete their own messages"                      ON public.messages;

-- 3. Prove the outcome instead of assuming it. If a policy exists that this
--    script did not know about, or RLS is off, the transaction must not commit.
DO $$
DECLARE
  v_policies int;
  v_rls      boolean;
  v_anon     int;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages';
  SELECT relrowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.messages'::regclass;
  SELECT count(*) INTO v_anon
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'messages' AND grantee = 'anon';

  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'containment incomplete: % policy(ies) still on messages', v_policies;
  END IF;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'containment unsafe: RLS is DISABLED on messages — no policies means NO restriction';
  END IF;
  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'containment incomplete: anon still holds % grant(s) on messages', v_anon;
  END IF;

  RAISE NOTICE 'messages contained: 0 policies, RLS on, 0 anon grants.';
END $$;

COMMIT;
