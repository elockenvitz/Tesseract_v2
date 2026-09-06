-- ============================================================
-- portfolio_holdings: write paths must prove organization ownership
-- ============================================================
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- The only INSERT policy on portfolio_holdings was:
--
--   CREATE POLICY "Users can create portfolio holdings"
--     ON portfolio_holdings FOR INSERT TO authenticated
--     WITH CHECK (auth.uid() = created_by);
--
-- `created_by` has DEFAULT auth.uid(). The predicate is therefore satisfied
-- by construction for every authenticated caller, and it says nothing about
-- which portfolio the row lands in. Any authenticated user holding a
-- portfolio UUID from another organization could write positions into that
-- organization's book.
--
-- It is a BLIND write, not a disclosure: SELECT is correctly gated by
-- portfolio_in_current_org(), so the attacker cannot read the row back. That
-- makes it worse rather than better. Desktop reduces portfolio_holdings to
-- the newest row per (portfolio, asset), so a forged row carrying a future
-- date silently becomes the victim organization's current position — wrong
-- shares, wrong mark, wrong weight, attributable to nobody.
--
-- The tenant-boundary suite covers this table for READS only (cases 3.3 and
-- 8 both count rows the victim can SELECT). The insert path was never tested.
-- supabase/tests/tenant-boundary-p0.sql gains that case in this change.
--
-- ── Why the UPDATE and DELETE policies also change ────────────────────────
--
-- They read:
--
--   auth.uid() = created_by
--   OR (portfolio_in_current_org(portfolio_id)
--       AND is_active_org_admin_of_current_org())
--
-- Two problems. First, they are declared TO PUBLIC rather than
-- TO authenticated — not currently exploitable, because auth.uid() is null
-- for anon and both org predicates fail, but every sibling table pins the
-- role and these two did not.
--
-- Second, and this is the one that bites: authorship is not authority over a
-- book. Onboarding creates a portfolio's rows as whoever ran onboarding,
-- usually an org admin. A non-admin PM later executing a trade on that
-- position satisfies neither branch, so the UPDATE or DELETE matches zero
-- rows. Paired with the unchecked error handling in
-- accepted-trade-service.ts — fixed in the same change — the trade was still
-- marked execution_status='complete' and reconciliation_status='matched' and
-- nobody was told the book had not moved.
--
-- Authority over a position is now: the row is in your organization's
-- portfolio, AND you are one of
--   - the person who created the row,
--   - a member of that portfolio (user_is_portfolio_member also resolves
--     morph sessions, so admin support flows keep working),
--   - an active admin of the current organization.
--
-- That is a strict TIGHTENING of INSERT (from "any authenticated caller" to
-- "a caller in the owning organization") and a narrow WIDENING of
-- UPDATE/DELETE (adding portfolio membership alongside authorship and org
-- admin). The widening is deliberate: it is what makes failing closed on a
-- holdings write safe, rather than a new way for a legitimate PM trade to
-- error.
--
-- ── Explicitly NOT changed here ───────────────────────────────────────────
--
-- SELECT is untouched. The uniqueness key is untouched. No historical rows
-- are collapsed and no working-book RPC is introduced — those belong to the
-- working-book migration, which this change is designed to precede without
-- constraining.
-- ============================================================

-- ============================================================
-- INSERT
-- ============================================================
DROP POLICY IF EXISTS "Users can create portfolio holdings" ON portfolio_holdings;
DROP POLICY IF EXISTS "Portfolio holdings: org-scoped insert" ON portfolio_holdings;

CREATE POLICY "Portfolio holdings: org-scoped insert"
  ON portfolio_holdings FOR INSERT TO authenticated
  WITH CHECK (
    portfolio_in_current_org(portfolio_id)
    AND created_by = auth.uid()
  );

-- `created_by = auth.uid()` is retained alongside the org check so authorship
-- cannot be forged onto another user. It is not load-bearing for tenancy —
-- the org predicate is — and on its own it was the whole of the old policy.

-- ============================================================
-- UPDATE
-- ============================================================
DROP POLICY IF EXISTS "Portfolio holdings: owner or org admin update" ON portfolio_holdings;
DROP POLICY IF EXISTS "Portfolio holdings: org-scoped update" ON portfolio_holdings;

CREATE POLICY "Portfolio holdings: org-scoped update"
  ON portfolio_holdings FOR UPDATE TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (
      created_by = auth.uid()
      OR user_is_portfolio_member(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  )
  WITH CHECK (
    portfolio_in_current_org(portfolio_id)
    AND (
      created_by = auth.uid()
      OR user_is_portfolio_member(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  );

-- WITH CHECK repeats the predicate rather than being omitted, so a row cannot
-- be UPDATEd into another organization's portfolio: the post-image has to
-- satisfy portfolio_in_current_org() too.

-- ============================================================
-- DELETE
-- ============================================================
DROP POLICY IF EXISTS "Portfolio holdings: owner or org admin delete" ON portfolio_holdings;
DROP POLICY IF EXISTS "Portfolio holdings: org-scoped delete" ON portfolio_holdings;

CREATE POLICY "Portfolio holdings: org-scoped delete"
  ON portfolio_holdings FOR DELETE TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (
      created_by = auth.uid()
      OR user_is_portfolio_member(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  );

-- ============================================================
-- portfolio_holdings_snapshots: derive organization_id, never accept it
-- ============================================================
--
-- portfolio_holdings_positions has trg_enforce_holdings_position_org_id,
-- which derives organization_id from the portfolio on INSERT and on any
-- UPDATE of portfolio_id or organization_id. Its parent table has no such
-- trigger and takes whatever the client sends, checked only against
-- current_org_id(). A caller can therefore stamp a snapshot with their own
-- org against a portfolio belonging to another one, and three production
-- rows already carry a NULL organization_id and are invisible to the
-- org-scoped read policy.
--
-- Same derivation, same shape, on the parent.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_holdings_snapshot_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM portfolios
  WHERE id = NEW.portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'portfolio % has no organization', NEW.portfolio_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_holdings_snapshot_org_id ON portfolio_holdings_snapshots;
CREATE TRIGGER trg_enforce_holdings_snapshot_org_id
  BEFORE INSERT OR UPDATE OF portfolio_id, organization_id
  ON portfolio_holdings_snapshots
  FOR EACH ROW EXECUTE FUNCTION enforce_holdings_snapshot_org_id();

-- Backfill the rows that predate the trigger. Three in production, all with a
-- NULL organization_id, all with a resolvable portfolio.
UPDATE portfolio_holdings_snapshots s
   SET organization_id = p.organization_id
  FROM portfolios p
 WHERE p.id = s.portfolio_id
   AND s.organization_id IS DISTINCT FROM p.organization_id;
