/**
 * Today's thin-feed backfill: coverage work as ordinary Today items.
 *
 * Today renders `TodayItem`s adapted from engine `DecisionItem`s. When the
 * engine's own findings leave Today thin, the reader's coverage research gaps
 * are expressed in that same shape -- a finding with a ticker, a severity, a
 * claim, metrics and the engine's own "update thesis" action -- so they go
 * through `adaptDecisionItem` and render in `TodayTile` exactly like anything
 * else: same geometry, same focus hand-off into the Research workspace, same
 * dismiss and snooze.
 *
 * Nothing here decides which names have which gap (the shared source) or which
 * matter most (lib/research/coverage-work). This only says it in Today's shape
 * and decides how many Today can use.
 *
 * ── How many ──────────────────────────────────────────────────────────────
 *
 * Real findings always come first and are never displaced. Coverage work only
 * tops a thin morning up to `TODAY_COVERAGE_TARGET` items, so it disappears on
 * its own as real findings arrive: four real findings leave no room for any.
 */

import type { DecisionItem, DecisionSeverity } from '../../engine/decisionEngine/types'
import type { CoverageResearchCandidate } from '../research/coverage-research-gaps'
import {
  coverageWorkClaim, coverageWorkContext, coverageWorkLabel, selectCoverageWork, type StructuralKey,
} from '../research/coverage-work'
import { TODAY_LIMIT } from './tiers'

/** A thin Today is topped up to this many items with coverage work. */
export const TODAY_COVERAGE_TARGET = 5

/** Generated Today items allowed per structural gap: Today is finite. */
export const TODAY_STRUCTURAL_CAPS: Record<StructuralKey, number> = {
  'no_case:unheld': 1,
  incomplete_case: 1,
  long_silence: 1,
}

/** Coverage titleKeys, one per shared framing. */
export const COVERAGE_TITLE_KEY: Record<CoverageResearchCandidate['framing'], string> = {
  new_evidence: 'COVERAGE_NEW_EVIDENCE',
  price_move: 'COVERAGE_PRICE_MOVE',
  no_case: 'COVERAGE_NO_THESIS',
  incomplete_case: 'COVERAGE_INCOMPLETE_THESIS',
  long_silence: 'COVERAGE_STALE_THESIS',
}

export const isCoverageTitleKey = (key: string | undefined): boolean =>
  !!key && key.startsWith('COVERAGE_')

/** Events and positions read as attention; bare coverage reads as quieter work. */
function severityFor(c: CoverageResearchCandidate): DecisionSeverity {
  if (c.framing === 'new_evidence' || c.framing === 'price_move') return 'orange'
  return coverageWorkContext(c) === 'unheld' ? 'blue' : 'yellow'
}

const VERB: Record<CoverageResearchCandidate['framing'], string> = {
  new_evidence: 'Review Evidence',
  price_move: 'Revisit Thesis',
  no_case: 'Write Thesis',
  incomplete_case: 'Finish Thesis',
  long_silence: 'Update Thesis',
}

/** One candidate as the engine-shaped finding Today already knows how to draw. */
export function coverageDecisionItem(c: CoverageResearchCandidate): DecisionItem {
  const e = c.exposure
  const held = e.held && e.weightPct != null && e.weightPct > 0
  const chips: { label: string; value: string }[] = [{ label: 'Ticker', value: c.symbol }]
  if (c.liveIdeas.length) chips.push({ label: 'Open ideas', value: String(c.liveIdeas.length) })
  if (held) chips.push({ label: 'Weight', value: `${e.weightPct!.toFixed(1)}%` })
  if (e.portfolioName && held) chips.push({ label: 'Portfolio', value: e.portfolioName })
  if (c.facts.daysSinceReview != null) chips.push({ label: 'Age', value: `${c.facts.daysSinceReview}d` })

  return {
    id: `coverage:${c.framing}:${c.assetId}`,
    surface: 'action',
    severity: severityFor(c),
    category: 'process',
    title: coverageWorkLabel(c),
    titleKey: COVERAGE_TITLE_KEY[c.framing],
    description: coverageWorkClaim(c),
    chips,
    context: {
      assetId: c.assetId,
      assetTicker: c.symbol,
      portfolioId: e.portfolioId ?? undefined,
      portfolioName: e.portfolioName ?? undefined,
      proposedWeight: held ? e.weightPct! : undefined,
    },
    ctas: [{
      label: VERB[c.framing],
      actionKey: 'OPEN_ASSET_UPDATE_THESIS',
      kind: 'primary',
      payload: { assetId: c.assetId, assetTicker: c.symbol },
    }],
    dismissible: true,
    decisionTier: 'coverage',
    sortScore: 0,
    // The review anchor, where the case has one, so a price path since the
    // thesis can be drawn honestly. A name with nothing written has no anchor.
    createdAt: c.facts.reviewAnchor ?? undefined,
  }
}

/**
 * The coverage items a thin Today should show, in work order.
 *
 * `realCount` is how many real findings surfaced; `todayAssetIds` is every
 * asset those findings (surfaced or not) concern, so a name is never raised
 * twice. `suppressed` filters out coverage items the reader dismissed or
 * snoozed, by the same key Today uses for everything else.
 */
export function coverageTodayItems(
  candidates: readonly CoverageResearchCandidate[],
  { realCount, todayAssetIds, isSuppressed = () => false }: {
    realCount: number
    todayAssetIds: ReadonlySet<string>
    isSuppressed?: (itemId: string) => boolean
  },
): DecisionItem[] {
  if (realCount >= TODAY_LIMIT) return []
  const room = TODAY_COVERAGE_TARGET - realCount
  const usable = candidates.filter(c => !isSuppressed(coverageDecisionItem(c).id))
  return selectCoverageWork(usable, { limit: room, caps: TODAY_STRUCTURAL_CAPS, exclude: todayAssetIds })
    .map(coverageDecisionItem)
}
