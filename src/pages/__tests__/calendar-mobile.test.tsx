/**
 * Calendar on a phone: what the date label promises, and where Save is.
 *
 * ── The defects this pins ─────────────────────────────────────────────────
 *
 * 1. THE HEADING NAMED A MONTH OVER A THIRTY-DAY WINDOW.
 *    Agenda is the default view on a phone. Its range is
 *    `[startOfDay(currentDate), currentDate + 30 days]` — rolling, anchored on
 *    whatever day you are on — and the heading printed `MMMM yyyy`. So on
 *    7 September it read "September 2026" above a list running to 7 October,
 *    and tapping next read "October 2026" above 7 October to 6 November. On a
 *    phone that heading is the only date label there is.
 *
 * 2. SAVE LIVED AT THE BOTTOM OF A SCROLL, INSIDE ANOTHER SCROLL.
 *    The event panel was `overflow-y-auto` AND contained a body capped at
 *    60dvh that also scrolled. Two scrollers for one form: the inner ran out
 *    while the outer still had somewhere to go, so the footer carrying Cancel
 *    and Save could sit below the panel's visible edge. With a keyboard open on
 *    a phone that is the one control the flow cannot be completed without.
 *
 * ── Why the range is computed and the panel read ──────────────────────────
 *
 * Mounting CalendarPage means Supabase, react-query, six event sources and a
 * modal. The heading claim is arithmetic over dates, so it is computed here
 * against the same date library the page uses. The panel claim is structural,
 * so it is asserted against the source.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'

const page = readFileSync(resolve(__dirname, '../CalendarPage.tsx'), 'utf8')

type ViewMode = 'month' | 'week' | 'agenda'

/** The page's own range rule, reproduced. */
function rangeFor(view: ViewMode, currentDate: Date) {
  if (view === 'month') {
    return {
      start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }),
    }
  }
  if (view === 'week') {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 0 }),
      end: endOfWeek(currentDate, { weekStartsOn: 0 }),
    }
  }
  return { start: startOfDay(currentDate), end: addDays(currentDate, 30) }
}

/** The heading rule, as it now stands. */
function headingFor(view: ViewMode, currentDate: Date) {
  const r = rangeFor(view, currentDate)
  return view === 'month'
    ? format(currentDate, 'MMMM yyyy')
    : `${format(r.start, 'MMM d')} - ${format(r.end, 'MMM d, yyyy')}`
}

const SEP_7 = new Date(2026, 8, 7)

describe('the date heading names the window on screen', () => {
  it('describes the agenda as the range it actually shows', () => {
    expect(headingFor('agenda', SEP_7)).toBe('Sep 7 - Oct 7, 2026')
  })

  it('no longer claims a calendar month for a rolling thirty days', () => {
    // The old label. It named a month whose first six days were not in the list.
    expect(headingFor('agenda', SEP_7)).not.toBe('September 2026')
  })

  it('stays honest after paging forward', () => {
    expect(headingFor('agenda', addMonths(SEP_7, 1))).toBe('Oct 7 - Nov 6, 2026')
  })

  it('always names a range whose ends match the query', () => {
    for (const d of [SEP_7, addMonths(SEP_7, 1), addMonths(SEP_7, 5)]) {
      const r = rangeFor('agenda', d)
      const heading = headingFor('agenda', d)

      expect(heading).toContain(format(r.start, 'MMM d'))
      expect(heading).toContain(format(r.end, 'MMM d'))
    }
  })

  it('leaves week exactly as it read before', () => {
    const r = rangeFor('week', SEP_7)
    expect(headingFor('week', SEP_7))
      .toBe(`${format(r.start, 'MMM d')} - ${format(r.end, 'MMM d, yyyy')}`)
  })

  it('leaves the desktop month heading as a month, which is what it shows', () => {
    // A month grid really is a calendar month, so naming it one is right.
    expect(headingFor('month', SEP_7)).toBe('September 2026')
  })

  it('is applied by the page, not just by this file', () => {
    // Whitespace-insensitive: the file is stored with CRLF endings.
    const flat = page.replace(/\s+/g, ' ')
    expect(flat).toContain("{viewMode === 'month' ? format(currentDate, 'MMMM yyyy')")
    expect(flat).not.toContain("{viewMode === 'week' ? `${format(dateRange.start, 'MMM d')}")
  })
})

describe('the phone opens on the agenda, not on a grid', () => {
  it('defaults to agenda at phone width', () => {
    expect(page).toContain("useState<ViewMode>(isMobileViewport ? 'agenda' : 'month')")
  })

  it('reads the viewport synchronously, so the first paint is already right', () => {
    const hook = readFileSync(resolve(__dirname, '../../hooks/useMediaQuery.ts'), 'utf8')

    // A hook that started false and corrected itself in an effect would leave
    // the initialiser — which runs once — choosing the month grid on a phone.
    expect(hook).toContain('return window.matchMedia(query).matches')
  })
})

describe('the event form keeps Save reachable', () => {
  const panelAt = page.indexOf('className="relative flex flex-col w-full max-w-xl')
  const panel = page.slice(panelAt, page.indexOf('{/* Footer.', panelAt))

  it('makes the panel a column rather than one scrolling box', () => {
    expect(panelAt).toBeGreaterThan(0)
    expect(panel).toContain('flex flex-col')
    expect(panel).not.toContain('max-h-viewport-90 sm:max-h-none overflow-y-auto')
  })

  it('holds the header at its height', () => {
    expect(panel).toContain('flex-shrink-0 flex items-center justify-between px-3 sm:px-6 py-4 border-b')
  })

  it('gives the body what is left rather than a second cap', () => {
    expect(panel).toContain('flex-1 min-h-0 px-3 sm:px-6 py-5 space-y-6 overflow-y-scroll')
    // The inner cap was the other half of the nesting.
    expect(panel).not.toContain('max-h-viewport-60')
  })

  it('holds the footer, which carries Save', () => {
    const footerAt = page.indexOf('{/* Footer.')
    const footer = page.slice(footerAt, footerAt + 400)

    expect(footer).toContain('flex-shrink-0')
  })

  it('still sizes against the visible viewport on a phone', () => {
    expect(panel).toContain('max-h-viewport-90')
    expect(panel).toContain('pb-safe')
  })

  it('is a sheet on a phone and a dialog on desktop, as before', () => {
    expect(panel).toContain('rounded-t-2xl sm:rounded-2xl')
  })
})

describe('no viewport or width regressions', () => {
  it('adds no bare vh sizing', () => {
    expect(page).not.toMatch(/\b(?:max-|min-)?h-\[\d+vh\]/)
  })

  it('assumes no desktop width', () => {
    // Anything at or past 300px cannot fit a 320px screen once padding is
    // taken. The form's `w-[120px]` time input and `w-36` are well inside it
    // and are left alone.
    const wide = [...page.matchAll(/w-\[(\d+)px\]/g)].filter(m => Number(m[1]) >= 300)
    expect(wide.map(m => m[0])).toEqual([])
  })
})
