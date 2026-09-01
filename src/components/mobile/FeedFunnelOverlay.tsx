import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where a category's cards go, counted at every stage of the pipeline.
 *
 * ── Why counts and not cards ──────────────────────────────────────────────
 *
 * Twice now a Portfolio card has been correct at both ends of the pipeline and
 * absent from the screen, because the object being filtered is an ENTRY and an
 * entry does not carry what the classifier needs until somebody puts it there.
 * Each time, the question that would have answered it in one screenshot was
 * "how many survived each stage" — and each time it was answered by reading
 * code instead, once wrongly.
 *
 * So this reports six numbers per category and nothing else. It renders no
 * card content, holds no card references, and cannot alter what the feed
 * decides: the counts are handed to it after each stage has already run.
 *
 * ── Gating ────────────────────────────────────────────────────────────────
 *
 * `import.meta.env.DEV` AND `?feedfunnel=1`, the convention
 * `OverflowAuditOverlay` established and `ChartGeometryOverlay` reused. The
 * build gate means it cannot exist in production; the URL flag is what makes
 * it readable from a phone rather than only from a desktop console.
 *
 * Temporary. It comes out with the investigation it serves.
 */

export interface FeedFunnelCounts {
  /** Every entry the producers made, before anything is dropped. */
  produced: number
  /** After `suppressCoveredInsights` and the attention dedupe. */
  deduped: number
  /** After the Curate sheet's facets and the one-tap chip. */
  filtered: number
  /** After `rankFeed` and, in the mixed feed only, `diversify`. */
  ranked: number
  /** Whether the mixed-feed diversity pass was allowed to run. */
  diversityEnabled: boolean
  /** Per category, after ranking. */
  byCategory: Record<string, number>
  /** Per signal type / capital issue, after ranking. */
  byFamily: Record<string, number>
  /** What the reader has selected, for reading the numbers above. */
  selected: { categories: string[]; signalTypes: string[]; chip: string | null }
}

export function FeedFunnelOverlay({ counts }: { counts: FeedFunnelCounts | null }) {
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    setOn(new URLSearchParams(window.location.search).get('feedfunnel') === '1')
  }, [])

  if (!import.meta.env.DEV || !on || !counts) return null

  const Row = ({ k, v }: { k: string; v: string | number }) => (
    <div className="flex gap-2 leading-[1.3]">
      <span className="w-[132px] shrink-0 truncate opacity-70">{k}</span>
      <span className="min-w-0 flex-1 truncate font-bold tabular-nums">{v}</span>
    </div>
  )

  const entries = (r: Record<string, number>) =>
    Object.entries(r).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      <div
        className="absolute left-1 right-1 top-1 rounded bg-black/85 px-2 py-1.5 text-[9px] font-medium text-white"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <div className="mb-1 border-b border-white/25 pb-1 text-[10px] font-bold">
          feed funnel
          <div className="font-medium opacity-80">
            categories [{counts.selected.categories.join(', ') || '—'}]
            {' · types ['}{counts.selected.signalTypes.join(', ') || '—'}]
            {' · chip '}{counts.selected.chip ?? '—'}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <div>
            <Row k="produced" v={counts.produced} />
            <Row k="after dedupe" v={counts.deduped} />
            <Row k="after filters" v={counts.filtered} />
            <Row k="after rank" v={counts.ranked} />
            <Row k="diversity ran" v={String(counts.diversityEnabled)} />
          </div>
          <div>
            <div className="opacity-70">by category</div>
            {entries(counts.byCategory).map(([k, n]) => <Row key={k} k={k} v={n} />)}
          </div>
        </div>
        <div className="mt-1 border-t border-white/25 pt-1">
          <div className="opacity-70">by family</div>
          <div className="grid grid-cols-2 gap-x-3">
            {entries(counts.byFamily).map(([k, n]) => <Row key={k} k={k} v={n} />)}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
