import { describe, it, expect } from 'vitest'
import { selectionForPosition, assetFocusFor } from '../selection'
import type { DashboardFocusTarget } from '../../dashboard/focus'

/**
 * A holding, as a selection.
 *
 * ── What this protects ────────────────────────────────────────────────────
 *
 * The workspace routes on `family` and `assetId` and marks the open tile with
 * `key`. All three come from here, and all three are the kind of field that
 * looks plausible when it is wrong -- a holding routed to `overview` opens on
 * a page that does not answer the question the book asked, and nothing on
 * screen says so.
 */

const TARGET: DashboardFocusTarget = {
  originLens: 'portfolio',
  workspaceLens: 'portfolio',
  objectType: 'position',
  objectId: 'asset-jnj',
  symbol: 'JNJ',
  label: 'Johnson & Johnson',
  portfolioId: 'book-1',
  portfolioName: 'Large Cap Core',
  issue: 'No thesis on file',
  origin: 'portfolio',
}

describe('selectionForPosition', () => {
  it('opens the asset at the position, which is what the book asked about', () => {
    const s = selectionForPosition(TARGET)
    expect(s.family).toBe('portfolio')
    /* The mapping and the family together. `assetFocusFor` falls back to
       `overview` for anything unmapped, so a family added without a mapping
       fails here rather than quietly opening the wrong page. */
    expect(assetFocusFor(s.family)).toBe('position')
  })

  it('carries the asset and the book, because a position is both', () => {
    const s = selectionForPosition(TARGET)
    expect(s.assetId).toBe('asset-jnj')
    expect(s.symbol).toBe('JNJ')
    expect(s.portfolioId).toBe('book-1')
    expect(s.portfolioName).toBe('Large Cap Core')
  })

  it('keys on the book as well as the asset', () => {
    const other = selectionForPosition({ ...TARGET, portfolioId: 'book-2' })
    /* The same name in two books is two selections. A key on the asset alone
       would mark the wrong tile after a book change, and would make the
       workspace think it was already showing what the reader just asked for. */
    expect(selectionForPosition(TARGET).key).not.toBe(other.key)
    expect(selectionForPosition(TARGET).key).toContain('book-1')
    expect(selectionForPosition(TARGET).key).toContain('asset-jnj')
  })

  it('is not a post, and does not pretend to carry one', () => {
    const s = selectionForPosition(TARGET)
    /* The router's first branch is `family === 'post'`, and it reads
       `objectId`, `postType` and `item`. A holding has none of them. */
    expect(s.objectId).toBeNull()
    expect(s.postType).toBeNull()
    expect(s.item).toBeNull()
  })

  it('states no reason, because nothing surfaced this', () => {
    const s = selectionForPosition(TARGET)
    /* The reader pointed at a row in their own book. The headline is the gap
       the tile was already showing them; a composed sentence here would be a
       second voice describing a finding that does not exist. */
    expect(s.why.headline).toBe('No thesis on file')
    expect(s.why.reason).toBeNull()
    expect(s.why.occurredAt).toBeNull()
  })

  it('falls back to the name when the tile reports no gap', () => {
    const s = selectionForPosition({ ...TARGET, issue: null })
    expect(s.why.headline).toBe('Johnson & Johnson')
  })

  it('is not reconciled by the Ideas feed, which never offered it', () => {
    /* The feed clears selections its own lens or facets no longer contain.
       That rule is keyed on `origin === 'ideas'`, and a holding the reader
       opened from their book was never asked for there. */
    expect(selectionForPosition(TARGET).origin).toBe('portfolio')
  })
})
