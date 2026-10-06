/**
 * The collapsed list row: the curated presentation, and the cells in it.
 *
 * Two things here are easy to regress and both would be invisible in review:
 *
 *   1. The preset HIDES, it does not delete. A user who turns Processes back on
 *      must keep it, and a caller-supplied or AI column must survive a reorder
 *      it was never named in. Asserting only "priority is not visible" would
 *      pass against a preset that dropped the column from the picker entirely.
 *
 *   2. The cells render NOTHING when they know nothing. A column of "—" makes a
 *      thin list look broken, and the happy path alone cannot tell the
 *      difference.
 *
 * `renderSignalCell` returns `undefined` for ids it does not own — distinct
 * from `null`, which means "mine, and empty". `ListTableView` depends on that
 * difference to fall through to the list-scoped cells, so it is asserted.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  LIST_SIGNAL_COLUMNS, listColumnPreset, renderSignalCell, listSortComparators,
} from '../ListRowCells'
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
  ratingValue: null, ratingColor: null, conviction: null, targetPrice: null,
}

const idsOf = (cols: Array<{ id: string }>) => cols.map(c => c.id)
const visibleIdsOf = (cols: Array<{ id: string; visible: boolean }>) =>
  cols.filter(c => c.visible).map(c => c.id)

describe('the curated List presentation', () => {
  it('leads with the security, the market, then what we think', () => {
    const order = visibleIdsOf(listColumnPreset(base()))
    expect(order).toEqual([
      'select', 'ticker', 'companyName',
      'price', 'change', 'list_spark',
      'list_position',
      'list_rating', 'list_target',
      'list_work',
      'coverage',
      // Unranked and visible, so it lands after the curated run rather than
      // disappearing. See "keeps a column it was never told about".
      'ai_custom_1',
    ])
  })

  it('fits a normal desktop pane without horizontal scroll', () => {
    /*
     * Measured against the REAL `DEFAULT_COLUMNS`, not the fixture above: a
     * width budget checked against invented widths measures the invention.
     *
     * The first version of this preset hid five columns and still came to
     * 1316px, which scrolls in any normal pane — hiding was the wrong lever
     * once the remaining columns were that wide, so the preset narrows them
     * too. 1050px leaves room for the app's own chrome at a 1440 viewport.
     */
    const width = listColumnPreset([...DEFAULT_COLUMNS, ...LIST_SIGNAL_COLUMNS])
      .filter(c => c.visible)
      .reduce((sum, c) => sum + c.width, 0)
    expect(width).toBeLessThan(1050)
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
      // Still in the picker, and still restorable.
      expect(idsOf(out)).toContain(id)
    }
  })

  it('loses no column at all — hiding is not deleting', () => {
    const input = base()
    const out = listColumnPreset(input)
    expect(idsOf(out).sort()).toEqual(idsOf(input).sort())
  })

  it('keeps a column it was never told about', () => {
    // An AI column, or one a future caller adds. It must survive the reorder.
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
    // Two unranked columns keep their incoming relative order, so a reorder
    // never silently shuffles the tail.
    const out = idsOf(listColumnPreset(base()))
    expect(out.indexOf('rating')).toBeLessThan(out.indexOf('thesis'))
  })
})

describe('the signal columns can be ordered', () => {
  /*
   * These exist because a watchlist whose columns cannot be sorted is a report.
   * The table's own sort can only reach fields on the asset, so without these
   * the reader could see which securities need attention but not bring them
   * together — which on a fifty-name list is the difference between the column
   * being useful and being decoration.
   */
  const sig = (over: Partial<ListRowSignal>): ListRowSignal => ({ ...empty, ...over })

  /** Sort descending, the way the table does on a first header click. */
  const descend = (columnId: string, rows: Record<string, ListRowSignal>) => {
    const cmp = listSortComparators(id => rows[id as string] ?? empty)[columnId]
    return Object.keys(rows).sort((a, b) => cmp({ id: b }, { id: a }))
  }

  it('orders Work by urgency, unanswered research first', () => {
    const order = descend('list_work', {
      current: sig({ state: 'current' }),
      nothing: empty,
      stale: sig({ state: 'stale' }),
      unread: sig({ state: 'evidence-since-review', subject: { newSinceReview: 1 } as any }),
      nocase: sig({ state: 'no-thesis' }),
    })
    // Unreviewed research leads: it is the one state where the written case may
    // already be wrong.
    expect(order[0]).toBe('unread')
    expect(order.indexOf('stale')).toBeLessThan(order.indexOf('nocase'))
    // A current case, then a name with no research subject at all, come last.
    expect(order.slice(-2)).toEqual(['current', 'nothing'])
  })

  it('breaks a Work tie on how much is unread', () => {
    const order = descend('list_work', {
      one: sig({ state: 'evidence-since-review', subject: { newSinceReview: 1 } as any }),
      five: sig({ state: 'evidence-since-review', subject: { newSinceReview: 5 } as any }),
    })
    expect(order).toEqual(['five', 'one'])
  })

  it('orders Position by weight and sinks the unheld', () => {
    const order = descend('list_position', {
      small: sig({ weightPct: 0.4 }),
      unheld: empty,
      big: sig({ weightPct: 6.1 }),
    })
    // "Sort by Position" means show me what we own — an absent weight must not
    // float to the top of a descending sort.
    expect(order).toEqual(['big', 'small', 'unheld'])
  })

  it('orders 1M by the move, not by the closing price', () => {
    const order = descend('list_spark', {
      up: sig({ closes: [100, 110] }),       // +10%
      down: sig({ closes: [400, 380] }),     // -5%, but a far higher price
      flat: sig({ closes: [50, 50] }),       // 0%
      none: empty,
    })
    expect(order).toEqual(['up', 'flat', 'down', 'none'])
  })

  it('orders Target by price and sinks the untargeted', () => {
    expect(descend('list_target', {
      low: sig({ targetPrice: 10 }),
      none: empty,
      high: sig({ targetPrice: 300 }),
    })).toEqual(['high', 'low', 'none'])
  })

  it('orders View alphabetically, assuming no universal rating order', () => {
    // Rating scales are per-organisation, so there is no Buy-beats-Hold order
    // to hardcode. Unrated sinks.
    expect(descend('list_rating', {
      hold: sig({ ratingValue: 'Hold' }),
      unrated: empty,
      buy: sig({ ratingValue: 'Buy' }),
    })).toEqual(['hold', 'buy', 'unrated'])
  })

  it('marks every signal column sortable', () => {
    const cmps = listSortComparators(() => empty)
    for (const col of LIST_SIGNAL_COLUMNS) {
      expect(col.sortable, `${col.id} must be sortable`).toBe(true)
      expect(cmps[col.id], `${col.id} needs a comparator`).toBeTypeOf('function')
    }
  })
})

describe('signal cells render nothing when they know nothing', () => {
  it.each(['list_spark', 'list_position', 'list_rating', 'list_target', 'list_work'])(
    '%s is empty rather than a placeholder',
    id => {
      const { container } = render(<>{renderSignalCell(id, {}, empty)}</>)
      expect(container.textContent).toBe('')
    },
  )

  it('returns undefined for a column it does not own', () => {
    // `null` would mean "mine, and empty" and would stop ListTableView from
    // reaching ListStatusCell.
    expect(renderSignalCell('list_status', {}, empty)).toBeUndefined()
    expect(renderSignalCell('price', {}, empty)).toBeUndefined()
  })

  it('draws no sparkline from a single close', () => {
    const { container } = render(
      <>{renderSignalCell('list_spark', {}, { ...empty, closes: [101] })}</>,
    )
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('what the cells say when they do know', () => {
  it('shows the largest book weight, with more precision when small', () => {
    render(<>{renderSignalCell('list_position', {}, { ...empty, weightPct: 5.142 })}</>)
    expect(screen.getByText('5.14%')).toBeInTheDocument()
  })

  it('drops to one decimal once the weight is large enough not to need two', () => {
    render(<>{renderSignalCell('list_position', {}, { ...empty, weightPct: 12.34 })}</>)
    expect(screen.getByText('12.3%')).toBeInTheDocument()
  })

  it('computes upside against the stored price and names both inputs', () => {
    render(
      <>{renderSignalCell('list_target', { current_price: 200 }, { ...empty, targetPrice: 240 })}</>,
    )
    expect(screen.getByText('240.00')).toBeInTheDocument()
    expect(screen.getByText('+20%')).toBeInTheDocument()
    // Provenance: the figure is traceable to the price it was computed from.
    expect(screen.getByTitle(/last stored price of 200\.00/)).toBeInTheDocument()
  })

  it('shows a target with no upside when there is no price to compare', () => {
    render(<>{renderSignalCell('list_target', {}, { ...empty, targetPrice: 240 })}</>)
    expect(screen.getByText('240.00')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('never divides by a zero price', () => {
    render(
      <>{renderSignalCell('list_target', { current_price: 0 }, { ...empty, targetPrice: 240 })}</>,
    )
    expect(screen.queryByText('Infinity%')).not.toBeInTheDocument()
    expect(screen.getByText('240.00')).toBeInTheDocument()
  })
})

describe('work state is the research lifecycle, in its own words', () => {
  const sig = (over: Partial<ListRowSignal>): ListRowSignal => ({ ...empty, ...over })

  it('names unreviewed research and counts it', () => {
    render(<>{renderSignalCell('list_work', {}, sig({
      state: 'evidence-since-review',
      subject: { newSinceReview: 3 } as any,
    }))}</>)
    expect(screen.getByText('New research')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('uses the product vocabulary, not a status field', () => {
    render(<>{renderSignalCell('list_work', {}, sig({ state: 'no-thesis' }))}</>)
    expect(screen.getByText('No thesis on file')).toBeInTheDocument()
  })

  it('gives a current case no badge — a list where every row is decorated says nothing', () => {
    const { container } = render(<>{renderSignalCell('list_work', {}, sig({ state: 'current' }))}</>)
    expect(container.textContent).toBe('Current')
    // Plain text, no attention treatment.
    expect(container.querySelector('.bg-amber-50')).toBeNull()
    expect(container.querySelector('.rounded')).toBeNull()
  })

  it('marks a review as due without claiming new research arrived', () => {
    render(<>{renderSignalCell('list_work', {}, sig({ state: 'stale' }))}</>)
    expect(screen.getByText('Review due')).toBeInTheDocument()
    expect(screen.queryByText('New research')).not.toBeInTheDocument()
  })
})
