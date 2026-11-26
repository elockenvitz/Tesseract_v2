/**
 * Writing a bar's timestamp and volume.
 *
 * The timezone case is the one that matters. These run under whatever zone
 * the machine is in, and the repository's CI machine is UTC -- where the bug
 * they guard is invisible. So the daily-bar case asserts the DATE ITSELF
 * rather than anything derived from the local zone, which is what makes it
 * fail in New York and Tokyo alike when the UTC formatting is removed.
 */
import { describe, it, expect } from 'vitest'
import { formatBarTime, formatVolume } from '../bar-format'

const bar = Math.floor(Date.UTC(2026, 10, 17, 14, 30) / 1000)

describe('the bar timestamp', () => {
  it('shows a date alone for a daily bar', () => {
    /* "00:00" beside a daily bar suggests the bar is a moment rather than a
       session, which is the wrong idea to give someone reading a high. */
    const s = formatBarTime(bar, '1d')
    expect(s).not.toMatch(/\d{1,2}:\d{2}/)
    expect(s).toMatch(/2026/)
  })

  it('adds a clock time for an intraday bar', () => {
    expect(formatBarTime(bar, '5m')).toMatch(/\d{1,2}:\d{2}/)
    expect(formatBarTime(bar, '1h')).toMatch(/\d{1,2}:\d{2}/)
  })

  it('treats weekly and monthly as sessions, not moments', () => {
    expect(formatBarTime(bar, '1wk')).not.toMatch(/\d{1,2}:\d{2}/)
    expect(formatBarTime(bar, '1mo')).not.toMatch(/\d{1,2}:\d{2}/)
  })

  /*
   * ── Why these pass a zone in explicitly ─────────────────────────────
   *
   * The bug is that a daily bar was rendered in the HOST's zone, which moves
   * a UTC-midnight timestamp back a day anywhere west of Greenwich. In UTC
   * the right code and the wrong code produce the same string, so a test
   * that reads the host zone proves nothing on a UTC machine -- and CI is a
   * UTC machine. Measured: with the fix removed, these go red under
   * America/New_York and Asia/Tokyo and stay GREEN under UTC.
   *
   * So the reader's zone is a parameter, and these name a zone. The daily
   * cases then fail on any host, including CI, if the daily path ever
   * follows the reader again.
   */
  const ZONES = ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']

  it('names a daily bar by its own calendar date, in every reader zone', () => {
    /*
     * The regression, measured in the live browser before the fix: in
     * America/New_York the bar dated 2026-11-09 came out as "Nov 8, 2026"
     * -- a Sunday, on which no US equity traded. Every daily bar was one
     * day early, in every timezone west of Greenwich.
     */
    const nov9 = Math.floor(Date.UTC(2026, 10, 9) / 1000)
    for (const zone of ZONES) {
      for (const unit of ['1d', '1wk', '1mo']) {
        const shown = formatBarTime(nov9, unit, zone)
        expect(shown, `${unit} in ${zone}`).toMatch(/\b9\b/)
        expect(shown, `${unit} in ${zone}`).toMatch(/Nov/)
      }
    }
  })

  it('does not move a bar at the far end of the year either', () => {
    /* New Year's Day is where a one-day shift also changes the YEAR, which
       is the most visible form of the same bug. */
    const jan1 = Math.floor(Date.UTC(2027, 0, 1) / 1000)
    for (const zone of ZONES) {
      expect(formatBarTime(jan1, '1d', zone), zone).toMatch(/2027/)
      expect(formatBarTime(jan1, '1d', zone), zone).toMatch(/Jan/)
    }
  })

  it('gives every reader zone the same daily label, because the bar is one date', () => {
    const nov9 = Math.floor(Date.UTC(2026, 10, 9) / 1000)
    const labels = new Set(ZONES.map(z => formatBarTime(nov9, '1d', z)))
    expect(labels.size, `got ${[...labels].join(' | ')}`).toBe(1)
  })

  it("leaves an intraday bar in the reader's own zone, because it is a moment", () => {
    /* The counterpart: a 5m bar at 14:30 UTC is a real instant, and forcing
       it to UTC would show a New York reader a time they did not trade at.
       14:30Z is 09:30 in New York -- the opening bell, which is exactly the
       bar an analyst would be looking at. */
    const t = Math.floor(Date.UTC(2026, 10, 9, 14, 30) / 1000)
    expect(formatBarTime(t, '5m', 'America/New_York')).toContain('09:30')
    expect(formatBarTime(t, '5m', 'UTC')).toContain('02:30')
    expect(formatBarTime(t, '5m', 'Asia/Tokyo')).toContain('11:30')
  })
})

describe('volume formatting', () => {
  it('scales to K, M and B', () => {
    expect(formatVolume(412)).toBe('412')
    expect(formatVolume(41_200)).toBe('41.2K')
    expect(formatVolume(41_200_000)).toBe('41.20M')
    expect(formatVolume(4_120_000_000)).toBe('4.12B')
  })

  it('refuses a figure that is not one', () => {
    expect(formatVolume(Number.NaN)).toBe('-')
    expect(formatVolume(-5)).toBe('-')
    expect(formatVolume(Number.POSITIVE_INFINITY)).toBe('-')
  })

  it('shows a plain count below a thousand', () => {
    expect(formatVolume(0)).toBe('0')
    expect(formatVolume(999)).toBe('999')
  })
})
