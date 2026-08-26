import { useMemo } from 'react'

import { PricePane } from '../signals/PricePane'
import { TargetExpiredPanes } from '../signals/TargetExpiredPanes'
import type { ReviseTargetValue } from '../signals/ReviseTargetEditor'
import type { PriceBand, PriceMarker, PricePoint } from '../signals/PriceContext'
import type { VerdictOption } from '../signals/VerdictBar'
import type { SignalCard } from '../../lib/signals/contract'
import type { StaleTarget } from '../../hooks/mobile/usePortfolioLenses'
import { useCanonicalPrice } from '../../hooks/mobile/useCanonicalPrice'

/**
 * The expired-target card in the feed: the fetch, wrapped around the panes.
 *
 * ── Why this kind is a component and the other four are not ───────────────
 *
 * Because every number on it has to come from ONE price, and a price is a
 * fetch, and a fetch is a hook — which cannot live inside a `.map` over a
 * variable-length list of lens entries. Assembled inline like the others, the
 * chart pane fetched closes for its own chart while the editor beside it used
 * the holdings mark the lens carried down: $348.06 and $142.80 on one GOOGL
 * card, both labelled "current".
 *
 * `useCanonicalPrice` resolves it once and every pane reads that object. It
 * costs no extra request — `PricePane` calls the same react-query key, so the
 * chart and this component share one cache entry by construction rather than by
 * anyone remembering to keep them in step. See `price-snapshot`.
 *
 * The composition itself is in `TargetExpiredPanes`, which has no Supabase
 * import and is therefore the part the gallery can render too.
 */

interface TargetExpiredCardProps {
  card: SignalCard
  stale: StaleTarget
  /** Already resolved through the ticker aliases. */
  tradedSymbol: string
  /** Records the judgment and writes the note. Returns false if it did not stick. */
  onRespond: (option: VerdictOption) => Promise<boolean> | boolean
  /** Save a new target AND a fresh horizon. Both editing paths land here. */
  onSaveTarget: (value: ReviseTargetValue) => Promise<void> | void
  /** Open `MobileCaseTargets` — the existing Bull / Base / Bear editor. */
  onOpenCases: () => void
  /** Open the capture sheet with a review note seeded. */
  onAddNote: () => void
  onExpandChart: (series: PricePoint[], bands: PriceBand[], markers: PriceMarker[]) => void
  resolveNext?: (option: VerdictOption) => { label: string; run: () => void } | null
  /**
   * Renders the card shell around the panes.
   *
   * Supplied by the feed rather than reimplemented, so this component owns the
   * card's CONTENT and none of its plumbing — dwell tracking, dispositions,
   * capture routing, feedback and navigation all stay in one place.
   */
  render: (
    panes: { id: string; label: string; content: React.ReactNode }[],
    opts: {
      onPaneChange: (paneId: string) => void
      primaryOverride: { id: string; label: string; disabled?: boolean } | null
    },
  ) => React.ReactNode
}

export function TargetExpiredCard({
  card, stale, tradedSymbol, onRespond, onSaveTarget, onOpenCases, onAddNote,
  onExpandChart, resolveNext, render,
}: TargetExpiredCardProps) {
  /**
   * The holdings mark is passed as a FALLBACK, not as the answer.
   *
   * Used only where nothing is cached for the name, and when it is used it
   * renders as "Book mark" rather than as "Current price". That labelling is
   * the whole point: the defect was never that a book price appeared, it was
   * that it appeared wearing the live price's name.
   */
  const { snapshot } = useCanonicalPrice(tradedSymbol, {
    holdingsMark: stale.price,
    holdingsAsOf: stale.asOf,
  })

  const bands = useMemo<PriceBand[]>(
    () => [{ label: 'Target', price: stale.target, kind: 'target' }],
    [stale.target],
  )
  const markers = useMemo<PriceMarker[]>(
    () => [{ date: stale.expiredAt, label: 'Horizon', kind: 'horizon' }],
    [stale.expiredAt],
  )

  return (
    <TargetExpiredPanes
      subject={{
        symbol: stale.symbol,
        target: stale.target,
        timeframe: stale.timeframe,
        statedAt: stale.statedAt,
        expiredAt: stale.expiredAt,
      }}
      question={card.prompt ?? 'Is this target still your view?'}
      snapshot={snapshot}
      pricePane={(
        <PricePane
          symbol={tradedSymbol}
          bands={bands}
          markers={markers}
          /* The decision figure, not the window return. The card is about
             whether a target still stands, so how far the price is from it
             leads and "up 12% since May" is demoted to the axis row. */
          compareTo="Target"
          onExpand={series => onExpandChart(series, bands, markers)}
        />
      )}
      onRespond={onRespond}
      onSaveTarget={onSaveTarget}
      onOpenCases={onOpenCases}
      onAddNote={onAddNote}
      resolveNext={resolveNext}
    >
      {({ panes, onPaneChange, primaryOverride }) =>
        render(panes, { onPaneChange, primaryOverride })}
    </TargetExpiredPanes>
  )
}
