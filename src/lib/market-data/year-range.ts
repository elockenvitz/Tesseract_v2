/**
 * The trailing-year window, and the test for whether it may be NAMED one.
 *
 * ── Why this is a file of its own ─────────────────────────────────────────
 *
 * It lived in `daily-closes`, beside `fetchYearRange`, which is where it
 * belongs by subject. But `daily-closes` imports the Supabase client, and
 * `lib/supabase` throws at module load without an environment -- so every
 * module that wanted only the SHAPE and the TEST pulled a database client in
 * behind them.
 *
 * `ExploreVisual` is one such module, and the layout gallery renders it. The
 * gallery has no Supabase environment, so the import killed the page before
 * React mounted and every layout test waited out its full timeout against an
 * element that was never going to appear. `guard:gallery` names the link to
 * cut and says to cut the second from the bottom, not the bottom one: this
 * is that cut.
 *
 * Nothing here touches the network, so a renderer can read it freely.
 * `daily-closes` re-exports all three, so every existing caller is unchanged.
 */

/** A trailing-year extreme, with the window it was actually measured over. */
export interface YearRange {
  high: number
  low: number
  /** Oldest close that fed it. The claim is only as old as the data. */
  from: string
  /** Newest. `price_history_cache` is a cache and can be weeks stale. */
  to: string
  /** How many closes were behind it. */
  points: number
}

/** Calendar days in the trailing-year window. */
export const YEAR_DAYS = 365

/**
 * Whether a window may be called "52 week".
 *
 * `price_history_cache` is a CACHE. Queried on 2026-10-28, the deepest
 * symbol held 361 closes ending 2026-10-01 -- four weeks stale -- and most
 * symbols held well under a year. A high taken over eight months of closes
 * ending a month ago is a real number, but it is not the number the words
 * "52-week high" promise, and this codebase does not surface a figure that
 * cannot be traced to what produced it.
 *
 * So the mark is drawn only when the window genuinely covers it:
 *
 *   300 days of span   a year is about 252 sessions; 300 calendar days
 *                      leaves room for holidays and a short tail without
 *                      accepting a half-year
 *   180 points         a window with forty closes in it has gaps wide
 *                      enough to miss the extreme entirely
 *   45 days of lag     the cache may trail, but not by a quarter
 *
 * A card that fails any term draws the axis it drew before. Silence is the
 * correct output for a figure that cannot be stood behind.
 */
export function fitsTheLabel(y: YearRange, now: number = Date.now()): boolean {
  const from = Date.parse(y.from)
  const to = Date.parse(y.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false
  const DAY = 86_400_000
  return (to - from) / DAY >= 300
    && y.points >= 180
    && (now - to) / DAY <= 45
    && y.high > y.low
}
