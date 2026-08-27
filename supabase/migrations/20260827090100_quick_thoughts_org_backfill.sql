-- ============================================================================
-- quick_thoughts — Stage A/1: attribute the legacy rows, quarantine the rest
-- ============================================================================
--
-- 18 of 20 production rows predate `organization_id` and carry NULL. A NULL is
-- currently harmless-looking and actually load-bearing: once the tenant-aware
-- policies land (20260827090400), every predicate compares
-- `organization_id = current_org_id()`, and `NULL = <uuid>` is NULL, which is
-- not TRUE, which is denied. So a row left NULL is readable by nobody.
--
-- That makes the attribution rule a security decision, not a data-cleanup one.
-- Attribute a row to the wrong org and you have not lost it — you have handed
-- it to a stranger.
--
-- ── The rule: membership held at creation time ────────────────────────────
--
-- The withdrawn 20260820120000 used `users.current_organization_id`: a mutable
-- pointer to where the author is standing *today*. Measured against live data
-- that misattributes 6 of 18 rows. See that file for the full account.
--
-- This migration instead asks what the author could possibly have meant: which
-- organizations did they actually belong to at the moment the row was written?
--
--     joined_at <= created_at AND (expires_at IS NULL OR expires_at > created_at)
--
-- Membership status is deliberately NOT filtered to 'active'. A membership
-- since revoked was still real when the row was written, and including it can
-- only ADD candidates — which pushes rows toward quarantine, never toward a
-- confident wrong answer. Measured on production this changes nothing (no
-- author has a non-active membership), but the rule is safe if that changes.
--
-- Rows with exactly one candidate are attributed. Rows with more than one are
-- left NULL. There is no tie-break, because every available tie-break is a
-- guess, and a guess here is the leak.
--
-- ── Expected result on production, verified read-only 2026-08-27 ──────────
--
--   15 rows  exactly one candidate            -> attributed (all to Tesseract)
--    1 row   sole-lifetime-membership rule    -> attributed (see below)
--    2 rows  three candidates each            -> QUARANTINED, left NULL
--
-- ── The one pre-org-era row ───────────────────────────────────────────────
--
-- One row was written 2025-12-10, four days before its author's membership
-- record begins — it predates org scoping entirely, so no membership was held
-- at creation time and the main rule yields zero candidates. Re-verified
-- across that author's entire membership history, all statuses: exactly one
-- membership row, exactly one distinct organization, active, never suspended,
-- no expiry. An author who has only ever belonged to one organization cannot
-- have written for a different one. That is a bounded, checkable claim, not an
-- inference, so it is applied as its own explicit rule below.
--
-- ── The corruption guard ──────────────────────────────────────────────────
--
-- This migration does not assume 20260820120000 never ran somewhere unlisted.
-- Before attributing anything it re-examines rows that ALREADY have an org and
-- quarantines any whose stamp is impossible — an organization the author did
-- not hold at the row's creation time. On production today that flags 0 rows;
-- had the withdrawn migration run, it would flag exactly its 6 misattributions.
-- Corrupt rows are set back to NULL and then re-attributed by the rule below
-- if, and only if, the evidence is unambiguous. They are never re-guessed.
--
-- The guard exempts the sole-lifetime-membership case, which is legitimately
-- "joined after" and is the one row the rule above intentionally attributes.
--
-- ── Idempotency ───────────────────────────────────────────────────────────
--
-- Every statement is a no-op on a second run: the guard finds nothing left to
-- quarantine, and both attribution rules only touch `organization_id IS NULL`.
--
-- Quarantined production rows, recorded so they can be resolved by hand:
--   3af99015-e900-4d4d-9f2e-074ca6731d47   2026-06-04
--   52dc25cb-e0db-4a03-9783-c53ec9cc96de   2026-06-04
-- Both by one author, written ~1h after they joined their third organization.

-- ── Step 0: stand down the NOT NULL guard for the duration ───────────────────
--
-- Step 1 quarantines by writing NULL, and Step 4 adds a constraint forbidding
-- NULL. On a first run that order is fine — the constraint does not exist yet.
-- On a SECOND run it is not: the constraint from the first run rejects the
-- quarantine UPDATE with 23514 and takes the whole migration down, exactly when
-- the guard is most needed (a row corrupted after the first run is the case it
-- exists for). Verified on staging 2026-08-27 by corrupting a row and re-running.
--
-- Dropping it here and re-adding it in Step 4 makes the migration re-runnable
-- under corruption, which is the only condition worth being re-runnable for.
-- The window is inside this transaction; nothing else can write through it.

ALTER TABLE public.quick_thoughts
  DROP CONSTRAINT IF EXISTS quick_thoughts_organization_id_not_null;

-- ── Step 1: quarantine impossible attributions ───────────────────────────────

WITH corrupt AS (
  SELECT q.id
  FROM public.quick_thoughts q
  WHERE q.organization_id IS NOT NULL
    -- the stamped org is not one the author held when the row was written
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.user_id = q.created_by
        AND om.organization_id = q.organization_id
        AND om.joined_at IS NOT NULL
        AND om.joined_at <= q.created_at
        AND (om.expires_at IS NULL OR om.expires_at > q.created_at)
    )
    -- ...and it is not the legitimate sole-lifetime-membership case
    AND NOT (
      (SELECT count(DISTINCT om.organization_id)
         FROM public.organization_memberships om
        WHERE om.user_id = q.created_by) = 1
      AND EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = q.created_by
          AND om.organization_id = q.organization_id
      )
    )
)
UPDATE public.quick_thoughts q
   SET organization_id = NULL
  FROM corrupt c
 WHERE c.id = q.id;

-- ── Step 2: attribute rows with exactly one possible organization ────────────

WITH candidates AS (
  SELECT q.id,
         count(DISTINCT om.organization_id) AS n,
         (array_agg(DISTINCT om.organization_id))[1] AS org
  FROM public.quick_thoughts q
  JOIN public.organization_memberships om
    ON om.user_id = q.created_by
   AND om.joined_at IS NOT NULL
   AND om.joined_at <= q.created_at
   AND (om.expires_at IS NULL OR om.expires_at > q.created_at)
  WHERE q.organization_id IS NULL
  GROUP BY q.id
  HAVING count(DISTINCT om.organization_id) = 1
)
UPDATE public.quick_thoughts q
   SET organization_id = c.org
  FROM candidates c
 WHERE c.id = q.id
   AND q.organization_id IS NULL;

-- ── Step 3: the sole-lifetime-membership rule, for pre-org-era rows ──────────

WITH sole AS (
  SELECT q.id,
         (SELECT om.organization_id
            FROM public.organization_memberships om
           WHERE om.user_id = q.created_by
           LIMIT 1) AS org
  FROM public.quick_thoughts q
  WHERE q.organization_id IS NULL
    -- the author has only ever belonged to one organization
    AND (SELECT count(DISTINCT om.organization_id)
           FROM public.organization_memberships om
          WHERE om.user_id = q.created_by) = 1
    -- and the main rule found nothing, i.e. the row predates that membership
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.user_id = q.created_by
        AND om.joined_at IS NOT NULL
        AND om.joined_at <= q.created_at
        AND (om.expires_at IS NULL OR om.expires_at > q.created_at)
    )
)
UPDATE public.quick_thoughts q
   SET organization_id = s.org
  FROM sole s
 WHERE s.id = q.id
   AND q.organization_id IS NULL
   AND s.org IS NOT NULL;

-- ── Step 4: block any future NULL, tolerate the quarantined rows ─────────────
--
-- NOT VALID so the quarantined rows survive; the constraint still applies to
-- every INSERT and UPDATE from here on. Resolving a quarantined row by setting
-- a real organization satisfies it. Run VALIDATE CONSTRAINT once none remain.

ALTER TABLE public.quick_thoughts
  DROP CONSTRAINT IF EXISTS quick_thoughts_organization_id_not_null;

ALTER TABLE public.quick_thoughts
  ADD CONSTRAINT quick_thoughts_organization_id_not_null
  CHECK (organization_id IS NOT NULL) NOT VALID;

-- ── Step 5: assert the postconditions ────────────────────────────────────────

DO $$
DECLARE
  v_impossible int;
  v_null       int;
BEGIN
  SELECT count(*) INTO v_impossible
  FROM public.quick_thoughts q
  WHERE q.organization_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.user_id = q.created_by
        AND om.organization_id = q.organization_id
        AND om.joined_at IS NOT NULL
        AND om.joined_at <= q.created_at
        AND (om.expires_at IS NULL OR om.expires_at > q.created_at))
    AND NOT (
      (SELECT count(DISTINCT om.organization_id)
         FROM public.organization_memberships om
        WHERE om.user_id = q.created_by) = 1
      AND EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = q.created_by
          AND om.organization_id = q.organization_id));

  IF v_impossible > 0 THEN
    RAISE EXCEPTION
      'quick_thoughts backfill left % row(s) attributed to an organization the author did not hold at creation time',
      v_impossible;
  END IF;

  SELECT count(*) INTO v_null
  FROM public.quick_thoughts WHERE organization_id IS NULL;

  RAISE NOTICE 'quick_thoughts: % row(s) remain quarantined (organization_id IS NULL)', v_null;
END $$;
