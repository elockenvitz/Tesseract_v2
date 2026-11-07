/**
 * Symbols the freshness check knows it cannot price, with the reason.
 *
 * ── Why an exception list and not a looser threshold ─────────────────────
 *
 * An alert that is red on the day it ships gets muted, and a muted alert is
 * worse than none: it looks like coverage. One held name cannot be priced
 * today for a reason that has nothing to do with the pipeline, so either the
 * threshold gets widened until it stops catching real outages, or the one
 * name is named. Naming it is the honest option, and it keeps the threshold
 * at the value the application actually acts on.
 *
 * ── Why each entry has to justify itself ─────────────────────────────────
 *
 * The check PRINTS every exception it applied, and fails if an exception is
 * no longer needed. That is deliberate: a list of suppressions that nobody
 * revisits is how a real gap hides. An entry that has started passing is a
 * finished piece of work, and the check says so rather than carrying it
 * silently forever.
 *
 * `fixBy` is not enforced as a deadline -- it is the date someone said they
 * would deal with it, printed beside the entry so it is visible every run.
 */

export const UNPRICEABLE_SYMBOLS = [
  {
    /*
     * AvalonBay was delisted around 2026-08-14. YCharts carries it as
     * `AVB:DL` with a final price of 184.06 on that date and nothing after.
     * The provider serves that one bar and no more, so no feed will ever
     * make this name current again.
     *
     * The real fix is `assets.lifecycle_status = 'delisted'`, which would
     * take it out of the held universe for the ingestion AND for this check
     * in one step -- `heldSymbols()` already excludes delisted names. That is
     * a production data change and is not in this PR's scope.
     *
     * Its stored series is separately wrong: 256 rows from 2025-08-18 to
     * 2026-08-24 at roughly $63-68, which is not a plausible AvalonBay price
     * against a 52-week range of $160-216, with one correct 184.06 row in the
     * middle of it. Marking it delisted does not clean that up.
     */
    symbol: 'AVB',
    reason: 'delisted around 2026-08-14; no provider will price it again',
    recordedOn: '2026-11-07',
    fixBy: 'set assets.lifecycle_status = delisted',
  },
]

/** The set form, for a membership test. */
export const unpriceableSet = () => new Set(UNPRICEABLE_SYMBOLS.map((e) => e.symbol.toUpperCase()))
