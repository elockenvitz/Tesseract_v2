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

/**
 * A preset bump must deliver the new default WITHOUT wiping the reader out.
 *
 * The first version of this rule was all-or-nothing: a version mismatch
 * dropped the whole stored layout. That is right for the column the preset
 * actually changed and wrong for every other one — a reader who had widened
 * one column, unpinned another and turned a third back on lost all three
 * because something unrelated moved.
 *
 * So the blob records the baseline it was written against, and the bump keeps
 * only what DIFFERS from it. Both directions are asserted, because either
 * alone passes against a broken implementation: one that keeps everything
 * passes the "customisation survives" tests, one that keeps nothing passes
 * the "new default arrives" tests.
 */
describe('a preset bump migrates rather than resets', () => {
  /** What the old preset wanted. */
  const oldBase = () => [
    col('ticker', { width: 88, pinned: true }),
    col('price', { width: 80 }),
    col('priority', { visible: false }),
    col('workflows', { visible: false }),
  ]
  /** The new preset hides `price` and widens `ticker`. */
  const newBase = () => [
    col('ticker', { width: 140, pinned: true }),
    col('price', { visible: false, width: 80 }),
    col('priority', { visible: false }),
    col('workflows', { visible: false }),
  ]
  const find = (out: Array<{ id: string }>, id: string) => out.find(c => c.id === id)! as PersistedColumn
  const blobOf = (chosen: PersistedColumn[]) =>
    JSON.parse(JSON.stringify(serializeColumns(chosen, 'p1', oldBase())))

  it('gives an untouched reader the new default in full', () => {
    // Saved layout identical to the old baseline: nothing was ever chosen.
    const out = mergeSavedColumns(newBase(), blobOf(oldBase()), 'p2')
    expect(find(out, 'price').visible).toBe(false)
    expect(find(out, 'ticker').width).toBe(140)
  })

  it('keeps a width the reader chose, and still applies the new visibility', () => {
    const chosen = oldBase().map(c => c.id === 'price' ? { ...c, width: 300 } : c)
    const out = mergeSavedColumns(newBase(), blobOf(chosen), 'p2')
    // Field by field: the width was theirs, the visibility was not.
    expect(find(out, 'price').width).toBe(300)
    expect(find(out, 'price').visible).toBe(false)
  })

  it('keeps a column the reader deliberately turned back on', () => {
    const chosen = oldBase().map(c => c.id === 'priority' ? { ...c, visible: true } : c)
    const out = mergeSavedColumns(newBase(), blobOf(chosen), 'p2')
    expect(find(out, 'priority').visible).toBe(true)
  })

  it('keeps a pin the reader removed, and still moves the width they did not touch', () => {
    const chosen = oldBase().map(c => c.id === 'ticker' ? { ...c, pinned: false } : c)
    const out = mergeSavedColumns(newBase(), blobOf(chosen), 'p2')
    expect(find(out, 'ticker').pinned).toBe(false)
    expect(find(out, 'ticker').width).toBe(140)
  })

  it('takes the new baseline whole when the blob records no defaults', () => {
    /*
     * Blobs written before defaults were recorded cannot be diffed: nothing in
     * them can be attributed to the reader rather than to a baseline they
     * never saw. Taking the new default is the pre-migration behaviour and the
     * only honest answer.
     */
    const chosen = oldBase().map(c => c.id === 'price' ? { ...c, width: 300 } : c)
    const out = mergeSavedColumns(newBase(), { v: 'p1', columns: chosen }, 'p2')
    expect(find(out, 'price').width).toBe(80)
    expect(find(out, 'price').visible).toBe(false)
  })

  it('ignores a column the old baseline never mentioned', () => {
    // An AI column, say. It cannot be diffed, so the new baseline governs.
    const blob = { v: 'p1', columns: [...oldBase(), col('ai_1', { width: 500 })], d: oldBase() }
    const out = mergeSavedColumns([...newBase(), col('ai_1', { width: 120 })], blob, 'p2')
    expect(find(out, 'ai_1').width).toBe(120)
  })

  it('records the baseline alongside the layout', () => {
    const blob = serializeColumns(oldBase(), 'p1', oldBase())
    expect(blob.d).toBeDefined()
    expect(blob.d!.map(c => c.id)).toEqual(['ticker', 'price', 'priority', 'workflows'])
    // Same narrow shape as the layout itself.
    expect(Object.keys(blob.d![0]).sort()).toEqual(['id', 'pinned', 'visible', 'width'])
  })
})
