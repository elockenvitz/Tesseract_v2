import { upsidePct } from '../mobile/exploration'
import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * ONE price per signal instance, and every number on the card derived from it.
 *
 * ── The defect this exists to make impossible ─────────────────────────────
 *
 * A `target_expired` card on GOOGL drew a chart ending at $348.06 and, two
 * swipes away, a target editor headed CURRENT PRICE $142.80 computing "+40.1%
 * vs current" off it. Same card, same instant, same word — two numbers 2.4x
 * apart.
 *
 * Neither was a bug in isolation. The chart reads `price_history_cache`, which
 * is the last close. The editor was handed `l.target.price`, which is
 * `portfolio_holdings.price` from the newest holdings snapshot — a book mark
 * that is as old as the last holdings file, and on this name that was months.
 * Two correct numbers from two tables, one of them wearing the other's label.
 *
 * `contract.ts` has named this since it was written: `snapshot_vs_live`, "would
 * compare a holdings snapshot price to a target or a live quote". The card was
 * doing precisely that, and `TargetExplorer`'s own `referenceLabel` doc says a
 * holdings mark must not be called "Current" — the call site passed "Current
 * price" anyway.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * The last close wins whenever there is one. It is a market fact about the
 * instrument, it is what the chart already draws, and it is the number a reader
 * comparing a target against the tape is looking at.
 *
 * A holdings mark is the FALLBACK, used only where nothing is cached — and when
 * it is used it says so. It is never called "Current price", because it is not
 * one, and the whole failure above was a label that hid which table a number
 * came from.
 *
 * ── Why this is pure, and separate from the fetch ─────────────────────────
 *
 * So the agreement between panes is a testable property rather than a promise.
 * `useCanonicalPrice` does the fetching; every derived figure on the card —
 * the deviation, the adjustment chips, the copy — comes back through
 * `deviationFrom` here, so there is exactly one arithmetic and no call site can
 * quietly grow a second one.
 */

export type PriceSource = 'close' | 'holdings'

export interface PriceSnapshot {
  price: number
  /** The date the price belongs to. ISO. Never "now". */
  asOf: string
  source: PriceSource
  /**
   * What to call it on screen.
   *
   * Load-bearing, not cosmetic: this is the field that stops a book mark being
   * presented as a live quote, which is the bug the module exists for.
   */
  label: string
}

const LAST_CLOSE = 'Last close'
const BOOK_MARK = 'Book mark'

export interface SnapshotInput {
  /** Daily closes for the traded symbol, ascending. As `useSymbolHistory` returns them. */
  closes?: PricePoint[] | null
  /** `portfolio_holdings.price`, the book's own mark. */
  holdingsMark?: number | null
  /** The holdings snapshot this mark came off. ISO. */
  holdingsAsOf?: string | null
}

/**
 * The one price this card is allowed to talk about, or null.
 *
 * Null rather than zero when neither source has anything: a card that cannot
 * price the name must say so rather than compute a deviation against nothing.
 * Same rule `price-availability` draws for the chart.
 */
export function resolvePriceSnapshot(input: SnapshotInput): PriceSnapshot | null {
  const closes = (input.closes ?? []).filter(
    p => Number.isFinite(p?.close) && p.close > 0 && !Number.isNaN(new Date(p.date).getTime()),
  )
  if (closes.length) {
    // Ascending by contract, but sorted rather than assumed: a caller handing
    // this a reversed series would otherwise silently price the card off the
    // OLDEST close, which looks exactly like a correct number.
    const last = [...closes].sort((a, b) => a.date.localeCompare(b.date))[closes.length - 1]
    return { price: last.close, asOf: last.date, source: 'close', label: LAST_CLOSE }
  }

  const mark = input.holdingsMark
  if (mark != null && Number.isFinite(mark) && mark > 0 && input.holdingsAsOf) {
    return { price: mark, asOf: input.holdingsAsOf, source: 'holdings', label: BOOK_MARK }
  }
  return null
}

/**
 * Where a target sits against the price, as a percentage.
 *
 * Delegates to `upsidePct` rather than reimplementing it, so the card's
 * deviation and the editor's "vs current" row cannot disagree by rounding, by
 * sign convention, or by which number is the denominator — all three of which
 * are ways two copies of this have drifted before.
 */
export function deviationFrom(target: number | null, snapshot: PriceSnapshot | null): number | null {
  return upsidePct(target, snapshot?.price ?? null)
}

/**
 * How old the snapshot is, in whole days.
 *
 * The card states this rather than implying currency. A close from Friday on a
 * Monday is not stale; one from March is, and the reader has to be able to tell
 * without opening the chart.
 */
export function snapshotAgeDays(snapshot: PriceSnapshot | null, now: number = Date.now()): number | null {
  if (!snapshot) return null
  const t = new Date(snapshot.asOf).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/**
 * The phrase a control uses for its reference row.
 *
 * "Current price" ONLY where the number really is the latest close. Anything
 * off a holdings file is named as such, which is what `TargetExplorer` asked
 * for and never got.
 */
export function referenceLabelFor(snapshot: PriceSnapshot | null): string {
  if (!snapshot) return 'No price'
  return snapshot.source === 'close' ? 'Current price' : BOOK_MARK
}
