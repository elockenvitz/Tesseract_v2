/**
 * How a bar's timestamp and volume are written for a reader.
 *
 * Here rather than beside the component that shows them because two callers
 * need `formatBarTime` -- the OHLC readout and the crosshair's own axis
 * label -- and because they must agree. When they did not, the readout said
 * "Nov 9, 2026" and the label beneath the same crosshair said
 * "Nov 3, 2026, 06:09 PM".
 */

/** Intervals whose bars are shorter than a day, and so need a clock time. */
const INTRADAY = new Set(['1m', '5m', '15m', '30m', '1h', '2h', '4h'])

/**
 * @param readerZone The zone an INTRADAY bar is shown in. Defaults to the
 *   host's own, which is what the app wants. It is a parameter only so the
 *   tests can pin it: the bug this function exists to fix is invisible in
 *   UTC, and CI runs in UTC, so a test that reads the host zone would pass
 *   on CI whether the code is right or wrong. See the daily-bar block below.
 */
export function formatBarTime(time: number, interval: string, readerZone?: string): string {
  const d = new Date(time * 1000)
  const intraday = INTRADAY.has(interval)

  /*
   * ── Why a daily bar is formatted in UTC ──────────────────────────────
   *
   * A daily, weekly or monthly bar's timestamp is a CALENDAR DATE that was
   * parsed to UTC midnight: `2026-11-09` becomes 2026-11-09T00:00:00Z. It
   * is not a moment in anyone's day; it names the session.
   *
   * Rendering it with the local zone therefore MOVES it. Measured in the
   * running app (America/New_York, UTC-5): the bar dated 2026-11-09 came
   * out as "Nov 8, 2026" -- a SUNDAY, on which no US equity traded. Every
   * daily bar was one day early, in every timezone west of Greenwich, which
   * is every timezone this product is used in.
   *
   * An intraday bar IS a moment, and belongs in the reader's own zone, so
   * the two are formatted differently on purpose.
   */
  const date = d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    // A daily bar is pinned to UTC because its timestamp IS a UTC calendar
    // date. An intraday bar follows the reader.
    timeZone: intraday ? readerZone : 'UTC',
  })

  /*
   * A clock time is shown only for a bar shorter than a day. Printing
   * "00:00" beside a daily bar would suggest the bar is a moment rather
   * than a session, which is the wrong idea to give someone reading a high
   * and a low.
   */
  if (!intraday) return date
  const clock = d.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', timeZone: readerZone,
  })
  return `${date} ${clock}`
}

/** Volume, shortened. A nine-digit share count is noise at readout size. */
export function formatVolume(volume: number): string {
  if (!Number.isFinite(volume) || volume < 0) return '-'
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`
  return String(Math.round(volume))
}
