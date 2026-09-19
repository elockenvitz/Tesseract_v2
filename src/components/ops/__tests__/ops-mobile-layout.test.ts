/**
 * The Operations Portal fits a 390px screen.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The portal is its own shell (`/ops/*`, outside the product's mobile
 * shell), and nothing in it had a phone form:
 *
 *  - the sidebar was a fixed 12rem column beside `main`, so a 390px screen
 *    left every page 198px wide;
 *  - `h-screen` is 100vh, taller than a phone's visible area, so the bottom of
 *    each page sat under the URL bar;
 *  - tile rows were bare `grid-cols-4` / `grid-cols-5`, and the AI Usage
 *    sections used `col-span-2` inside what becomes one column on a phone —
 *    which adds an implicit second track and widens the page;
 *  - wide tables (8-, 9-column) sat inside `overflow-hidden` cards, so the
 *    columns that did not fit were clipped out of reach, not scrollable;
 *  - member, invite and morph rows put a fixed-width reason field and their
 *    actions beside the name, crushing it;
 *  - the scenario dialog was a centred `max-w-xl` box.
 *
 * These are structural rules checked against source, the same way the
 * neighbouring mobile tests read source: the claim is about which classes a
 * phone gets. Each checker is also run against a deliberately broken snippet,
 * so a rule that stopped matching anything would fail here rather than pass
 * silently.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const root = process.cwd()
// Comments explain what was wrong and name the old classes; only code counts.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p: string) => stripComments(readFileSync(path.join(root, p), 'utf8'))

const pageDir = 'src/pages/ops'
const pages = readdirSync(path.join(root, pageDir))
  .filter(f => f.endsWith('.tsx'))
  .map(f => ({ file: `${pageDir}/${f}`, src: read(`${pageDir}/${f}`) }))

// ── Checkers ────────────────────────────────────────────────────────────

/** Class tokens that are not behind a breakpoint prefix. */
function bareTokens(src: string, token: RegExp): string[] {
  const hits: string[] = []
  const re = new RegExp(`(?<![\\w:-])(${token.source})(?![\\w-])`, 'g')
  for (const m of src.matchAll(re)) hits.push(m[1])
  return hits
}

/** Multi-column grids with no phone fallback. */
const unguardedGrids = (src: string) => bareTokens(src, /grid-cols-[3-9]/)

/** `col-span-2` applied at every width. */
const bareColSpans = (src: string) => bareTokens(src, /col-span-[2-9]/)

/** Fixed-width inline fields that crowd a phone row. */
const fixedFieldWidths = (src: string) => bareTokens(src, /w-(32|36|40|44|48)/)

/**
 * A table must either be desktop-only with a phone list beside it, or sit in
 * a `mobile-scroll-x` container that scrolls on its own.
 */
function unguardedTables(src: string): number[] {
  const bad: number[] = []
  for (const m of src.matchAll(/<table\b[^>]*className="([^"]*)"/g)) {
    const at = m.index ?? 0
    const cls = m[1]
    const before = src.slice(Math.max(0, at - 6000), at)
    const desktopOnlyWithList = /(^|\s)hidden(\s|$)/.test(cls) && cls.includes('md:table') && before.includes('md:hidden')
    const scrolls = src.slice(Math.max(0, at - 250), at).includes('mobile-scroll-x')
    if (!desktopOnlyWithList && !scrolls) bad.push(at)
  }
  return bad
}

// ── The checkers catch what they are for ────────────────────────────────

describe('the layout checkers are not vacuous', () => {
  it('flags a bare four-column grid and passes a responsive one', () => {
    expect(unguardedGrids('<div className="grid grid-cols-4 gap-3">')).toEqual(['grid-cols-4'])
    expect(unguardedGrids('<div className="grid grid-cols-2 md:grid-cols-4 gap-3">')).toEqual([])
  })

  it('flags a bare col-span-2 and passes md:col-span-2', () => {
    expect(bareColSpans('<div className="col-span-2 bg-white">')).toEqual(['col-span-2'])
    expect(bareColSpans('<div className="md:col-span-2 bg-white">')).toEqual([])
  })

  it('flags a fixed-width field and passes one scoped to desktop', () => {
    expect(fixedFieldWidths('<input className="w-36 px-2" />')).toEqual(['w-36'])
    expect(fixedFieldWidths('<input className="flex-1 md:w-36 px-2" />')).toEqual([])
  })

  it('flags a bare table, and passes a scroller or a desktop table with a phone list', () => {
    expect(unguardedTables('<div className="overflow-hidden"><table className="w-full text-sm">')).toHaveLength(1)
    expect(unguardedTables('<div className="mobile-scroll-x"><table className="w-full text-sm">')).toHaveLength(0)
    expect(unguardedTables('<ul className="md:hidden"></ul><table className="hidden md:table w-full">')).toHaveLength(0)
    // desktop-only with no phone list is data that vanished, not a fix
    expect(unguardedTables('<table className="hidden md:table w-full">')).toHaveLength(1)
  })
})

// ── The portal ──────────────────────────────────────────────────────────

describe('the shell gives a phone the whole width', () => {
  const layout = read('src/components/ops/OpsLayout.tsx')
  const sidebar = read('src/components/ops/OpsSidebar.tsx')

  it('stacks the nav above the page on a phone and sits them side by side on desktop', () => {
    expect(layout).toContain('flex flex-col md:flex-row')
  })

  it('sizes to the visible viewport, not 100vh', () => {
    expect(layout).toContain('h-viewport')
    expect(layout).not.toMatch(/(?<![\w:-])h-screen(?![\w-])/)
  })

  it('lets main shrink and scroll on its own', () => {
    expect(layout).toMatch(/<main className="[^"]*min-h-0[^"]*min-w-0[^"]*overflow-y-auto/)
  })

  it('makes the sidebar a scrolling strip on a phone and the 12rem column on desktop', () => {
    expect(sidebar).toContain('overflow-x-auto')
    expect(sidebar).toContain('md:w-48')
    expect(bareTokens(sidebar, /w-48/)).toEqual([])
    expect(sidebar).toContain('shrink-0 whitespace-nowrap')
  })
})

describe('every Ops page reflows at 390px', () => {
  for (const { file, src } of pages) {
    describe(file, () => {
      it('has no multi-column grid without a phone fallback', () => {
        expect(unguardedGrids(src)).toEqual([])
      })
      it('has no col-span that widens a one-column phone grid', () => {
        expect(bareColSpans(src)).toEqual([])
      })
      it('has no fixed-width field crowding a phone row', () => {
        expect(fixedFieldWidths(src)).toEqual([])
      })
      it('has no table that can be clipped out of reach', () => {
        expect(unguardedTables(src)).toEqual([])
      })
      it('uses phone padding with desktop padding restored', () => {
        expect(src).not.toMatch(/className="[^"]*(?<![\w:-])p-6(?![\w-])[^"]*(max-w|mx-auto)/)
      })
    })
  }
})

describe('wide lists become phone cards with their data and actions intact', () => {
  const dashboard = read(`${pageDir}/OpsDashboardPage.tsx`)
  const holdings = read(`${pageDir}/OpsHoldingsPage.tsx`)

  it('client health keeps every column and still opens the client', () => {
    const list = dashboard.slice(dashboard.indexOf('<ul className="md:hidden'), dashboard.indexOf('<table className="hidden md:table'))
    for (const field of ['client.org.name', 'client.totalMembers', 'client.openBugReports', 'client.lastLoginAt', 'EngagementDot', 'HealthPill', 'ProgressBar']) {
      expect(list).toContain(field)
    }
    expect(list).toContain('navigate(`/ops/clients/${client.org.id}`)')
  })

  it('holdings overview keeps Configure on the same path as the desktop row', () => {
    const list = holdings.slice(holdings.indexOf('<ul className="md:hidden'), holdings.indexOf('<table className="hidden md:table'))
    expect(list).toContain("setSelectedOrgId(client.org.id); setView('client-detail')")
    for (const field of ['client.totalPortfolios', 'client.totalPositions', 'client.latestDate', 'client.integrationTypes']) {
      expect(list).toContain(field)
    }
  })
})

describe('the scenario dialog is a phone sheet', () => {
  const panel = read(`${pageDir}/OpsPilotPanel.tsx`)
  const form = panel.slice(panel.indexOf('function ScenarioCreateForm'))

  it('is full height on a phone and the centred dialog on desktop', () => {
    expect(form).toContain('w-full h-full rounded-none md:h-auto md:max-w-xl md:rounded-xl md:max-h-viewport-90')
    expect(bareTokens(form, /max-w-xl/)).toEqual([])
  })

  it('scrolls the body alone, so the Stage action stays on screen', () => {
    expect(form).toContain('flex-1 min-h-0 px-4 md:px-5 py-4 space-y-3 overflow-y-auto')
    expect(form).toMatch(/flex-shrink-0 px-4 md:px-5 pt-3 pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/)
  })
})

describe('rows with actions stack on a phone', () => {
  const detail = read(`${pageDir}/OpsClientDetailPage.tsx`)
  const support = read(`${pageDir}/OpsSupportPage.tsx`)

  it('client tabs scroll sideways instead of overflowing', () => {
    expect(detail).toContain('overflow-x-auto no-scrollbar md:overflow-visible')
  })

  it('member and invite rows drop their actions under the name', () => {
    const stacked = detail.match(/flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-between/g) ?? []
    expect(stacked.length).toBeGreaterThanOrEqual(2)
  })

  it('morph search rows do the same', () => {
    expect(support).toContain('flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-between')
  })
})
