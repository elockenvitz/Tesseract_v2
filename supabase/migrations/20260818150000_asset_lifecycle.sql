/**
 * Ticker changes and delistings.
 *
 * A symbol was the de-facto identity of an asset, so an issuer rename broke
 * every downstream lookup silently. Square became Block and SQ became XYZ; the
 * row kept SQ, the position stayed held, and the price series simply ended.
 * `buildWeightSeries` then correctly skipped every day for that book — data
 * missing for a reason nobody had recorded anywhere.
 *
 * Measured 2026-08-18 across the 48 assets the classifier could not resolve:
 * 7 renamed (SQ→XYZ, BK→BNY, FI→FISV, MMC→MRSH, PEAK→DOC, SIX→FUN, ZI→GTM),
 * 34 delisted, 7 needing a human. Two of the renamed are HELD today.
 *
 * ── Why this is separate from asset_type ──────────────────────────────────
 *
 * `asset_type = 'unknown'` was answering two questions at once: WHAT is this,
 * and DOES IT STILL TRADE. A bond and a delisted equity are both "unknown" to
 * that column and nothing else in the schema could tell them apart. These
 * columns answer only the second question.
 *
 * `unresolved` is a first-class value, not an absence. It means the provider
 * was consulted and the answer was ambiguous — Zoom's search returns three
 * German venues before any US listing — and a person needs to decide. NULL
 * still means nobody has looked.
 *
 * ── current_symbol ────────────────────────────────────────────────────────
 *
 * The ticker the instrument trades under NOW, set equal to `symbol` unless it
 * genuinely moved. `symbol` is deliberately NOT overwritten: it is what the
 * holdings file said, and rewriting history to match the present would make
 * the old uploads unreconcilable. Price lookups use
 * `coalesce(current_symbol, symbol)`; provenance keeps `symbol`.
 *
 * Additive and nullable throughout. Nothing is dropped and no row is
 * classified by this migration.
 *
 * See docs/tickets/instrument-universe.md.
 */

BEGIN;

ALTER TABLE public.assets
  ADD COLUMN lifecycle_status text
    CHECK (lifecycle_status IN ('active','renamed','delisted','unresolved'));

ALTER TABLE public.assets ADD COLUMN current_symbol text;
ALTER TABLE public.assets ADD COLUMN lifecycle_checked_at timestamptz;
ALTER TABLE public.assets ADD COLUMN lifecycle_note text;

CREATE INDEX IF NOT EXISTS assets_lifecycle_status ON public.assets (lifecycle_status);
-- Price lookups resolve through this, so it is the hot path once renames land.
CREATE INDEX IF NOT EXISTS assets_current_symbol ON public.assets (upper(current_symbol));

COMMIT;

-- Verification (asserts negatives):
--   insert into public.assets (symbol, lifecycle_status) values ('__probe__','retired');
--   -- expect ERROR 23514: the CHECK rejects a status outside the four
--
--   select count(*) from public.assets where lifecycle_status is not null;
--   -- expect 0 immediately after applying: this migration classifies nothing
--
-- Restore path (discards lifecycle findings; touches nothing that predates it):
--   BEGIN;
--   DROP INDEX IF EXISTS public.assets_current_symbol;
--   DROP INDEX IF EXISTS public.assets_lifecycle_status;
--   ALTER TABLE public.assets
--     DROP COLUMN lifecycle_note, DROP COLUMN lifecycle_checked_at,
--     DROP COLUMN current_symbol, DROP COLUMN lifecycle_status;
--   COMMIT;
