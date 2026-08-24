import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { FeedCaptureSheet } from '../FeedCaptureSheet'

/**
 * The footer used to carry `Capture | <decision> | Open TICKER`, so the
 * decision the card exists to prompt got a third of the bar and sat between two
 * ways of leaving it. Navigation moved into the sheet; these pin the parts of
 * that move that could regress silently.
 */

/**
 * `BottomSheet` portals to `document.body`, so the render result's own
 * container is empty. Asserting against it silently passes everything —
 * which is exactly what the first draft of this file did.
 */
const body = () => document.body.textContent ?? ''
const find = (sel: string) => document.body.querySelector(sel)

const view = (over: Partial<Parameters<typeof FeedCaptureSheet>[0]> = {}) => {
  const onOpenAsset = vi.fn()
  const onClose = vi.fn()
  document.body.innerHTML = ''
  const r = render(
    <FeedCaptureSheet
      open
      onClose={onClose}
      assetId="a1"
      assetSymbol="GOOGL"
      assetName="Alphabet"
      onOpenAsset={onOpenAsset}
      {...over}
    />,
  )
  return { ...r, onOpenAsset, onClose }
}

describe('the sheet is named for what it now holds', () => {
  it('titles itself for the asset rather than "Capture"', () => {
    // It is no longer only about capture, so "Capture" named a subset of what
    // is behind it.
    view()
    expect(body()).toContain('GOOGL actions')
    expect(body()).not.toContain('Attached to')
  })

  it('falls back to a generic title with no asset', () => {
    view({ assetId: null, assetSymbol: null })
    expect(body()).toContain('Actions')
  })
})

describe('opening the asset lives here now', () => {
  it('offers Open TICKER as the first entry', () => {
    view()
    const open = find('[data-slot="actions-open-asset"]')!
    expect(open).toBeTruthy()
    expect(open.textContent).toContain('Open GOOGL')
  })

  it('routes to the same destination the footer button used', () => {
    // `onOpenAsset` IS the feed's `openAsset` — same handler, same navigation,
    // same engagement semantics. Only where the reader taps it has moved.
    const { onOpenAsset, onClose } = view()
    fireEvent.click(find('[data-slot="actions-open-asset"]')!)
    expect(onOpenAsset).toHaveBeenCalledWith('a1', 'GOOGL')
    expect(onClose).toHaveBeenCalled()
  })

  it('offers no asset navigation on a tile with no asset', () => {
    // A card about a portfolio or a piece of workflow has nothing to open, and
    // fabricating a destination is worse than omitting the row.
    view({ assetId: null, assetSymbol: null })
    expect(find('[data-slot="actions-open-asset"]')).toBeNull()
  })

  it('offers none when the caller cannot navigate', () => {
    view({ onOpenAsset: undefined })
    expect(find('[data-slot="actions-open-asset"]')).toBeNull()
    // And then the attachment line comes back, because nothing above it says
    // which asset the capture will land on.
    expect(body()).toContain('Attached to')
  })
})

describe('capture is unchanged, and visibly separate', () => {
  it('still offers every capture kind', () => {
    view()
    const shown = body()
    for (const label of ['Quick thought', 'Trade idea', 'Recommendation', 'Prompt', 'Add to a list']) {
      expect(shown).toContain(label)
    }
  })

  it('keeps navigation and creation under separate headings', () => {
    // Opening the asset READS; everything below it WRITES. Run together as one
    // list of six, "Open GOOGL" reads as a seventh way to create something —
    // and a reader in a hurry taps by position.
    view()
    const shown = body()
    expect(shown).toContain('Asset')
    expect(shown).toContain('Capture')
    expect(shown.indexOf('Open GOOGL')).toBeLessThan(shown.indexOf('Quick thought'))
  })

  it('hides asset-scoped capture kinds when there is no asset', () => {
    view({ assetId: null, assetSymbol: null })
    expect(body()).not.toContain('Add to a list')
  })
})
