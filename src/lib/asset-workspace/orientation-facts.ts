/**
 * The orientation band's facts, from one asset workspace read.
 *
 * ── Why this is not inline in the two surfaces ────────────────────────────
 *
 * The band renders on both the Dashboard's workspace pane and the canonical
 * Asset page, and on both it has the same job: state what the RECORD says
 * now, beside the event the reader arrived on, so the band can report a
 * divergence between the two rather than silently preferring one.
 *
 * Written twice, the two would drift, and a drift here is not cosmetic. The
 * band distinguishes four measurements on purpose -- a stated target, the
 * book's own mark, the overshoot between them, and the last close -- and a
 * surface that filled one of those slots from a different field would make
 * the band lie with the band's own careful labels on it.
 *
 * So the reshape is one function, with a test, and the surfaces pass it the
 * data they already loaded. Nothing here fetches; nothing here computes a
 * number the hook did not already compute.
 */
import type { AssetWorkspaceData } from '../../hooks/useAssetWorkspace'
import { primaryPosition, otherPositions } from '../../hooks/useAssetWorkspace'
import type { OrientationPageFacts } from '../../components/asset-v2/EntryOrientation'

/**
 * Reshape a workspace read for the band.
 *
 * `portfolioId` is the book the reader arrived from, where they arrived from
 * one: it decides which position is reported as theirs. Without it the
 * largest book stands in, which is what `primaryPosition` has always done.
 */
export function orientationFactsFrom(
  data: AssetWorkspaceData | null | undefined,
  portfolioId: string | null = null,
): OrientationPageFacts | null {
  if (!data) return null

  const primary = primaryPosition(data.positions, portfolioId)
  const others = otherPositions(data.positions, primary)
  /* Pending means waiting on a human. Status, not stage: an executed request
     is not waiting for anyone. */
  const pending = data.decisions.find(d => (d.status ?? '').toLowerCase() === 'pending') ?? null

  return {
    ladder: (data.ladder?.cases ?? []).map(c => ({ id: c.id, name: c.name, price: c.price })),
    officialTarget: data.target,
    spot: data.spot,
    /* The series is ordered oldest first, so the last close is the last
       element. Null rather than a guess when the series is empty: the band
       labels this one "price history" and must not label a mark as one. */
    spotAsOf: data.history.length ? data.history[data.history.length - 1].date : null,
    caseWrittenAt: data.caseWrittenAt ?? null,
    position: primary
      ? {
        portfolioName: primary.portfolioName,
        weightPct: primary.weightPct,
        valueUsd: primary.marketValue ?? null,
      }
      : null,
    alsoHeldIn: others.map(p => p.portfolioName),
    pending: pending
      ? {
        label: pending.action ?? 'Decision request',
        note: pending.decisionNote ?? null,
        portfolioName: pending.portfolioName ?? null,
      }
      : null,
  }
}
