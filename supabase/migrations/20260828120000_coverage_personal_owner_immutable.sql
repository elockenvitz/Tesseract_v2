-- =============================================================================
-- Personal coverage: the owner is immutable after creation.
--
-- Stage 3.5. One invariant, one trigger, nothing else.
--
-- ── The gap ────────────────────────────────────────────────────────────────
--
-- Stage 3 made `coverage_scope` immutable, so a personal row cannot be
-- converted into a governed assignment. It did not make the OWNER immutable.
--
-- `coverage_update_admin` is deliberately not lane-restricted, so that admins
-- can govern and clean up personal rows — which means a coverage admin can
-- change `user_id` on a personal row. A self-declaration by User A becomes a
-- self-declaration by User B, with no record that the subject changed, and
-- User B can then edit and retire it as their own.
--
-- That is a provenance defect rather than a tenant-boundary one: it stays
-- inside one organization and needs the `coverage_admin` flag. It matters now
-- because "personal" is a claim about a specific person, and Stage 4 is about
-- to create real personal rows. An attributable record whose attribution can be
-- rewritten is not a record.
--
-- Verified against production 2026-08-28: Stage 3 live, 34 rows, all `org`,
-- **0 personal rows**. So this migration changes the behaviour of exactly zero
-- existing rows and closes the gap before the first one exists.
--
-- ── Why a separate trigger rather than widening the existing one ───────────
--
-- `enforce_coverage_scope_immutable()` is live in production and working. It is
-- named for exactly one job, and teaching it a second would make the name lie
-- and would mean re-deploying a functioning guarantee for no functional gain.
--
-- Additive is also the safer rollback: this trigger can be dropped on its own
-- without touching scope immutability. Two BEFORE UPDATE triggers on one table
-- is mild fragmentation; re-deploying a working security control to avoid it is
-- a worse trade.
--
-- ── Why a trigger and not RLS ──────────────────────────────────────────────
--
-- The gap is reachable THROUGH the admin lane, so no change to the personal
-- policies can close it, and narrowing the admin lane would remove the
-- governance ability it exists to provide. A trigger also holds for
-- `service_role` and the table owner, neither of which any policy constrains —
-- which is what "should also not silently reassign it through normal UPDATE"
-- requires.
--
-- Deliberate maintenance is still possible, but not silently: it needs an
-- explicit `ALTER TABLE public.coverage DISABLE TRIGGER
-- trg_coverage_personal_owner_immutable`, which is a decision somebody makes
-- and can be found in the audit of what they ran.
--
-- ── What this deliberately does NOT do ─────────────────────────────────────
--
-- Org-assigned coverage keeps its existing reassignment behaviour completely.
-- Reassigning a governed name from one analyst to another is a normal, correct
-- coverage-admin action and the whole `analyst_changed` history type exists to
-- record it. The guard fires only when `OLD.coverage_scope = 'personal'`.
--
-- It also does not touch the other Stage 3 follow-ups — free-text `role`,
-- `service_role` organization mobility, or the same-day remove/re-add date
-- arithmetic. See docs/tickets/coverage-stage-3-follow-ups.md.
--
-- Idempotent: CREATE OR REPLACE plus DROP-then-CREATE on the trigger.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_personal_coverage_owner_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Keyed on OLD, not NEW. A row that is personal NOW may not change hands.
  -- Reading NEW would let a single statement that also flipped the lane slip
  -- past — that flip is already refused by
  -- `enforce_coverage_scope_immutable()` (P0032), but this predicate should not
  -- depend on another trigger having run first to be correct.
  IF OLD.coverage_scope = 'personal'
     AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'personal coverage ownership is immutable (attempted % -> %). A personal '
      'declaration belongs to the person who made it: retire this row and let '
      'the new owner declare their own.',
      OLD.user_id, NEW.user_id
      USING ERRCODE = 'P0033';
  END IF;

  RETURN NEW;
END;
$function$;

-- Fires BEFORE UPDATE, ahead of `trg_coverage_scope_immutable` by name order.
-- Both are refusals, so which error surfaces first on a statement that attempts
-- both changes does not matter; what matters is that neither is reachable.
--
-- No BEFORE trigger on this table writes `user_id`
-- (`stamp_personal_coverage_provenance` sets only created_by / changed_by,
-- `enforce_coverage_org_consistency` mutates nothing), so NEW.user_id here is
-- what the caller actually sent.
DROP TRIGGER IF EXISTS trg_coverage_personal_owner_immutable ON public.coverage;
CREATE TRIGGER trg_coverage_personal_owner_immutable
  BEFORE UPDATE ON public.coverage
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_coverage_owner_immutable();

COMMENT ON FUNCTION public.enforce_personal_coverage_owner_immutable() IS
  'Stage 3.5. Refuses any UPDATE that changes coverage.user_id on a row whose '
  'coverage_scope is already ''personal''. Org-assigned coverage is untouched '
  'and retains normal admin reassignment. Raises P0033.';

COMMIT;
