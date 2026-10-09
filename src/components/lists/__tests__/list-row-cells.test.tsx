/**
 * The collapsed list row: six conceptual columns, and the cells in them.
 *
 * Four things here are easy to regress and all four would be invisible in review:
 *
 *   1. The line is SIX conceptual groups — security, market, exposure, view,
 *      valuation, work — not ten scalar columns. A row of equally-weighted
 *      single-field columns is a database grid, which is the thing this surface
 *      was rejected for being.
 *
 *   2. The preset HIDES, it does not delete. A user who turns Processes or Price
 *      back on must keep it, and a caller-supplied or AI column must survive a
 *      reorder it was never named in. Asserting only "priority is not visible"
 *      would pass against a preset that dropped it from the picker entirely.
 *
 *   3. The cells render NOTHING when they know nothing. A column of "—" makes a
 *      thin list look broken, and the happy path alone cannot tell the
 *      difference.
 *
 *   4. The sparkline's box exists before its data does. Every other assertion
 *      can pass while the table still visibly reflows on first paint, because a
 *      reflow is a layout event and not a DOM difference — so the geometry is
 *      asserted on the ELEMENT's own style, which is the only part a test can
 *      see in jsdom.
 *
 * `renderSignalCell` returns `undefined` for ids it does not own — distinct
 * from `null`, which means "mine, and empty". `ListTableView` depends on that
 * difference to fall through to the list-scoped cells, so it is asserted.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  LIST_SIGNAL_COLUMNS, renderSignalCell, listSortComparators, SPARK_HEIGHT,
} from '../ListRowCells'
import { presetFor } from '../listViewPresets'

/*
 * These assertions are about the DEFAULT line, which is Monitor's. The
 * five-zone preset they were written against has been replaced by one preset
 * per view; `presetFor('monitor')` is the same column order under a new name,
 * so the expectations below are unchanged.
 */
const listColumnPreset = presetFor('monitor')
import { DEFAULT_COLUMNS } from '../../table/AssetTableView'
import type { ListRowSignal } from '../../../hooks/lists/useListRowSignals'

const col = (id: string, visible = true) => ({
  id, label: id, visible, width: 100, minWidth: 50,
  sortable: false, pinned: false, category: 'core' as const,
})

/** A realistic slice of the table's own column set, plus the list's. */
const base = () => [
  col('select'), col('ticker'), col('companyName'),
  col('priority'), col('workflows'), col('updated'),
  col('price'), col('change'), col('coverage'),
  col('rating', false), col('thesis', false),
  ...LIST_SIGNAL_COLUMNS.map(c => ({ ...c })),
  col('list_assignee'), col('list_status'), col('list_tags'),
  { ...col('ai_custom_1'), isCustomAI: true } as any,
]

const empty: ListRowSignal = {
  state: null, subject: null, weightPct: null, closes: null,
  bookName: null, bookCount: 0,
  ratingValue: null, ratingColor: null, conviction: null, targetPrice: null,
  work: { tier: 'clear', label: '', count: 0, secondary: null },
  idea: null,
}

/** A signal whose Work column says one thing. */
const work = (over: Partial<ListRowSignal['work']>): ListRowSignal => ({
  ...empty,
  work: { tier: 'clear', label: '', count: 0, secondary: null, ...over },
})

const idsOf = (cols: Array<{ id: string }>) => cols.map(c => c.id)
const visibleIdsOf = (cols: Array<{ id: string; visible: boolean }>) =>
  cols.filter(c => c.visible).map(c => c.id)

describe('the line is six conceptual columns', () => {
  it('reads security, market, investment view, position, work', () => {
    const order = visibleIdsOf(listColumnPreset(base()))
    expect(order).toEqual([
      // No `companyName`: it moves INTO the ticker cell as a second line, so
      // identity is one column rather than two of equal weight.
      'select', 'ticker',
      /* The market is four columns, not one composed cell: each figure on
         its own axis, each independently sortable. `list_market` survives
         hidden for anyone who preferred the composed version. */
      'list_last',
      'list_1m',
      'list_6m',
      'list_trend',
      'list_view',
      'list_exposure',
      'list_work',
      // Unranked and visible, so it lands after the curated run rather than
      // disappearing. See "keeps a column it was never told about".
      'ai_custom_1',
    ])
  })

  it('folds the target into Investment View rather than giving it a column', () => {
    /*
     * A rating is what we think and a target is the same thought priced. Split
     * across two headings a reader has to join them; together they are one
     * sentence. Valuation survives as a MODE reached by clicking the target.
     */
    const out = listColumnPreset(base())
    expect(visibleIdsOf(out)).not.toContain('list_valuation')
    expect(idsOf(out)).toContain('list_valuation')
  })

  it('shows no scalar price or change column — MARKET composes them', () => {
    const out = listColumnPreset(base())
    for (const id of ['price', 'change']) {
      expect(visibleIdsOf(out), `${id} must not be on the default line`).not.toContain(id)
      // Still in the picker: a reader who wants the scalar back can have it.
      expect(idsOf(out), `${id} must survive in the picker`).toContain(id)
    }
  })

  it('keeps coverage available but off the prime line', () => {
    // Empty for almost every name in practice, and a column of em-dashes is the
    // clearest possible signal that a table is a database grid.
    const out = listColumnPreset(base())
    expect(visibleIdsOf(out)).not.toContain('coverage')
    expect(idsOf(out)).toContain('coverage')
  })

  it('has a floor narrow enough for a laptop pane', () => {
    /*
     * Measured against the REAL `DEFAULT_COLUMNS`, not the fixture above: a
     * width budget checked against invented widths measures the invention.
     *
     * This total is the FLOOR — what the line collapses to when there is no
     * slack. Anything wider is handled by `grow`, so this number only decides
     * whether a 1280px laptop scrolls.
     *
     * The bound moved from 1000 to 1240 when MARKET became four columns.
     * That is not the gate going soft: nine columns have eight gutters and
     * four of them hold a figure that cannot be narrower than its digits.
     * 1240 is what actually matters — it is the budget that fits a 1280px
     * pane without horizontal scroll.
     */
    const width = listColumnPreset([...DEFAULT_COLUMNS, ...LIST_SIGNAL_COLUMNS])
      .filter(c => c.visible)
      .reduce((sum, c) => sum + c.width, 0)
    expect(width).toBeLessThan(1240)
  })

  it('spends a wide pane on identity, the reason for attention, and the chart', () => {
    // Without growth the table owned roughly half a 1600px screen and the rest
    // was blank, which is what made it read as a sparse spreadsheet.
    const out = listColumnPreset([...DEFAULT_COLUMNS, ...LIST_SIGNAL_COLUMNS])
    const grow = (id: string) => out.find(c => c.id === id)?.grow ?? 0
    expect(grow('ticker')).toBeGreaterThan(0)
    expect(grow('list_work')).toBeGreaterThan(0)
    // Market takes slack because it holds the sparkline, whose width IS part of
    // its value — but less than the two columns carrying words.
    expect(grow('list_market')).toBeGreaterThan(0)
    expect(grow('list_market')).toBeLessThan(grow('list_work'))
    /*
     * Scoped to the columns Monitor actually SHOWS.
     *
     * It used to iterate every entry in `LIST_SIGNAL_COLUMNS`, which was the
     * same set while there was one preset. Research and Decide have since
     * added their own columns to that list, and a column Monitor hides owes
     * Monitor's line no slack — asserting otherwise would force a grow weight
     * on a column that is not on screen.
     */
    const onMonitor = out.filter(c => c.visible && c.id.startsWith('list_'))
    expect(onMonitor.length).toBeGreaterThan(2)
    for (const c of onMonitor) {
      expect(grow(c.id), `${c.id} should take some slack`).toBeGreaterThan(0)
    }
  })

  it('left-aligns every conceptual column, because each leads with a label-less figure', () => {
    /*
     * The old line right-aligned a numeric band so decimals lined up. A
     * conceptual cell is a figure stacked over a qualifier, and right-aligning
     * that pushes the qualifier away from the figure it describes — the two
     * stop reading as one object.
     */
    const out = listColumnPreset([...DEFAULT_COLUMNS, ...LIST_SIGNAL_COLUMNS])
    for (const c of LIST_SIGNAL_COLUMNS) {
      expect(out.find(x => x.id === c.id)?.align, `${c.id} must stay left`).not.toBe('right')
    }
  })

  it('leaves the shared table defaults untouched', () => {
    // The preset only changes columns for THIS surface, which is the whole
    // reason width/align/grow are per-column rather than a global style.
    expect(DEFAULT_COLUMNS.find(c => c.id === 'price')?.align).toBeUndefined()
    expect(DEFAULT_COLUMNS.find(c => c.id === 'price')?.visible).toBe(true)
  })

  it('drops the list process column from the default line', () => {
    // Real, but it answers a question about this list rather than about the
    // security — and Overview shows it.
    const out = listColumnPreset(base())
    expect(visibleIdsOf(out)).not.toContain('list_status')
    expect(idsOf(out)).toContain('list_status')
  })

  it('drops My Priority and Processes from the default line', () => {
    const visible = visibleIdsOf(listColumnPreset(base()))
    expect(visible).not.toContain('priority')
    expect(visible).not.toContain('workflows')
  })

  it('de-emphasises last-updated, assignee and tags without removing them', () => {
    const out = listColumnPreset(base())
    for (const id of ['updated', 'list_assignee', 'list_tags']) {
      expect(visibleIdsOf(out)).not.toContain(id)
      expect(idsOf(out)).toContain(id)
    }
  })

  it('loses no column at all — hiding is not deleting', () => {
    const input = base()
    const out = listColumnPreset(input)
    expect(idsOf(out).sort()).toEqual(idsOf(input).sort())
  })

  it('keeps a column it was never told about', () => {
    const out = listColumnPreset(base())
    expect(idsOf(out)).toContain('ai_custom_1')
    expect(out.find(c => c.id === 'ai_custom_1')!.visible).toBe(true)
  })

  it('does not mutate the array it was given', () => {
    const input = base()
    const before = idsOf(input)
    listColumnPreset(input)
    expect(idsOf(input)).toEqual(before)
    expect(input.find(c => c.id === 'priority')!.visible).toBe(true)
  })

  it('is stable for columns outside the order', () => {
    const out = idsOf(listColumnPreset(base()))
    expect(out.indexOf('rating')).toBeLessThan(out.indexOf('thesis'))
  })
})

describe('the conceptual columns can be ordered', () => {
  /*
   * These exist because a watchlist whose columns cannot be sorted is a report.
   * The table's own sort can only reach fields on the asset, so without these
   * the reader could see which securities need attention but not bring them
   * together — which on a fifty-name list is the difference between the column
   * being useful and being decoration.
   *
   * Each conceptual column sorts by the figure it LEADS with, which is the one
   * the reader is pointing at when they click the heading.
   */
  const sig = (over: Partial<ListRowSignal>): ListRowSignal => ({ ...empty, ...over })

  /** Sort descending, the way the table does on a first header click. */
  const descend = (columnId: string, rows: Record<string, ListRowSignal>) => {
    const cmp = listSortComparators(id => rows[id as string] ?? empty)[columnId]
    return Object.keys(rows).sort((a, b) => cmp({ id: b }, { id: a }))
  }

  it('ranks investment work above research hygiene', () => {
    /*
     * The order a desk cares about, not the order the research scan produces.
     * A name awaiting a decision outranks one with unread notes, which outranks
     * a review clock, which outranks a filing gap. This is the ordering that
     * was wrong: a live BUY at the final stage used to sort below "Thin
     * evidence" because only research state was consulted.
     */
    const order = descend('list_work', {
      nothing: empty,
      current: work({ tier: 'clear', label: 'Current' }),
      gap: work({ tier: 'gap', label: 'Thin evidence' }),
      stale: work({ tier: 'review', label: 'Review due' }),
      unread: work({ tier: 'evidence', label: 'New research', count: 1 }),
      idea: work({ tier: 'idea', label: 'BUY · Researching' }),
      decision: work({ tier: 'decision', label: 'BUY · Recommendation ready' }),
    })
    expect(order.slice(0, 5)).toEqual(['decision', 'idea', 'unread', 'stale', 'gap'])
    expect(order.slice(5).sort()).toEqual(['current', 'nothing'])
  })

  it('breaks a Work tie on how much is unread', () => {
    const order = descend('list_work', {
      one: { ...work({ tier: 'evidence', label: 'New research', count: 1 }), subject: { newSinceReview: 1 } as any },
      five: { ...work({ tier: 'evidence', label: 'New research', count: 5 }), subject: { newSinceReview: 5 } as any },
    })
    expect(order).toEqual(['five', 'one'])
  })

  it('orders Exposure by weight and sinks the unheld', () => {
    const order = descend('list_exposure', {
      small: sig({ weightPct: 0.4 }),
      unheld: empty,
      big: sig({ weightPct: 6.1 }),
    })
    // "Sort by Exposure" means show me what we own — an absent weight must not
    // float to the top of a descending sort.
    expect(order).toEqual(['big', 'small', 'unheld'])
  })

  it('orders Market by the move, not by the closing price', () => {
    const order = descend('list_market', {
      up: sig({ closes: [100, 110] }),       // +10%
      down: sig({ closes: [400, 380] }),     // -5%, but a far higher price
      flat: sig({ closes: [50, 50] }),       // 0%
      none: empty,
    })
    expect(order).toEqual(['up', 'flat', 'down', 'none'])
  })

  it('orders Valuation by the target and sinks the untargeted', () => {
    expect(descend('list_valuation', {
      low: sig({ targetPrice: 10 }),
      none: empty,
      high: sig({ targetPrice: 300 }),
    })).toEqual(['high', 'low', 'none'])
  })

  it('orders View alphabetically, assuming no universal rating order', () => {
    // Rating scales are per-organisation, so there is no Buy-beats-Hold order
    // to hardcode. Unrated sinks.
    expect(descend('list_view', {
      hold: sig({ ratingValue: 'Hold' }),
      unrated: empty,
      buy: sig({ ratingValue: 'Buy' }),
    })).toEqual(['hold', 'buy', 'unrated'])
  })

  it('marks every conceptual column sortable and gives each a comparator', () => {
    const cmps = listSortComparators(() => empty)
    for (const col of LIST_SIGNAL_COLUMNS) {
      expect(col.sortable, `${col.id} must be sortable`).toBe(true)
      expect(cmps[col.id], `${col.id} needs a comparator`).toBeTypeOf('function')
    }
  })
})

/**
 * The defect that made the table unusable on hard refresh.
 *
 * Sparklines rendered tiny and snapped to size seconds later. In jsdom no layout
 * runs, so a test cannot observe the reflow itself — what it CAN observe is the
 * only thing that caused it: whether the box's dimensions come from the element
 * or from its content. So these assert the box exists without data, that its
 * height is declared rather than inherited, and that the chart is taken out of
 * flow so an `<svg>` sized in percentages cannot contribute an intrinsic size.
 */
describe('the market cell has stable geometry before its data exists', () => {
  /*
   * The series now comes from `price_history_cache` through `marketFor`, not
   * from `signal.closes` — the proxy that fed those answers 502 in the running
   * app. These geometry assertions are unchanged in intent; only the source of
   * a DRAWN state moved.
   */
  const drawnMarket = {
    points: [{ date: '2026-09-10', close: 100 }, { date: '2026-10-01', close: 109 }],
    m1: { pct: 9, refused: null, slice: [] },
    m6: { pct: null, refused: 'short-lookback' as const, slice: [] },
    path: [0, 4, 2, 9],
    lastClose: { close: 109, date: '2026-10-01' },
    ageDays: 1,
    covered: true,
  }
  /* The vertical range is no longer handed in: each cell derives it from the
     security's own path (`localDomain`). See `price-metrics`. */
  const marketCell = (signal: ListRowSignal, market?: unknown) =>
    render(<>{renderSignalCell(
      'list_market', { current_price: 154.33 }, signal, undefined, market as never,
    )}</>)

  it('reserves the sparkline box while the month is still loading', () => {
    const { container } = marketCell(empty)
    const box = container.querySelector('[data-testid="spark-cell"]')
    expect(box, 'the box must exist before the closes do').not.toBeNull()
    expect(box!.getAttribute('data-state')).toBe('quiet')
  })

  it('gives the loading and loaded states identical declared height', () => {
    const quiet = marketCell(empty)
      .container.querySelector<HTMLElement>('[data-testid="spark-cell"]')!
    const drawn = marketCell(empty, drawnMarket)
      .container.querySelector<HTMLElement>('[data-testid="spark-cell"]')!

    expect(drawn.getAttribute('data-state')).toBe('drawn')
    // The same number, declared on the element, in both states.
    expect(quiet.style.height).toBe(`${SPARK_HEIGHT}px`)
    expect(drawn.style.height).toBe(quiet.style.height)
  })

  it('takes its width from the column, never from its content', () => {
    const { container } = marketCell(empty)
    /*
     * The cell is the row-flex item, so `flex-1 min-w-0` belongs on IT: with the
     * default `flex-basis:auto` it sized from its CONTENT, and that content was
     * an svg whose own width is a percentage — an indeterminate cycle the
     * browser breaks with the intrinsic size and corrects on a later pass.
     */
    const cell = container.firstElementChild as HTMLElement
    expect(cell.className).toMatch(/\bflex-1\b/)
    expect(cell.className).toMatch(/\bmin-w-0\b/)
  })

  it('never puts flex-1 on the box itself, which would zero its height', () => {
    /*
     * The box's parent is a COLUMN flex, where `flex-1` sets `flex-basis:0%` on
     * the MAIN axis — the height. The declared height then loses to the basis
     * and the box computes to 0px: the chart mounts, measures zero, and is
     * invisible. This shipped once; it must not ship twice.
     */
    for (const market of [undefined, drawnMarket]) {
      const box = marketCell(empty, market)
        .container.querySelector<HTMLElement>('[data-testid="spark-cell"]')!
      expect(box.className).not.toMatch(/\bflex-1\b/)
      expect(box.className).toMatch(/\bw-full\b/)
    }
  })

  it('keeps the chart out of flow so it cannot size the box', () => {
    const { container } = marketCell(empty, drawnMarket)
    const box = container.querySelector<HTMLElement>('[data-testid="spark-cell"]')!
    expect(box.className).toMatch(/\brelative\b/)
    const svg = container.querySelector('svg')!
    // The chart's own wrapper is absolutely positioned over the reserved box.
    expect(svg.parentElement!.className).toMatch(/\babsolute\b/)
    expect(svg.parentElement!.className).toMatch(/\binset-0\b/)
  })

  it('animates no dimension in any state', () => {
    for (const signal of [empty, { ...empty, closes: [100, 110] }]) {
      const { container } = marketCell(signal)
      const box = container.querySelector<HTMLElement>('[data-testid="spark-cell"]')!
      // A width or height transition would turn the resolve into a visible
      // slide, which is the same defect wearing a nicer coat.
      expect(box.className).not.toMatch(/transition|duration-|animate-/)
    }
  })

  it('draws no path from a single close, but still reserves the box', () => {
    const { container } = marketCell({ ...empty, closes: [101] })
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-testid="spark-cell"]')).not.toBeNull()
  })
})

describe('conceptual cells render nothing when they know nothing', () => {
  it.each(['list_exposure', 'list_view', 'list_valuation', 'list_work'])(
    '%s is empty rather than a placeholder',
    id => {
      const { container } = render(<>{renderSignalCell(id, {}, empty)}</>)
      expect(container.textContent).toBe('')
    },
  )

  it('MARKET says nothing with neither a price nor a history', () => {
    const { container } = render(<>{renderSignalCell('list_market', {}, empty)}</>)
    expect(container.textContent).toBe('')
  })

  it('returns undefined for a column it does not own', () => {
    // `null` would mean "mine, and empty" and would stop ListTableView from
    // reaching ListStatusCell.
    expect(renderSignalCell('list_status', {}, empty)).toBeUndefined()
    expect(renderSignalCell('price', {}, empty)).toBeUndefined()
  })
})

describe('what the conceptual cells say when they do know', () => {
  it('MARKET leads with the price and colours the direction of the move', () => {
    const { container } = render(
      <>{renderSignalCell('list_market', { current_price: 154.33, change_percent: -0.62 }, empty)}</>,
    )
    expect(screen.getByText('154.33')).toBeInTheDocument()
    expect(screen.getByText('-0.6%')).toBeInTheDocument()
    expect(container.querySelector('.text-rose-600')).not.toBeNull()
  })

  it('MARKET reads a camelCase change too, since both shapes reach it', () => {
    render(<>{renderSignalCell('list_market', { current_price: 10, changePercent: 1.25 }, empty)}</>)
    expect(screen.getByText('+1.3%')).toBeInTheDocument()
  })

  /**
   * A stored zero is a default, not a reading.
   *
   * Every asset in the corpus carries `change_percent = 0`, so with no live
   * quote this cell painted a green `+0.0%` on all twenty-one rows of a list
   * at once — a column-wide default rendered in the colour reserved for "it
   * went up", twenty-one times, as if each had been measured.
   */
  it('MARKET says nothing rather than +0.0% when the stored change is a default', () => {
    const { container } = render(
      <>{renderSignalCell('list_market', { current_price: 154.33, change_percent: 0 }, empty)}</>,
    )
    expect(screen.getByText('154.33')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/0\.0%/)
    expect(container.querySelector('.text-emerald-600')).toBeNull()
  })

  /**
   * A zeroed quote is this deployment's failure mode, not a flat tape.
   *
   * The live provider is refused by the page's own CSP and the chart proxy
   * answers 502, and what reaches the cell is a zero-FILLED quote object. An
   * earlier rule trusted a live zero and so painted a green `+0.0%` on all
   * twenty-one rows of a list.
   */
  it('MARKET says nothing for a zero-filled quote with no previous close', () => {
    const { container } = render(
      <>{renderSignalCell('list_market', { current_price: 154.33 }, empty,
        { price: 154.33, changePercent: 0 })}</>,
    )
    expect(container.textContent).not.toMatch(/0\.0%/)
  })

  /* The shape the running app actually produces: a zeroed quote that also
     sets previousClose to the price, so a corroboration check passes on it.
     That check was tried and is why this assertion exists. */
  it('MARKET says nothing even when previousClose agrees with the zero', () => {
    const { container } = render(
      <>{renderSignalCell('list_market', { current_price: 154.33 }, empty,
        { price: 154.33, changePercent: 0, previousClose: 154.33 } as never)}</>,
    )
    expect(container.textContent).not.toMatch(/0\.0%/)
  })

  it('prefers the table\'s live quote over the stored price, in both cells', () => {
    /*
     * The defect this fixes was visible: GOOGL's stored `current_price` was
     * 142.80 while the table's own price cell showed 347.68, and VALUATION
     * computed its upside against the stale one — rendering "+1024%".
     */
    const quote = { price: 347.68, changePercent: -0.62 }
    const asset = { current_price: 142.80, change_percent: 11 }
    render(<>{renderSignalCell('list_market', asset, empty, quote)}</>)
    expect(screen.getByText('347.68')).toBeInTheDocument()
    expect(screen.getByText('-0.6%')).toBeInTheDocument()
    expect(screen.queryByText('142.80')).not.toBeInTheDocument()

    render(<>{renderSignalCell('list_valuation', asset, { ...empty, targetPrice: 400 }, quote)}</>)
    // 400 against 347.68, not against 142.80 (which would read +180.1%).
    expect(screen.getByText('+15.0%')).toBeInTheDocument()
    expect(screen.queryByText('+180.1%')).not.toBeInTheDocument()
  })

  it('falls back to the stored price when there is no live quote', () => {
    render(<>{renderSignalCell('list_market', { current_price: 154.33 }, empty, null)}</>)
    expect(screen.getByText('154.33')).toBeInTheDocument()
  })

  it('EXPOSURE says what the weight is a weight OF', () => {
    render(<>{renderSignalCell('list_exposure', {}, {
      ...empty, weightPct: 1.94, bookName: 'Vision Fund', bookCount: 1,
    })}</>)
    expect(screen.getByText('1.94%')).toBeInTheDocument()
    expect(screen.getByText('Vision Fund')).toBeInTheDocument()
  })

  it('EXPOSURE says when the largest stake is not the only one', () => {
    render(<>{renderSignalCell('list_exposure', {}, {
      ...empty, weightPct: 1.94, bookName: 'Vision Fund', bookCount: 3,
    })}</>)
    expect(screen.getByText('Vision Fund +2')).toBeInTheDocument()
  })

  it('EXPOSURE drops to one decimal once the weight no longer needs two', () => {
    render(<>{renderSignalCell('list_exposure', {}, { ...empty, weightPct: 12.34 })}</>)
    expect(screen.getByText('12.3%')).toBeInTheDocument()
  })

  it('EXPOSURE distinguishes held-but-unweighable from not held', () => {
    // A book whose NAV did not resolve still holds the name. Reporting nothing
    // would say we do not own it, which is false.
    render(<>{renderSignalCell('list_exposure', {}, {
      ...empty, weightPct: null, bookCount: 1, bookName: 'Vision Fund',
    })}</>)
    expect(screen.getByText('held')).toBeInTheDocument()

    const { container } = render(<>{renderSignalCell('list_exposure', {}, empty)}</>)
    expect(container.textContent).toBe('')
  })

  it('INVESTMENT VIEW states the judgement and the price it implies', () => {
    const { container } = render(<>{renderSignalCell('list_view', { current_price: 154.33 }, {
      ...empty, ratingValue: 'BUY', conviction: 'medium', targetPrice: 178,
    })}</>)
    expect(screen.getByText('BUY')).toBeInTheDocument()
    expect(screen.getByText('$178.00')).toBeInTheDocument()
    expect(screen.getByText('+15.3%')).toBeInTheDocument()
    // Conviction is the bar glyph plus a tooltip here; the word belongs to the
    // inspectors, where there is room for it.
    expect(container.querySelector('[title="medium conviction"]')).not.toBeNull()
  })

  it('gives the rating and the target SEPARATE entry points', () => {
    /*
     * They are two questions inside one column — what do we believe, and what
     * is it worth — and they open Case and Valuation respectively. Sending
     * both to one mode is the near-miss `data-entry` exists to prevent.
     */
    const { container } = render(<>{renderSignalCell('list_view', { current_price: 154.33 }, {
      ...empty, ratingValue: 'BUY', conviction: 'medium', targetPrice: 178,
    })}</>)
    expect(container.querySelector('[data-entry="case"]')).not.toBeNull()
    expect(container.querySelector('[data-entry="valuation"]')).not.toBeNull()
  })

  it('marks every conceptual datum with the mode it opens', () => {
    const sig = {
      ...empty, ratingValue: 'BUY', conviction: 'medium', targetPrice: 178,
      weightPct: 1.2, bookName: 'Vision Fund 10K', bookCount: 1,
      closes: [163, 160, 158, 154],
      work: { tier: 'decision' as const, label: 'BUY · Recommendation ready', count: 0, secondary: null },
    }
    const entryOf = (col: string) => {
      const { container } = render(<>{renderSignalCell(col, { current_price: 154.33 }, sig)}</>)
      return [...container.querySelectorAll('[data-entry]')].map(e => e.getAttribute('entry') ?? (e as HTMLElement).dataset.entry)
    }
    expect(entryOf('list_market')).toContain('market')
    expect(entryOf('list_exposure')).toContain('position')
    expect(entryOf('list_work')).toContain('work')
    expect(entryOf('list_valuation')).toContain('valuation')
  })

  it('VALUATION computes upside against the stored price and names both inputs', () => {
    render(
      <>{renderSignalCell('list_valuation', { current_price: 200 }, { ...empty, targetPrice: 240 })}</>,
    )
    expect(screen.getByText('$240.00')).toBeInTheDocument()
    expect(screen.getByText('+20.0%')).toBeInTheDocument()
    // Provenance: the figure is traceable to the price it was computed from.
    expect(screen.getByTitle(/last stored price of 200\.00/)).toBeInTheDocument()
  })

  it('VALUATION shows a target with no upside when there is no price to compare', () => {
    render(<>{renderSignalCell('list_valuation', {}, { ...empty, targetPrice: 240 })}</>)
    expect(screen.getByText('$240.00')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('VALUATION never divides by a zero price', () => {
    render(
      <>{renderSignalCell('list_valuation', { current_price: 0 }, { ...empty, targetPrice: 240 })}</>,
    )
    expect(screen.queryByText('Infinity%')).not.toBeInTheDocument()
    expect(screen.getByText('$240.00')).toBeInTheDocument()
  })
})

describe('WORK says the highest-value thing happening on the name', () => {
  it('leads with the investment workflow, not the filing state', () => {
    /*
     * The defect this fixes, concretely: a name carrying a live BUY awaiting a
     * recommendation reported "Thin evidence" — true, and the least important
     * true thing about it. The decision leads now; the hygiene is a footnote.
     */
    render(<>{renderSignalCell('list_work', {}, work({
      tier: 'decision',
      label: 'BUY · Recommendation ready',
      secondary: 'Thin evidence',
    }))}</>)
    expect(screen.getByText('BUY · Recommendation ready')).toBeInTheDocument()
    expect(screen.getByText('Thin evidence')).toBeInTheDocument()
  })

  it('names unreviewed research and counts it', () => {
    render(<>{renderSignalCell('list_work', {}, work({
      tier: 'evidence', label: 'New research', count: 3,
    }))}</>)
    expect(screen.getByText('New research')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('uses the product vocabulary, not a status field', () => {
    render(<>{renderSignalCell('list_work', {}, work({ tier: 'gap', label: 'No thesis on file' }))}</>)
    expect(screen.getByText('No thesis on file')).toBeInTheDocument()
  })

  it('gives a current case no mark — a list where every row is decorated says nothing', () => {
    const { container } = render(
      <>{renderSignalCell('list_work', {}, work({ tier: 'clear', label: 'Current' }))}</>,
    )
    expect(container.textContent).toBe('Current')
    // No dot: the two attention marks belong to the two tiers that owe an action.
    expect(container.querySelector('.bg-amber-500')).toBeNull()
    expect(container.querySelector('.bg-primary-600')).toBeNull()
  })

  it('marks a review as due without claiming new research arrived', () => {
    render(<>{renderSignalCell('list_work', {}, work({ tier: 'review', label: 'Review due' }))}</>)
    expect(screen.getByText('Review due')).toBeInTheDocument()
    expect(screen.queryByText('New research')).not.toBeInTheDocument()
  })

  it('says nothing at all when there is nothing known', () => {
    const { container } = render(<>{renderSignalCell('list_work', {}, empty)}</>)
    expect(container.textContent).toBe('')
  })
})
