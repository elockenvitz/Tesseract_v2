/**
 * Where each cell of the asset header's context strip takes the reader.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * The strip states five facts — the firm rating, the price target, our
 * exposure, the open work and how fresh the case is. Pressing one called
 * `onOpen(subPage)`, which set the sub-page and stopped. For the three cells
 * that point into Research that meant landing wherever Research happened to
 * be scrolled to.
 *
 * Measured on AMZN at 1920: pressing "Firm rating" switched to Research and
 * left the Rating card at y=701 — 420px below the top of the content area and
 * partly past the fold — with the scroller at 328 of 1939, which was simply
 * the position Research was already at. Nothing scrolled, because nothing
 * asked it to.
 *
 * ── Why a table, and why it lives here ───────────────────────────────────
 *
 * The strip should not know where anything is drawn; it knows which FACT it
 * is stating. The page knows where that fact is written. So the strip emits a
 * cell name and this table turns it into a destination, which keeps the two
 * decisions — "what did they press" and "where does that live" — separable
 * and testable without mounting the page.
 *
 * The anchors are the ones the attention band already uses
 * (`asset-warning-anchor-rating`, `-targets`, `asset-anchor-thesis`), so this
 * adds no new routing and no element that did not already exist.
 */

import type { AssetSubPage } from './modes'

/** A fact the strip states. One per cell, in the order they are drawn. */
export type StripCell = 'rating' | 'target' | 'exposure' | 'work' | 'case'

/**
 * A research anchor, as `AssetTab`'s attention effect names them.
 *
 * Kept as the same vocabulary rather than raw DOM ids: the effect already
 * knows that `rating` and `targets` have to force the "All" view and expand
 * the Forecasts section before their element exists, and a destination that
 * handed it an id would lose that.
 */
export type ResearchAnchor = 'thesis' | 'risks' | 'targets' | 'rating' | 'case'

export interface StripTarget {
  subPage: AssetSubPage
  /** The research anchor to scroll to, for a fact written in the case. */
  anchor?: ResearchAnchor
  /** A DOM id on the destination surface, for a fact that is not. */
  sectionId?: string
}

/**
 * The id on the Overview's "Exposure & valuation" block.
 *
 * Exported so the element and the destination cannot drift apart — the
 * section sets `anchorId={EXPOSURE_ANCHOR_ID}` from this constant.
 */
export const EXPOSURE_ANCHOR_ID = 'asset-anchor-exposure'

/**
 * Cell → destination. Total by construction.
 *
 * Three notes on the choices, because two of them changed:
 *
 *  - EXPOSURE used to open Work. Work holds the open loops — ideas, the
 *    running process, the lists this name sits in — and none of them is the
 *    position. The position is drawn on the Overview, in "Exposure &
 *    valuation": the weight bar, shares, market value, average cost,
 *    unrealised and the other books holding it. That is the place the cell
 *    names, so that is where it goes.
 *
 *  - CASE FRESHNESS points at the thesis rather than at an "age" element,
 *    because none exists: the case BEGINS at the thesis, which is the
 *    nearest truthful target. The attention band already resolves `case`
 *    this way and this keeps the two the same.
 *
 *  - ACTIVE WORK carries no anchor, deliberately. `WORK_SECTION_ID.decisions`
 *    is null and the note there explains why: the ideas are not a section you
 *    scroll to, they are rows the surface SELECTS, and arriving at Work
 *    already shows them. An anchor here would be an id nothing resolves.
 */
export const STRIP_TARGET: Record<StripCell, StripTarget> = {
  rating: { subPage: 'research', anchor: 'rating' },
  target: { subPage: 'research', anchor: 'targets' },
  exposure: { subPage: 'snapshot', sectionId: EXPOSURE_ANCHOR_ID },
  work: { subPage: 'decisions' },
  case: { subPage: 'research', anchor: 'case' },
}

/** The destination for a cell. */
export function stripTarget(cell: StripCell): StripTarget {
  return STRIP_TARGET[cell]
}

/**
 * Every cell the strip draws, in order.
 *
 * The strip maps over nothing — each cell is written out, because they hold
 * different shapes of value — so this exists for the cases to assert that the
 * table covers what is rendered rather than what someone remembered.
 */
export const STRIP_CELLS: readonly StripCell[] = ['rating', 'target', 'exposure', 'work', 'case']
