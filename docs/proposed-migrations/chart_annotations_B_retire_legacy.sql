-- ============================================================================
-- PROPOSED, NOT APPLIED.  Migration B of 2: retires the legacy rows.
--
-- What it changes
--   Marks the three pixel-anchored rows in public.chart_annotations as not
--   visible and records why, in style. Changes no geometry and deletes
--   nothing.
--
-- Can it fail on existing data?
--   No. It touches only rows where anchor_domain = 'pixel', which migration A
--   establishes, and it only sets is_visible and merges two keys into style.
--
-- Is it reversible?
--   Yes. The reverse is at the bottom of this file. Nothing is destroyed:
--   the rows, their coordinates and their feed links all remain.
--
-- What has to be true before it runs
--   * Migration A applied (this depends on anchor_domain and style).
--   * A recovery point captured BY HAND. This project has no automated
--     backup: backups: [] and pitr_enabled: false. This migration writes to
--     production rows, so unlike A there is a real -- if small -- loss
--     surface.
--   * The count below confirmed as 3, not more. If it is not 3, something
--     has written pixel rows since 2026-11-18 and this file's premise is
--     stale -- stop and re-measure.
--
-- ── Why mark rather than delete, and why not convert ────────────────────────
--
-- There is no sound conversion. Recovering a price from y=280.55 would need
-- the canvas height, price range and padding of the viewport that drew it in
-- January 2026, none of which was stored. Any number produced would be an
-- invented figure presented as an analyst's own mark -- precisely what the
-- provenance rule forbids. So the rows cannot be migrated; they can only be
-- retired or deleted.
--
-- Marking is preferred because the three rows are the only surviving evidence
-- of what the original writer did, including the feed_item links, and because
-- it is reversible. Deleting them is also defensible -- they are three
-- hand-inserted rows of no value -- but it is a destructive production write
-- and needs its own approval. The delete is at the very bottom, commented
-- out, deliberately not part of this transaction.
-- ============================================================================

begin;

-- Guard: refuse to run if the population is not what was measured.
-- A migration whose premise has drifted should stop, not proceed quietly.
do $$
declare
  n_pixel integer;
begin
  select count(*) into n_pixel
    from public.chart_annotations
   where anchor_domain = 'pixel';

  if n_pixel <> 3 then
    raise exception
      'Expected exactly 3 pixel-anchored rows (measured 2026-11-18), found %. Re-measure before retiring.',
      n_pixel;
  end if;
end $$;

update public.chart_annotations
   set is_visible = false,
       style = style || jsonb_build_object(
         'legacy_retired',  true,
         'legacy_reason',   'pixel anchors; the drawing viewport was never recorded, so no price or time is recoverable',
         'legacy_retired_at', now()
       )
 where anchor_domain = 'pixel';

commit;

-- ============================================================================
-- Verification after applying (read-only):
--
--   select anchor_domain, is_visible, style->>'legacy_retired' as retired,
--          count(*)
--     from public.chart_annotations
--    group by 1,2,3;
--
-- Expect one row: pixel, false, true, 3.
--
-- ── Reverse ────────────────────────────────────────────────────────────────
--
--   update public.chart_annotations
--      set is_visible = true,
--          style = style - 'legacy_retired' - 'legacy_reason' - 'legacy_retired_at'
--    where anchor_domain = 'pixel'
--      and style->>'legacy_retired' = 'true';
--
-- ── If you would rather they were gone ─────────────────────────────────────
--
-- NOT part of this migration. A separate, destructive, irreversible step
-- needing its own explicit approval and a hand-captured recovery point first:
--
--   delete from public.chart_annotations where anchor_domain = 'pixel';
--
-- Three rows, one user, inserted by hand on 2026-01-24, never readable by any
-- application code path. Nothing references them.
-- ============================================================================
