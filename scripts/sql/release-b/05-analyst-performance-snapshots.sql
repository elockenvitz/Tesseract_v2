-- =============================================================================
-- Security Release B · Step 5 — analyst_performance_snapshots
--
-- STATUS: executed and ACCEPTED on staging 2026-08-28. NOT executed on production.
-- RUN ORDER: after 04. §0 is mandatory — the live policies differ from this
--         repository's migration.
--
-- ── How this was found ───────────────────────────────────────────────────────
--
-- By the sibling detector added to scripts/unconditional-policy-guard.mjs, on
-- the day it was written. No previous check could see it: there is no
-- `USING (true)`, so the old guard passed it; the table has RLS, policies and an
-- owner column, so tenant-boundary-lint passed it.
--
-- Live in production AND staging, identically:
--
--   "Users can manage their own snapshots"      ALL    TO public  USING (user_id = auth.uid())
--   "Users can view all performance snapshots"  SELECT TO public  USING (auth.uid() IS NOT NULL)
--
-- Permissive policies OR together, so the effective read boundary is the second
-- one. The per-user policy is exactly right and completely inert for reads:
-- **every authenticated user can read every analyst's performance history in
-- every organization** — hit rates, accuracy, bullish bias, composite score.
--
-- Not anon-reachable: `auth.uid() IS NOT NULL` is false without a session. SEV2,
-- not SEV1.
--
-- ── The write side: checked, and clean ───────────────────────────────────────
--
-- The brief asked to check for similar INSERT/UPDATE siblings. There are none.
-- The table has exactly TWO policies. The `ALL` policy covers INSERT, UPDATE and
-- DELETE with `user_id = auth.uid()`, and its WITH CHECK is empty — which, per
-- PostgreSQL, means the USING expression is applied to the new row as well. So
-- writes are already correctly own-user scoped and are left alone.
--
-- ── Why this is NOT "own rows only" ──────────────────────────────────────────
--
-- Cross-user reads here are a REAL product feature, not an accident:
--
--   src/components/outcomes/PerformanceLeaderboard.tsx   ranks 20 analysts
--     -> usePerformanceLeaderboard(), useAnalystPerformance.ts:288
--   src/components/outcomes/AnalystPerformanceCard.tsx   another user's card
--     -> rendered from OutcomesPage.tsx:475/486 and UserTab.tsx:229
--
-- Both are mounted. Restricting to `user_id = auth.uid()` would silently empty a
-- shipped leaderboard, which is how a security fix gets reverted.
--
-- But that feature is backed by NO authorization today — it is simply "everyone
-- sees everyone", across tenants. The narrowest change that keeps the product
-- working and removes the exposure is to scope reads to the viewer's CURRENT
-- ORGANIZATION. A leaderboard is a within-firm comparison; it was never a
-- cross-firm one.
--
-- No manager/admin tier is added. The brief allows preserving manager visibility
-- only where actual product authorization backs it, and there is none here — no
-- manager role is consulted anywhere in this feature. Inventing one would be
-- inventing a policy, not enforcing one.
--
-- ── Drift note ───────────────────────────────────────────────────────────────
--
-- "Users can manage their own snapshots" exists in production and in NO
-- migration. The repo's migration (20251230000000) instead creates three
-- policies: the same broad SELECT, plus separate INSERT and UPDATE policies.
-- Somebody consolidated them in the dashboard. §0 exists because of that: drop
-- what is actually there, not what this repository believes is there.
--
-- Also absent from production: `update_analyst_performance()`, the function that
-- migration defines to populate this table. So there is no server-side writer to
-- preserve, which is consistent with `useAnalystPerformance` falling back to
-- computing from `price_target_outcomes` when no snapshot row exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. MANDATORY. Run first, read the output, reconcile §2 against it.
-- -----------------------------------------------------------------------------
SELECT policyname, cmd, permissive, array_to_string(roles, ',') AS roles,
       qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'analyst_performance_snapshots'
 ORDER BY cmd, policyname;

-- Expected (2026-08-27 inventory): exactly two PERMISSIVE policies, both TO
-- public — the ALL/own-user one and the broad SELECT. If anything else appears,
-- STOP: a policy this script does not drop may be another broad sibling.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Remove the broad sibling
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view all performance snapshots"
  ON public.analyst_performance_snapshots;

-- -----------------------------------------------------------------------------
-- 2. Replace it with an org-scoped read
-- -----------------------------------------------------------------------------
--
-- The OR here is deliberate and is NOT the defect this release is about. Both
-- branches are independently scoped — one to the caller, one to the caller's
-- organization — so the union is still bounded. The defect is an OR (or a
-- sibling) where ONE branch is unbounded, which is what
-- `auth.uid() IS NOT NULL` was. The guard classifies a predicate by its weakest
-- branch for exactly this reason, and classifies this one as SCOPED.
--
-- The first branch is not redundant: a user with no active membership must still
-- see their own history.

CREATE POLICY analyst_performance_snapshots_select
  ON public.analyst_performance_snapshots
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.organization_memberships m
       WHERE m.user_id = analyst_performance_snapshots.user_id
         AND m.organization_id = public.current_org_id()
         AND m.status = 'active'
    )
  );

-- Supports the EXISTS lookup above.
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_org_active
  ON public.organization_memberships(user_id, organization_id)
  WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 3. Tighten the remaining policy's role, and drop anon
-- -----------------------------------------------------------------------------
--
-- The own-user policy's PREDICATE is correct; only its role is wrong. `TO public`
-- includes anon — inert here because the predicate needs a session, but it is
-- the same shape that made `messages` anon-writable, and it costs nothing to
-- close. Recreated rather than altered: PostgreSQL has no ALTER POLICY ... TO
-- that can narrow this without restating the predicate.

DROP POLICY IF EXISTS "Users can manage their own snapshots"
  ON public.analyst_performance_snapshots;
-- Present in the repo's migration but not in production; dropped in case the
-- environment being patched is the one that matches the repo.
DROP POLICY IF EXISTS "Users can insert their own snapshots"
  ON public.analyst_performance_snapshots;
DROP POLICY IF EXISTS "Users can update their own snapshots"
  ON public.analyst_performance_snapshots;

CREATE POLICY analyst_performance_snapshots_write
  ON public.analyst_performance_snapshots
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.analyst_performance_snapshots FROM anon;

-- -----------------------------------------------------------------------------
-- 4. Prove the outcome
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_broad int;
  v_anon  int;
  v_sel   int;
BEGIN
  -- No remaining predicate that merely proves a session exists.
  SELECT count(*) INTO v_broad FROM pg_policies
   WHERE schemaname='public' AND tablename='analyst_performance_snapshots'
     AND (qual = 'true' OR with_check = 'true'
          OR qual ~* '^\(?\s*auth\.uid\(\)\s+IS\s+NOT\s+NULL\s*\)?$');
  SELECT count(*) INTO v_anon FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='analyst_performance_snapshots' AND grantee='anon';
  SELECT count(*) INTO v_sel FROM pg_policies
   WHERE schemaname='public' AND tablename='analyst_performance_snapshots' AND cmd IN ('SELECT','ALL');

  IF v_broad <> 0 THEN
    RAISE EXCEPTION 'remediation incomplete: % broad policy(ies) remain', v_broad;
  END IF;
  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'remediation incomplete: anon holds % grant(s)', v_anon;
  END IF;
  IF v_sel = 0 THEN
    RAISE EXCEPTION 'over-tightened: no SELECT path remains — the leaderboard would be empty';
  END IF;

  RAISE NOTICE 'analyst_performance_snapshots: broad sibling removed, reads org-scoped, anon revoked.';
END $$;

COMMIT;

-- =============================================================================
-- No application change is required.
--
-- The leaderboard and the analyst card keep working, now bounded to the viewer's
-- organization. Users who belong to no active organization see only themselves.
--
-- AFTER RUNNING: regenerate the inventory and re-run `npm run guard:policies`.
-- `analyst_performance_snapshots` should then be reported by the ratchet as
-- resolved, and must be removed from KNOWN_UNRESOLVED_SIBLING in
-- scripts/unconditional-policy-guard.mjs.
-- =============================================================================
