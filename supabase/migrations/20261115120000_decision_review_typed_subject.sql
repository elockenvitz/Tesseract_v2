-- =============================================================================
-- decision_reviews: give the reviewed decision a typed identity
--
-- STATUS: NOT APPLIED to any database. Authored for review.
-- Rollback: 20261115120000_decision_review_typed_subject.rollback.sql
--
-- ── What is wrong today ──────────────────────────────────────────────────────
--
-- `decision_reviews.decision_id` is TEXT with no foreign key, and it is
-- POLYMORPHIC: depending on which Outcomes row was open when the PM saved, it
-- holds a `trade_queue_items` id, a `decision_requests` id, or a
-- `portfolio_trade_events` id. Nothing on the row says which.
--
-- The writer already knows. `DecisionAccountabilityPage.tsx` derives it from
-- (source, category) -- discretionary -> trade, passed -> decision, otherwise
-- idea -- passes it to `useUpsertDecisionReview` as `subjectType`, and that
-- function writes it to `memory_events.subject_type` and then DROPS IT. The
-- authoritative table is the one place the discriminator is not kept.
--
-- Three consequences, in order of how much they cost:
--
--   1. The learning cannot be joined to the decision. "What did we conclude
--      about this recommendation?" has no SQL answer: you must text-cast
--      against three tables and hope exactly one matches.
--      `useAssetDecisionTimeline.ts:971` documents this and works around it by
--      offering every id it knows and taking whatever comes back.
--   2. No referential integrity. A review can name an id that does not exist,
--      and six of the eight rows in production do exactly that.
--   3. Nothing records WHAT KIND of thing was reviewed, so if the subject is
--      ever deleted the row becomes unreadable rather than merely orphaned.
--
-- ── The decision ────────────────────────────────────────────────────────────
--
-- No new `decisions` table. `decision_requests` already IS the decision
-- episode: NOT NULL FK to the idea, FKs to portfolio / proposal /
-- proposal_version, and a bidirectional link to `accepted_trades` (49 of 53
-- trades and 43 of 113 requests are linked today). Introducing a second
-- decision entity would be the "separate competing Memory Spine" this work is
-- explicitly not allowed to build.
--
-- What is missing is one typed edge from the REVIEW to the thing reviewed. So:
-- persist the discriminator the writer already computes, and add one real
-- foreign key per subject kind.
--
-- ── Why `decision_id` stays, and keeps its UNIQUE ───────────────────────────
--
-- `useUpsertDecisionReview` upserts with `onConflict: 'decision_id'`, which
-- PostgREST turns into ON CONFLICT (decision_id) and which REQUIRES a unique
-- constraint on exactly that column. Replacing it with UNIQUE(subject_type,
-- decision_id) would break the only writer the moment this migration landed,
-- before any frontend deploy. It also buys nothing: the three id namespaces
-- are all v4 UUIDs, so a cross-table collision is not a practical risk, and
-- the resolver already refuses to establish ownership for an ambiguous id.
--
-- `decision_id` therefore remains the write key and the compatibility read key
-- for the ~20 existing sites that read it. The typed columns are additive.
--
-- ── Why the server derives this, not the client ─────────────────────────────
--
-- The trigger below resolves `subject_type` and the typed column from
-- `decision_id` against the three canonical tables and IGNORES anything the
-- client claims. The client's own `subjectType` is a UI-layer inference from
-- (source, category); it is right today, but a review row's identity must not
-- depend on a caller getting a derivation right. This matches how
-- `organization_id` is already handled on this table.
--
-- Because the server derives it, THIS MIGRATION IS INDEPENDENTLY DEPLOYABLE.
-- It needs no frontend change and no frontend change needs it.
--
-- ── Tenant isolation (Standing Rule 5) ──────────────────────────────────────
--
-- No new table, no new policy, no new grant, no RLS change. `decision_reviews`
-- was made tenant-safe in PR #251: SELECT is `organization_id IS NOT NULL AND
-- is_member_of_org(organization_id)`, INSERT/UPDATE additionally require
-- `reviewed_by = auth.uid() AND can_review_decision(decision_id)`, and
-- `organization_id` is stamped server-side by `decision_reviews_owner`.
--
-- The new columns inherit the table's grants: every grant on this table is
-- table-level (verified -- no `pg_attribute.attacl` is set on any column), so
-- `authenticated` reads and writes them under the same policies as every other
-- column. No column-level GRANT is issued here, deliberately: one would
-- convert the table's grants to column-scoped and silently exclude any column
-- added later.
--
-- The typed columns cannot widen access. They are derived from `decision_id`,
-- which the INSERT policy already requires the caller to own via
-- `can_review_decision`. A caller who cannot establish ownership of the
-- decision is refused before any of this runs.
-- =============================================================================

BEGIN;

-- ── 1. The discriminator ────────────────────────────────────────────────────
--
-- 'unknown' is for the six legacy rows whose `decision_id` resolves to
-- nothing. They are already inert: the SELECT policy hides them
-- (organization_id IS NULL) and `can_review_decision` returns false for a
-- dangling id, so no one can read or update them. They are kept, not deleted,
-- because they are historical review records and this work does not delete
-- decision history. 'unknown' says so on the row instead of leaving it to be
-- re-derived.
--
-- It is NOT a fallback for new rows: the INSERT path cannot reach it, because
-- `decision_reviews_owner` refuses an insert whose decision_id resolves to no
-- single owning portfolio.
ALTER TABLE public.decision_reviews
  ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.decision_reviews
  DROP CONSTRAINT IF EXISTS decision_reviews_subject_type_check;
ALTER TABLE public.decision_reviews
  ADD CONSTRAINT decision_reviews_subject_type_check
  CHECK (subject_type IN ('idea', 'decision', 'trade', 'unknown'));

-- ── 2. The typed edges ──────────────────────────────────────────────────────
--
-- ON DELETE SET NULL, not CASCADE and not RESTRICT.
--
--   CASCADE would delete the learning when the decision is deleted. The review
--   is the only record of what the desk concluded; destroying it is rewriting
--   decision history.
--
--   RESTRICT would make any reviewed idea permanently undeletable, which would
--   reintroduce the class of defect fixed in PR #285 (a missing DELETE path
--   blocking onboarding portfolio removal).
--
-- SET NULL keeps the review, and `subject_type` + `decision_id` still say what
-- it was about -- a VISIBLY orphaned row rather than a silently dangling one.
ALTER TABLE public.decision_reviews
  ADD COLUMN IF NOT EXISTS trade_queue_item_id uuid
    REFERENCES public.trade_queue_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_request_id uuid
    REFERENCES public.decision_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portfolio_trade_event_id uuid
    REFERENCES public.portfolio_trade_events(id) ON DELETE SET NULL;

-- At most one, and the one that is set must agree with `subject_type`.
--
-- All-null is always legal: that is both a legacy row and a row whose subject
-- was later deleted. A constraint demanding exactly one would turn the
-- SET NULL above into a constraint violation on someone else's delete.
ALTER TABLE public.decision_reviews
  DROP CONSTRAINT IF EXISTS decision_reviews_one_subject;
ALTER TABLE public.decision_reviews
  ADD CONSTRAINT decision_reviews_one_subject CHECK (
    (
      (trade_queue_item_id IS NOT NULL)::int
      + (decision_request_id IS NOT NULL)::int
      + (portfolio_trade_event_id IS NOT NULL)::int
    ) <= 1
    AND (trade_queue_item_id IS NULL OR subject_type = 'idea')
    AND (decision_request_id IS NULL OR subject_type = 'decision')
    AND (portfolio_trade_event_id IS NULL OR subject_type = 'trade')
  );

-- Phase 3's decision-history read model joins reviews to decisions by these
-- columns, one asset at a time. Partial so they cost nothing for the rows that
-- do not use them.
CREATE INDEX IF NOT EXISTS idx_decision_reviews_trade_queue_item
  ON public.decision_reviews (trade_queue_item_id)
  WHERE trade_queue_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decision_reviews_decision_request
  ON public.decision_reviews (decision_request_id)
  WHERE decision_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decision_reviews_portfolio_trade_event
  ON public.decision_reviews (portfolio_trade_event_id)
  WHERE portfolio_trade_event_id IS NOT NULL;

-- ── 3. The resolver ─────────────────────────────────────────────────────────
--
-- Mirrors `decision_review_portfolio`'s union, which is already the product's
-- definition of where a `decision_id` can live. Returns NULL when the id hits
-- more than one table, for the same reason that function does: an ambiguous
-- decision_id must not be silently assigned to one of its claimants.
CREATE OR REPLACE FUNCTION public.decision_review_subject_type(p_decision_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH candidates AS (
    SELECT 'idea'::text AS kind
      FROM public.trade_queue_items t WHERE t.id::text = p_decision_id
    UNION
    SELECT 'decision'::text
      FROM public.decision_requests d WHERE d.id::text = p_decision_id
    UNION
    SELECT 'trade'::text
      FROM public.portfolio_trade_events e WHERE e.id::text = p_decision_id
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(kind))[1] END FROM candidates;
$$;

-- Default function grants in this project make every new public function
-- anon-executable, and REVOKE FROM PUBLIC alone does not undo it. This is a
-- helper for a trigger; nothing should call it over the wire.
REVOKE ALL ON FUNCTION public.decision_review_subject_type(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decision_review_subject_type(text) FROM anon;
REVOKE ALL ON FUNCTION public.decision_review_subject_type(text) FROM authenticated;

-- ── 4. Derive on write, from the server ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decision_reviews_set_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_kind text;
BEGIN
  /*
   * `decision_id` is immutable -- `decision_reviews_owner` raises if an UPDATE
   * changes it -- so the subject is established once, at insert, and an UPDATE
   * only ever re-confirms it. That matters for the SET NULL case: if the
   * subject row was deleted, the typed column is null and re-resolving returns
   * null, which is the correct state and not a reason to fail the edit.
   */
  v_kind := public.decision_review_subject_type(NEW.decision_id);

  /*
   * DELETING THE SUBJECT MUST NOT ERASE WHAT WAS REVIEWED.
   *
   * `ON DELETE SET NULL` on the three typed columns is implemented as an
   * UPDATE of this table, so deleting a reviewed idea fires this very trigger.
   * Re-resolving then returns NULL -- the subject is gone -- and the
   * unconditional assignment below used to write `subject_type = 'unknown'`,
   * discarding the one remaining statement of WHAT the review was about. The
   * typed id going null is intended; the label going with it is not. This
   * column's own COMMENT, further down, promises the opposite: "NULL once the
   * idea is deleted; subject_type and decision_id still record what was
   * reviewed."
   *
   * So on UPDATE, when the subject no longer resolves, keep the label the row
   * already carried and let the typed ids go null. `decision_id` is immutable,
   * so OLD.subject_type cannot describe a different decision than NEW does,
   * which is what makes preserving it safe rather than merely convenient.
   *
   * This is the same shape `decision_reviews_set_owner` already uses one
   * trigger earlier: on UPDATE with nothing resolvable it keeps
   * OLD.organization_id rather than clearing it.
   *
   * The resulting row -- a non-'unknown' subject_type with every typed id
   * null -- satisfies `decision_reviews_one_subject`, whose typed-id clauses
   * are each guarded by `IS NULL OR`.
   */
  IF v_kind IS NULL AND TG_OP = 'UPDATE' THEN
    NEW.subject_type := OLD.subject_type;
    NEW.trade_queue_item_id := NULL;
    NEW.decision_request_id := NULL;
    NEW.portfolio_trade_event_id := NULL;
    RETURN NEW;
  END IF;

  /*
   * Anything the client sent in `subject_type` or the typed columns is
   * discarded. The client's value is a UI inference from (source, category);
   * a review row's identity must not depend on a caller deriving it correctly,
   * and a caller-supplied typed id would be a pointer the caller chose rather
   * than one the data supports.
   */
  NEW.subject_type := COALESCE(v_kind, 'unknown');
  NEW.trade_queue_item_id := NULL;
  NEW.decision_request_id := NULL;
  NEW.portfolio_trade_event_id := NULL;

  IF v_kind = 'idea' THEN
    NEW.trade_queue_item_id := NEW.decision_id::uuid;
  ELSIF v_kind = 'decision' THEN
    NEW.decision_request_id := NEW.decision_id::uuid;
  ELSIF v_kind = 'trade' THEN
    NEW.portfolio_trade_event_id := NEW.decision_id::uuid;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.decision_reviews_set_subject() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decision_reviews_set_subject() FROM anon;
REVOKE ALL ON FUNCTION public.decision_reviews_set_subject() FROM authenticated;

/*
 * Named to sort AFTER `decision_reviews_owner`, which is how Postgres orders
 * triggers of the same timing. Ownership is established first and can refuse
 * the insert outright; this only runs on a write that already passed.
 */
DROP TRIGGER IF EXISTS decision_reviews_subject ON public.decision_reviews;
CREATE TRIGGER decision_reviews_subject
  BEFORE INSERT OR UPDATE ON public.decision_reviews
  FOR EACH ROW EXECUTE FUNCTION public.decision_reviews_set_subject();

-- ── 5. Backfill ─────────────────────────────────────────────────────────────
--
-- Runs as the migration role, so RLS does not hide the six quarantined rows.
-- Expected on production as measured 2026-11-15: 2 rows -> 'idea' (both naming
-- a real `trade_queue_items` row), 6 rows -> 'unknown'. No row resolves to
-- more than one table, so nothing is ambiguous.
--
-- Written as a direct UPDATE rather than by firing the trigger, so the
-- backfill is visible in the diff instead of being a side effect, and so it
-- cannot be blocked by `decision_reviews_owner`'s immutability guard.
UPDATE public.decision_reviews r
   SET subject_type = COALESCE(public.decision_review_subject_type(r.decision_id), 'unknown'),
       trade_queue_item_id = CASE
         WHEN public.decision_review_subject_type(r.decision_id) = 'idea'
         THEN r.decision_id::uuid END,
       decision_request_id = CASE
         WHEN public.decision_review_subject_type(r.decision_id) = 'decision'
         THEN r.decision_id::uuid END,
       portfolio_trade_event_id = CASE
         WHEN public.decision_review_subject_type(r.decision_id) = 'trade'
         THEN r.decision_id::uuid END;

-- ── 6. Prove the backfill before committing ─────────────────────────────────
--
-- A migration that silently leaves rows unclassified is the failure mode this
-- whole change exists to remove, so it aborts rather than ships half-done.
DO $$
DECLARE
  v_bad int;
BEGIN
  -- Every row agrees with the resolver, EXCEPT a row whose subject has since
  -- been deleted: the trigger deliberately preserves the label it already
  -- carried, so such a row reads 'idea' (say) while the resolver now answers
  -- nothing. That shape is recognised by having no typed id at all.
  SELECT count(*) INTO v_bad
    FROM public.decision_reviews r
   WHERE r.subject_type <> COALESCE(public.decision_review_subject_type(r.decision_id), 'unknown')
     AND NOT (
       public.decision_review_subject_type(r.decision_id) IS NULL
       AND r.trade_queue_item_id IS NULL
       AND r.decision_request_id IS NULL
       AND r.portfolio_trade_event_id IS NULL
     );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'decision_reviews: % row(s) disagree with the resolver after backfill', v_bad;
  END IF;

  -- A typed pointer must always be labelled. The converse is NOT asserted:
  -- a labelled row with no pointer is the legitimate after-state of deleting
  -- the reviewed subject, which is the whole point of preserving the label.
  SELECT count(*) INTO v_bad
    FROM public.decision_reviews r
   WHERE r.subject_type = 'unknown'
     AND (
           r.trade_queue_item_id IS NOT NULL
           OR r.decision_request_id IS NOT NULL
           OR r.portfolio_trade_event_id IS NOT NULL
         );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'decision_reviews: % row(s) carry a typed id while labelled unknown', v_bad;
  END IF;
END $$;

COMMENT ON COLUMN public.decision_reviews.subject_type IS
  'What was reviewed: idea (trade_queue_items) | decision (decision_requests) | trade (portfolio_trade_events) | unknown (legacy row whose decision_id resolves to nothing). Derived server-side by decision_reviews_set_subject; a client-supplied value is discarded.';
COMMENT ON COLUMN public.decision_reviews.trade_queue_item_id IS
  'Typed edge to the reviewed idea. Set when subject_type = idea. NULL once the idea is deleted; subject_type and decision_id still record what was reviewed.';
COMMENT ON COLUMN public.decision_reviews.decision_request_id IS
  'Typed edge to the reviewed decision episode. Set when subject_type = decision.';
COMMENT ON COLUMN public.decision_reviews.portfolio_trade_event_id IS
  'Typed edge to the reviewed discretionary trade. Set when subject_type = trade.';

COMMIT;
