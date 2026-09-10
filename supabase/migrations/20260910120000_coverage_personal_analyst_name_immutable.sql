-- =============================================================================
-- Personal coverage: the LABEL is as immutable as the owner.
--
-- Stage 3.6. Drafted 2026-09-10 during backlog closure. NOT APPLIED anywhere.
--
-- ── The gap ────────────────────────────────────────────────────────────────
--
-- Stage 3.5 (20260828120000) made `user_id` immutable on personal rows, so a
-- self-declaration can no longer change hands. It left `analyst_name` alone —
-- and `analyst_name` is the denormalised display string every coverage surface
-- actually renders.
--
-- So a coverage admin can leave the owner intact and rewrite the label. The
-- identity of record stays correct, every join and permission still keys off
-- `user_id`, and the row on screen presents as somebody else's declaration.
-- That is the same provenance defect Stage 3.5 closed, arriving through a
-- different column.
--
-- ── Why now, and what settled it ───────────────────────────────────────────
--
-- docs/tickets/coverage-stage-3-follow-ups.md raised this as a named decision
-- point to be taken BEFORE Stage 4, and offered three options. Option 1 was
-- "do nothing, IF Stage 4's surfaces render attribution from `user_id` rather
-- than from `analyst_name`" — with the explicit instruction to check rather
-- than assume.
--
-- Checked. It is false, and not only for Stage 4: surfaces render
-- `analyst_name` as attribution today.
--
--   src/components/coverage/views/CoverageMatrixView.tsx:225  groups the
--     matrix by `c.analyst_name` and prints the group key as a heading (:481)
--   ...:105                       builds the analyst roster from it
--   ...:539-540                   decides whose coverage indicator is whose
--   src/components/coverage/CoverageDisplay.tsx                reads it
--   src/components/coverage/CoverageManager.tsx                reads it
--   src/components/contributions/ThesisContainer.tsx:95        selects it
--
-- The ticket's own reason is that `coverage.user_id` carries no FK, so
-- PostgREST cannot embed through it and every surface reads the denormalised
-- column instead. That is still true, which is why option 3 — resolving the
-- name at read time and leaving the column empty — remains the largest change
-- and is not what this does.
--
-- So the ticket's recommendation applies: do option 2, a near-copy of the
-- migration deployed on 2026-08-28.
--
-- ── The one place this departs from a copy ─────────────────────────────────
--
-- The ticket names option 2's weakness precisely: a genuine display-name
-- correction — someone changes their surname — would need the row retired and
-- recreated. Refusing that is worse than the defect, because the workaround
-- destroys the very start_date provenance the row exists to carry.
--
-- So this refuses a change that makes the row present as SOMEBODY ELSE, and
-- allows one that keeps it presenting as its own owner. The test is against
-- `users`, which is the identity of record:
--
--   allowed   the new label matches the owner's current name in `users`
--   allowed   the old label was NULL or empty — filling a gap, not rewriting
--   refused   anything else
--
-- A surname change therefore lands once the user record is updated, which is
-- the correct order anyway: the denormalised copy follows the source, it does
-- not lead it. An admin cannot use this path to write an arbitrary string,
-- because the only string it accepts is one already true of the owner.
--
-- ── Why a trigger, and why a third one ─────────────────────────────────────
--
-- Same reasoning as Stage 3.5, and it has not changed. The gap is reachable
-- THROUGH the admin lane, so no policy change closes it; a trigger also binds
-- `service_role` and the table owner, which no policy constrains. Additive
-- rather than widening `enforce_personal_coverage_owner_immutable()`, so this
-- can be dropped on its own without re-deploying a live, working control.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
--
-- Org-assigned coverage is untouched: the guard fires only when
-- `OLD.coverage_scope = 'personal'`. Renaming the analyst on a governed
-- assignment stays a normal coverage-admin action.
--
-- Production held 0 personal rows at the last verification (2026-08-28, 34
-- rows, all `org`). VERIFY THAT IS STILL TRUE BEFORE APPLYING — migrations do
-- not describe this production database and the count is the whole basis for
-- calling this near-zero risk. If personal rows now exist, check first whether
-- any carries an `analyst_name` that disagrees with its owner's name in
-- `users`; such a row cannot be updated at all afterwards without correcting
-- one side or disabling the trigger.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- Unchanged. No policy is created, altered or dropped. This is strictly a
-- refusal added on top of whatever the existing policies already permit, and
-- it can only reduce what an UPDATE is allowed to do.
--
-- Reads `public.users` inside a SECURITY INVOKER function, so the lookup runs
-- with the caller's own rights. A caller who cannot see the owner's row gets
-- NULL from the lookup and the update is refused — which is the safe
-- direction. It is deliberately NOT SECURITY DEFINER: making the check
-- succeed for callers who cannot otherwise see that user would widen what the
-- function reveals in order to make a guard more permissive.
--
-- ── BEFORE APPLYING — this was drafted from files, not from the database ──
--
-- Migrations in this repository do not describe production. Three things must
-- be checked against the live database first, and none of them can be checked
-- from here:
--
--   1. `public.users` has `first_name`, `last_name` and `email`. The name
--      composition below mirrors CoverageManager.tsx:2080 and depends on all
--      three.
--   2. `coverage` still holds 0 rows with `coverage_scope = 'personal'`, or,
--      if not, that no such row carries an `analyst_name` disagreeing with its
--      owner's composed name — such a row becomes un-updatable.
--   3. `enforce_personal_coverage_owner_immutable` (Stage 3.5) is live, since
--      this is deliberately additive to it rather than a replacement.
--
-- Idempotent: CREATE OR REPLACE plus DROP-then-CREATE on the trigger.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_personal_coverage_name_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_name text;
BEGIN
  -- Keyed on OLD for the same reason as Stage 3.5: a row that is personal NOW
  -- may not be relabelled, and this predicate must not depend on another
  -- trigger having already refused a lane flip in the same statement.
  IF OLD.coverage_scope IS DISTINCT FROM 'personal' THEN
    RETURN NEW;
  END IF;

  IF NEW.analyst_name IS NOT DISTINCT FROM OLD.analyst_name THEN
    RETURN NEW;
  END IF;

  -- Filling a blank is not rewriting attribution.
  IF OLD.analyst_name IS NULL OR btrim(OLD.analyst_name) = '' THEN
    RETURN NEW;
  END IF;

  /*
    The only new label this accepts is one already true of the owner.

    Composed exactly as the client composes it — CoverageManager.tsx:2080:

        first_name && last_name  ->  "First Last"
        otherwise                ->  the local part of the email
        otherwise                ->  'Unknown'

    Mirrored rather than approximated on purpose. A guard that accepts a
    slightly different string than the application writes would reject the
    application's own legitimate update, and a guard that fires on correct
    behaviour gets disabled.
  */
  SELECT CASE
           WHEN btrim(COALESCE(u.first_name, '')) <> ''
            AND btrim(COALESCE(u.last_name, ''))  <> ''
             THEN btrim(u.first_name) || ' ' || btrim(u.last_name)
           WHEN COALESCE(u.email, '') <> ''
             THEN split_part(u.email, '@', 1)
           ELSE 'Unknown'
         END
    INTO v_owner_name
  FROM public.users u
  WHERE u.id = OLD.user_id;

  IF v_owner_name IS NOT NULL
     AND btrim(COALESCE(NEW.analyst_name, '')) = v_owner_name THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'personal coverage attribution is immutable (attempted % -> %). The label '
    'on a personal declaration may only be set to the owner''s own name as '
    'recorded in users; correct the user record first, or retire this row.',
    OLD.analyst_name, NEW.analyst_name
    USING ERRCODE = 'P0034';
END;
$function$;

DROP TRIGGER IF EXISTS trg_coverage_personal_name_immutable ON public.coverage;
CREATE TRIGGER trg_coverage_personal_name_immutable
  BEFORE UPDATE ON public.coverage
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_coverage_name_immutable();

COMMENT ON FUNCTION public.enforce_personal_coverage_name_immutable() IS
  'Stage 3.6. Refuses any UPDATE that changes coverage.analyst_name on a row '
  'whose coverage_scope is already ''personal'', unless the new value is the '
  'owner''s current name in public.users or the old value was blank. '
  'Org-assigned coverage is untouched. Raises P0034.';

COMMIT;
