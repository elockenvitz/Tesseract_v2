-- An idea that was decided must be allowed to say so.
--
-- ── The defect ──────────────────────────────────────────────────────────
--
-- `valid_outcome_in_deciding_only` reads:
--
--     CHECK ((outcome IS NULL) OR (stage = 'deciding'::trade_stage))
--
-- It predates the canonical stage vocabulary and pins terminality to the
-- LEGACY stage name. The application has since moved to
-- exploring → researching → developing → ready_to_recommend, and
-- `FINAL_STAGE` is `ready_to_recommend`. So every successful Approve &
-- Execute tries to write (stage='ready_to_recommend', outcome='executed')
-- and Postgres rejects the row.
--
-- The rejection is invisible where it matters. `moveTradeIdea` throws,
-- `resolveIdeaAfterDecision` catches it and returns `failed`, and the only
-- consumer logged that to a browser console. The committed trade, the
-- holdings move and both Memory events all land correctly, so the
-- transaction looks like a full success while the idea stays
-- `status=deciding, outcome=NULL` forever — and therefore never leaves the
-- active pipeline.
--
-- Production evidence: of 237 `trade_queue_items`, the 21 that carry an
-- outcome are ALL at `stage='deciding'` and NONE at `ready_to_recommend`.
-- No idea on the current stage vocabulary has ever become terminal.
-- Observed twice: SHOP 2026-10-04 16:08Z, GOOGL 2026-10-05 14:45Z.
--
-- ── What this changes ───────────────────────────────────────────────────
--
-- The constraint's INTENT is kept: an outcome may only be recorded against
-- a mature idea. What changes is that maturity is now spelled in both
-- vocabularies, because the table holds rows in both and will until the
-- idea_pipeline_contract work lands.
--
-- It is deliberately NOT dropped outright. The rule it encodes is real —
-- a decision on an idea nobody developed is a data error — and removing it
-- would silently permit that. Widening is the smaller change.
--
-- Verified read-only before writing: all 237 existing rows satisfy the new
-- predicate, so this validates without a rewrite failure and needs no
-- backfill.
--
-- `stage` is untouched. Terminality is outcome-based; `ready_to_recommend`
-- stays the last maturity value, which is what `decision-fan-in` and
-- `stage-model.test.ts` both require.

ALTER TABLE public.trade_queue_items
  DROP CONSTRAINT IF EXISTS valid_outcome_in_deciding_only;

ALTER TABLE public.trade_queue_items
  ADD CONSTRAINT valid_outcome_at_final_stage
  CHECK (
    outcome IS NULL
    -- Canonical vocabulary: `FINAL_STAGE` in src/lib/ideas/stage-model.ts.
    OR stage = 'ready_to_recommend'::trade_stage
    -- Legacy vocabulary, for the 21 rows already decided under it.
    OR stage = 'deciding'::trade_stage
  );

COMMENT ON CONSTRAINT valid_outcome_at_final_stage ON public.trade_queue_items IS
  'An outcome may only be recorded against a mature idea. Accepts both the '
  'canonical final stage (ready_to_recommend) and the legacy one (deciding), '
  'because the table holds rows in both vocabularies. Replaced '
  'valid_outcome_in_deciding_only, which accepted only the legacy name and so '
  'made every Approve & Execute fail to conclude its idea.';
