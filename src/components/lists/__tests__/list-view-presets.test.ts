/**
 * Three readings of one list.
 *
 * What these guard is that a preset is a LAYOUT and nothing else: the same
 * rows, the same query, a different column order. The failure they exist to
 * catch is a view that quietly hides a column another view depends on, or a
 * switch that discards the reader's own customisations.
 */
import { describe, it, expect } from 'vitest'
import {
  LIST_VIEWS, DEFAULT_LIST_VIEW, presetFor, storageKeyFor, type ListView,
} from '../listViewPresets'
import { LIST_SIGNAL_COLUMNS, listSortComparators } from '../ListRowCells'
import { DEFAULT_COLUMNS } from '../../table/AssetTableView'

const base = () => [...DEFAULT_COLUMNS, ...LIST_SIGNAL_COLUMNS].map(c => ({ ...c }))
const visible = (v: ListView) =>
  presetFor(v)(base()).filter(c => c.visible).map(c => c.id)
const all = (v: ListView) => presetFor(v)(base()).map(c => c.id)

describe('each view answers its own question', () => {
  it('Monitor leads with the market', () => {
    const ids = visible('monitor')
    expect(ids.indexOf('list_market')).toBeLessThan(ids.indexOf('list_view'))
    expect(ids).toContain('list_work')
  })

  it('Research leads with the view and carries what changed since review', () => {
    const ids = visible('research')
    expect(ids.indexOf('list_view')).toBeLessThan(ids.indexOf('list_market'))
    for (const id of ['list_valuation', 'list_case', 'list_evidence', 'list_changed']) {
      expect(ids, `Research needs ${id}`).toContain(id)
    }
  })

  it('Decide leads with the recommendation and prices the change', () => {
    const ids = visible('decide')
    expect(ids.indexOf('list_work')).toBeLessThan(ids.indexOf('list_valuation'))
    for (const id of ['list_stage', 'list_owner', 'list_age', 'list_sizing']) {
      expect(ids, `Decide needs ${id}`).toContain(id)
    }
  })

  it('names the recommendation column for what it is on Decide', () => {
    const label = (v: ListView) => presetFor(v)(base()).find(c => c.id === 'list_work')?.label
    expect(label('decide')).toBe('Recommendation')
    expect(label('monitor')).toBe('Attention')
  })
})

describe('a view is a layout, not a different list', () => {
  /**
   * The property that makes switching safe.
   *
   * Every view returns the same column SET — only `visible` and the order
   * differ. A view that dropped a column would make the picker lie, and a
   * reader who turned something on in Monitor would find it gone in Research
   * with no way back.
   */
  it('keeps every column in the picker, in every view', () => {
    const monitor = [...all('monitor')].sort()
    for (const v of LIST_VIEWS) {
      expect([...all(v.id)].sort(), `${v.id} dropped a column`).toEqual(monitor)
    }
  })

  it('shows a column the previous view hid', () => {
    // Switching to Decide must reveal Stage even though Monitor hid it —
    // a preset that only ever clears `visible` can never turn one back on.
    expect(visible('monitor')).not.toContain('list_stage')
    expect(visible('decide')).toContain('list_stage')
  })

  it('never right-aligns a conceptual column', () => {
    for (const v of LIST_VIEWS) {
      for (const c of presetFor(v.id)(base())) {
        if (c.id.startsWith('list_')) {
          expect(c.align, `${c.id} must stay left in ${v.id}`).not.toBe('right')
        }
      }
    }
  })

  it('gives every column on a line some slack', () => {
    for (const v of LIST_VIEWS) {
      const shown = presetFor(v.id)(base()).filter(c => c.visible && c.id.startsWith('list_'))
      expect(shown.length).toBeGreaterThan(2)
      for (const c of shown) {
        expect(c.grow ?? 0, `${c.id} on ${v.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('fits a laptop pane in every view', () => {
    for (const v of LIST_VIEWS) {
      const w = presetFor(v.id)(base())
        .filter(c => c.visible)
        .reduce((s, c) => s + c.width, 0)
      expect(w, `${v.id} is too wide`).toBeLessThan(1240)
    }
  })
})

describe('customisations survive a switch', () => {
  /**
   * Monitor keeps the ORIGINAL key on purpose.
   *
   * It is the default view and the key every layout saved before presets
   * existed was written under. Suffixing it would silently discard them.
   */
  it('leaves the default view on the pre-existing key', () => {
    expect(storageKeyFor('listTableColumns_abc', 'monitor')).toBe('listTableColumns_abc')
  })

  it('gives the other views their own', () => {
    expect(storageKeyFor('listTableColumns_abc', 'research')).toBe('listTableColumns_abc_research')
    expect(storageKeyFor('listTableColumns_abc', 'decide')).toBe('listTableColumns_abc_decide')
  })

  it('passes an absent key through rather than inventing one', () => {
    expect(storageKeyFor(undefined, 'decide')).toBeUndefined()
  })
})

describe('every column a view shows can be sorted', () => {
  /**
   * The table offers a sort on any `sortable` column, so one without a
   * comparator sorts by nothing and silently does nothing when clicked.
   */
  it('has a comparator for each list column', () => {
    const cmp = listSortComparators(() => ({}) as never)
    for (const c of LIST_SIGNAL_COLUMNS) {
      expect(c.sortable, `${c.id} should be sortable`).toBe(true)
      expect(cmp[c.id], `${c.id} needs a comparator`).toBeTypeOf('function')
    }
  })

  it('defaults to Monitor', () => {
    expect(DEFAULT_LIST_VIEW).toBe('monitor')
  })
})
