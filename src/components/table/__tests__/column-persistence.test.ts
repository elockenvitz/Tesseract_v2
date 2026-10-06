/**
 * The rule that decides whether a curated default or a saved layout wins.
 *
 * This is pinned because it already failed silently once: a surface's preset
 * hid five columns, the columns came back in the preset's new ORDER, and the
 * five were still visible — so it looked as though the preset had run. The
 * cause was `visible` being taken from storage unconditionally, and the
 * persist-on-mount effect meant every reader had storage after one render.
 *
 * The tests below therefore assert BOTH directions, because either alone
 * passes against a broken implementation:
 *   • a matching version must preserve the reader's choices
 *   • a mismatched version must discard them for the new baseline
 */
import { describe, it, expect } from 'vitest'
import {
  mergeSavedColumns, serializeColumns, type PersistedColumn,
} from '../columnPersistence'

const col = (id: string, over: Partial<PersistedColumn> = {}) => ({
  id, visible: true, width: 100, pinned: false, ...over,
})

/** A baseline where the preset has hidden two columns and narrowed one. */
const base = () => [
  col('ticker', { width: 88, pinned: true }),
  col('price', { width: 80 }),
  col('priority', { visible: false }),
  col('workflows', { visible: false }),
]

describe('a matching preset version keeps what the reader chose', () => {
  it('restores visibility, width and pinning', () => {
    const stored = {
      v: 'p1',
      columns: [
        col('ticker', { width: 200, pinned: false }),
        col('priority', { visible: true }),
      ],
    }
    const out = mergeSavedColumns(base(), stored, 'p1')
    expect(out.find(c => c.id === 'ticker')).toMatchObject({ width: 200, pinned: false })
    // The reader turned a preset-hidden column back on. That must survive.
    expect(out.find(c => c.id === 'priority')!.visible).toBe(true)
  })

  it('leaves a column the stored layout never mentioned at its baseline', () => {
    const stored = { v: 'p1', columns: [col('ticker', { width: 200 })] }
    const out = mergeSavedColumns(base(), stored, 'p1')
    expect(out.find(c => c.id === 'workflows')!.visible).toBe(false)
    expect(out.find(c => c.id === 'price')!.width).toBe(80)
  })

  it('keeps the baseline ORDER, never the stored order', () => {
    // Order belongs to the code. A stored order would pin a layout the preset
    // has since changed — and the original bug was mistaken for working
    // precisely because order came from the preset while visibility did not.
    const stored = { v: 'p1', columns: [col('price'), col('ticker')] }
    const out = mergeSavedColumns(base(), stored, 'p1')
    expect(out.map(c => c.id)).toEqual(['ticker', 'price', 'priority', 'workflows'])
  })
})

describe('a new preset version takes the new baseline exactly once', () => {
  it('discards a stored layout written under an older version', () => {
    const stored = {
      v: 'p1',
      columns: [col('priority', { visible: true }), col('workflows', { visible: true })],
    }
    const out = mergeSavedColumns(base(), stored, 'p2')
    // This is the whole point: the new default reaches a reader who already
    // had saved state.
    expect(out.find(c => c.id === 'priority')!.visible).toBe(false)
    expect(out.find(c => c.id === 'workflows')!.visible).toBe(false)
  })

  it('treats a pre-versioning bare array as stale once a preset exists', () => {
    const legacy = [col('priority', { visible: true })]
    const out = mergeSavedColumns(base(), legacy, 'p1')
    expect(out.find(c => c.id === 'priority')!.visible).toBe(false)
  })

  it('still honours a bare array on a surface that has no preset', () => {
    // The Assets table has no preset and must keep behaving as it always has.
    const legacy = [col('priority', { visible: true, width: 150 })]
    const out = mergeSavedColumns(base(), legacy, undefined)
    expect(out.find(c => c.id === 'priority')).toMatchObject({ visible: true, width: 150 })
  })
})

describe('nothing usable in storage leaves the baseline alone', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty column list', { v: 'p1', columns: [] }],
    ['an empty array', []],
  ])('%s', (_label, raw) => {
    const b = base()
    expect(mergeSavedColumns(b, raw, 'p1')).toEqual(b)
  })

  it('does not mutate the baseline it was given', () => {
    const b = base()
    mergeSavedColumns(b, { v: 'p1', columns: [col('priority', { visible: true })] }, 'p1')
    expect(b.find(c => c.id === 'priority')!.visible).toBe(false)
  })
})

describe('what gets written back', () => {
  it('stamps the version so the next load can judge it', () => {
    expect(serializeColumns(base(), 'p2').v).toBe('p2')
    expect(serializeColumns(base(), undefined).v).toBeNull()
  })

  it('stores only the four fields the reader controls', () => {
    const withExtras = [{ ...col('ticker'), label: 'Ticker', category: 'core', sortable: true }]
    const [row] = serializeColumns(withExtras, 'p1').columns
    // Storing whole column objects froze labels and widths that later changed
    // in code, so the shape is deliberately narrow.
    expect(Object.keys(row).sort()).toEqual(['id', 'pinned', 'visible', 'width'])
  })

  it('round-trips through a matching version unchanged', () => {
    const chosen = [
      col('ticker', { width: 240, pinned: false }),
      col('price', { visible: false, width: 80 }),
      col('priority', { visible: true, width: 100 }),
      col('workflows', { visible: false, width: 100 }),
    ]
    const blob = JSON.parse(JSON.stringify(serializeColumns(chosen, 'p1')))
    const out = mergeSavedColumns(base(), blob, 'p1')
    expect(out.map(c => ({ id: c.id, visible: c.visible, width: c.width, pinned: c.pinned })))
      .toEqual(chosen)
  })
})
