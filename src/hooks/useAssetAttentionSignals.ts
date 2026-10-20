import { useMemo } from 'react'
import { useAssetWorkspace } from './useAssetWorkspace'
import { useAnalystRatings } from './useAnalystRatings'
import { CORE_SECTIONS } from '../lib/desktop-research/model'
import {
  resolveWorkspaceSignals, resolveWorkspaceState,
  type WorkspaceFacts, type WorkspaceSignal, type WorkspaceState,
} from '../lib/asset-workspace/context'

export interface AssetAttentionInput {
  assetId: string
  symbol: string | null
  /** The book in scope, or null for every book the reader may see. */
  portfolioId?: string | null
  /** Covering user ids from the coverage rows the page already fetched. */
  coveringUserIds: string[]
  /** Live quote, if the page has one; falls back to the workspace close. */
  spot?: number | null
}

export interface AssetAttention {
  signals: WorkspaceSignal[]
  state: WorkspaceState
  isLoading: boolean
  ready: boolean
}

/**
 * The asset's attention signals, for one surface shown across the Asset page.
 *
 * Assembled from the SAME canonical hooks the rest of the page uses, so React
 * Query serves them from cache and this adds no read, and passed through the
 * shared pure resolver (`resolveWorkspaceSignals`) that already dedupes and
 * groups. Provenance signals are dropped here as they are on the Snapshot — a
 * claim the Decision Memory panel states beside its own data is not what an
 * attention line is for.
 *
 * Nothing here queries, derives a permission, or invents a count. A signal
 * appears only when the RLS-scoped records behind it are present in what the
 * canonical hooks returned, so a reader never sees a number for rows they are
 * not authorized to see — the isolation is the source hooks' RLS, not this.
 */
export function useAssetAttentionSignals(input: AssetAttentionInput): AssetAttention {
  const { assetId, symbol, portfolioId: _portfolioId = null, coveringUserIds, spot } = input
  const { data, isLoading } = useAssetWorkspace(assetId, symbol ?? undefined, 'overview')
  const { consensus, ratings } = useAnalystRatings({ assetId })
  const dominant = consensus[0] ?? null

  return useMemo(() => {
    const core = data.sections.filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))
    const newEvidence = data.evidence.filter(e => e.isNewSinceReview)
    const openDecisions = data.decisions.filter(d => d.decidedAt == null)
    const facts: WorkspaceFacts = {
      symbol,
      positions: data.positions.map(p => ({
        portfolioId: p.portfolioId, portfolioName: p.portfolioName, weightPct: p.weightPct ?? null,
      })),
      coveringUserIds,
      caseWrittenAt: data.caseWrittenAt,
      writtenSections: core.map(c => ({ section: c.section, updatedAt: c.updatedAt ?? null })),
      rating: dominant ? { value: dominant.value, count: dominant.count, total: ratings.length } : null,
      target: data.target,
      spot: spot ?? data.spot,
      newEvidenceCount: newEvidence.length,
      openDecisions: openDecisions.map(d => ({
        id: d.id, action: d.action ?? null, portfolioId: d.portfolioId ?? null, portfolioName: d.portfolioName ?? null,
      })),
      liveIdeaCount: data.liveIdeas.length,
      unobservedExecutionCount: 0,
      executionCount: 0,
      viewerId: null,
      arrivalIntent: null,
    }
    return {
      signals: resolveWorkspaceSignals(facts).filter(s => s.kind !== 'provenance'),
      state: resolveWorkspaceState(facts),
      isLoading,
      ready: !isLoading,
    }
  }, [data, dominant, ratings.length, coveringUserIds, spot, symbol, isLoading])
}
