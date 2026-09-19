-- =============================================================================
-- portfolio_holdings: a write must land in the caller's own organization.
--
-- Drafted 2026-09-10 during the bounded portfolio_holdings pass.
-- NOT APPLIED anywhere. See the pre-flight checks at the bottom.
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- Read from the live production database, not from these migration files:
--
--   SELECT   portfolio_in_current_org(portfolio_id)              TO authenticated
--   INSERT   WITH CHECK (auth.uid() = created_by)                TO authenticated
--   UPDATE   (auth.uid() = created_by)
--             OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
--   DELETE   same predicate as UPDATE
--
-- Reads are scoped. Writes are not, and the INSERT policy in particular
-- constrains nothing at all: `created_by` is `DEFAULT auth.uid()`, so
-- `auth.uid() = created_by` is satisfied by construction for every
-- authenticated caller who does not go out of their way to break it. The
-- predicate reads like an ownership check and behaves like `true`.
--
-- The consequence is that any authenticated user can insert holdings rows into
-- ANY portfolio in ANY organization. `portfolio_id` is never checked on the
-- way in, and the table has no `organization_id` of its own to check.
--
-- ── What the data shows, stated carefully ─────────────────────────────────
--
-- 1,086 rows across 36 portfolios. 700 of them sit in portfolios whose
-- organization the row's creator has no membership in — not an expired one, no
-- membership row at all — spread over 20 organizations, written by 2 accounts
-- across 17 days between 2026-04-27 and 2026-07-31.
--
-- That is NOT presented here as evidence of an attack. Both accounts are
-- ordinary users of this pre-release system, the window matches pilot
-- provisioning, and the onboarding wizard and seeding paths both create
-- portfolios and holdings across many organizations. The honest reading is
-- that routine provisioning crosses organization boundaries constantly and
-- nothing stops it — so the policy is not merely theoretically weak, it is
-- weak in a direction the product already leans on.
--
-- Which is also the reason to be careful: tightening INSERT will break any
-- flow that depends on writing outside the caller's current organization.
-- Everything in the application writes to a portfolio in `currentOrgId`
-- (verified: ClientOnboardingWizard creates the portfolio with
-- `organization_id: currentOrgId` immediately before seeding it), and seeding
-- scripts use the service role, which bypasses RLS entirely. So the expected
-- blast radius is zero. Expected is not observed — see the pre-flight.
--
-- ── What changes ──────────────────────────────────────────────────────────
--
-- INSERT gains the organization predicate the other three commands already
-- have. UPDATE and DELETE keep their existing shape but lose the bare
-- `auth.uid() = created_by` branch that applied with no reference to the
-- portfolio at all — a user who created a row and later left that organization
-- could still mutate it. Membership, not authorship, is what should carry the
-- right, and the creator branch is retained INSIDE the organization check so an
-- ordinary member can still edit their own rows without being an admin.
--
-- Deliberately NOT changed:
--   * the SELECT policy, which is already correct
--   * `created_by`'s DEFAULT, which is the right way to establish authorship
--   * anything about the `anon` role's grants on this table (out of scope for
--     this pass, and recorded as an open risk instead)
-- =============================================================================

BEGIN;

-- ── INSERT ───────────────────────────────────────────────────────────────
-- Authorship AND organization. Either alone is insufficient: authorship alone
-- is what we have today and constrains nothing, and organization alone would
-- let a member write rows attributed to somebody else.
DROP POLICY IF EXISTS "Users can create portfolio holdings" ON public.portfolio_holdings;
CREATE POLICY "Portfolio holdings: insert into own org"
  ON public.portfolio_holdings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND portfolio_in_current_org(portfolio_id)
  );

-- ── UPDATE ───────────────────────────────────────────────────────────────
-- The organization check is now unconditional; within it, either the row's
-- creator or an active org admin may write. USING and WITH CHECK are identical
-- so a row cannot be updated OUT of the caller's organization either — without
-- the WITH CHECK half, an admin could repoint portfolio_id at another org's
-- portfolio and the row would leave with it.
DROP POLICY IF EXISTS "Portfolio holdings: owner or org admin update" ON public.portfolio_holdings;
CREATE POLICY "Portfolio holdings: owner or org admin update"
  ON public.portfolio_holdings
  FOR UPDATE TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (auth.uid() = created_by OR is_active_org_admin_of_current_org())
  )
  WITH CHECK (
    portfolio_in_current_org(portfolio_id)
    AND (auth.uid() = created_by OR is_active_org_admin_of_current_org())
  );

-- ── DELETE ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Portfolio holdings: owner or org admin delete" ON public.portfolio_holdings;
CREATE POLICY "Portfolio holdings: owner or org admin delete"
  ON public.portfolio_holdings
  FOR DELETE TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (auth.uid() = created_by OR is_active_org_admin_of_current_org())
  );

COMMIT;

-- =============================================================================
-- BEFORE APPLYING
--
-- Migrations in this repository do not describe production, and this one was
-- written against a live read rather than against these files. Confirm each of
-- the following on the target database first.
--
-- 1. The two helper functions still exist and still mean what this assumes:
--
--      SELECT pg_get_functiondef(oid) FROM pg_proc
--      WHERE proname IN ('portfolio_in_current_org','is_active_org_admin_of_current_org');
--
--    `current_org_id()` resolves `users.current_organization_id` and requires
--    an active, unexpired membership. If that changes, every predicate here
--    changes with it.
--
-- 2. Nothing legitimate writes across organizations. The pre-change policies
--    permitted it and 700 existing rows took that path, so this is the check
--    that decides whether the migration is safe or breaking:
--
--      -- who is still writing, and where
--      SELECT p.organization_id, h.created_by, count(*)
--      FROM portfolio_holdings h JOIN portfolios p ON p.id = h.portfolio_id
--      WHERE h.created_at > now() - interval '30 days'
--        AND NOT EXISTS (SELECT 1 FROM organization_memberships om
--                        WHERE om.user_id = h.created_by
--                          AND om.organization_id = p.organization_id
--                          AND om.status = 'active')
--      GROUP BY 1,2 ORDER BY 3 DESC;
--
--    A non-empty recent result means a live flow depends on the hole. Find it
--    before closing it.
--
-- 3. The 700 existing rows are NOT touched by this migration. Policies gate
--    future statements; they do not retro-validate stored rows. Those rows
--    remain readable and, after this change, editable only by someone whose
--    current organization owns the portfolio — which is the intended end state,
--    but it does mean their original creators may lose write access to them.
--
-- 4. Roll back by restoring the three policies exactly as quoted at the top of
--    this file. They are reproduced there verbatim for that purpose.
-- =============================================================================
