/**
 * Post-processing for the Global Decision Engine.
 *
 * 1. Deduplication by composite key
 * 2. Conflict prevention (suppress contradictory items)
 * 3. Sort score computation (tier-aware via scoring.ts)
 * 4. Rollup aggregation (collapse repetitive items into parents)
 * 5. Final ordering (deterministic)
 */

import type { DecisionItem, DecisionSeverity } from './types'
import {
  SEVERITY_WEIGHT,
  CATEGORY_WEIGHT,
  computeSortScore,
  compareItems,
} from './scoring'

// Re-export for backward compatibility
export { SEVERITY_WEIGHT, CATEGORY_WEIGHT }

// ---------------------------------------------------------------------------
// Rollup configuration
// ---------------------------------------------------------------------------

interface RollupConfig {
  titleKey: string
  minCount: number
  makeTitle: (count: number) => string
  makeDescription: (children: DecisionItem[], now: Date) => string
  ctaLabel: string
  ctaActionKey: string
  ctaPayload?: (children: DecisionItem[]) => Record<string, any>
}

const ROLLUP_CONFIGS: RollupConfig[] = [
  {
    titleKey: 'PROPOSAL_AWAITING_DECISION',
    minCount: 2,
    makeTitle: (n) => `${n} proposals awaiting decision`,
    makeDescription: (children, now) => {
      const oldest = oldestAgeDays(children, now)
      return `Oldest waiting ${oldest} days.`
    },
    ctaLabel: 'Review all',
    ctaActionKey: 'OPEN_TRADE_QUEUE_FILTERED',
    ctaPayload: () => ({ filter: 'awaiting_decision' }),
  },
  {
    titleKey: 'THESIS_STALE',
    minCount: 3,
    makeTitle: (n) => `${n} theses may be stale`,
    makeDescription: (children, now) => {
      const oldest = oldestAgeDays(children, now)
      return `Oldest ${oldest} days since update.`
    },
    ctaLabel: 'Review',
    ctaActionKey: 'OPEN_ASSET_REVIEW_SEQUENCE',
    ctaPayload: (children) => ({
      assetIds: children.map(c => c.context.assetId).filter(Boolean),
    }),
  },
  {
    titleKey: 'IDEA_NOT_SIMULATED',
    minCount: 3,
    makeTitle: (n) => `${n} ideas not simulated`,
    makeDescription: (children, now) => {
      const oldest = oldestAgeDays(children, now)
      return `Oldest waiting ${oldest} days.`
    },
    ctaLabel: 'Simulate all',
    ctaActionKey: 'OPEN_TRADE_QUEUE_FILTER',
    ctaPayload: () => ({ filter: 'unsimulated' }),
  },
]

function oldestAgeDays(items: DecisionItem[], now: Date): number {
  let oldest = 0
  for (const item of items) {
    if (!item.createdAt) continue
    const age = Math.floor((now.getTime() - new Date(item.createdAt).getTime()) / 86400000)
    if (age > oldest) oldest = age
  }
  return oldest
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function dedupKey(item: DecisionItem): string {
  // Extract evaluator prefix (e.g. "a1-proposal", "i1-rating", "thesis-stale")
  // to distinguish different signal types for the same entity + category.
  const parts = item.id.split('-')
  const signalType = parts.slice(0, 2).join('-')
  return [
    signalType,
    item.category,
    item.context.assetId ?? '',
    item.context.proposalId ?? '',
    item.context.tradeIdeaId ?? '',
    item.context.projectId ?? '',
  ].join(':')
}

function dedup(items: DecisionItem[]): DecisionItem[] {
  const seen = new Map<string, DecisionItem>()
  for (const item of items) {
    const key = dedupKey(item)
    const existing = seen.get(key)
    // Keep higher severity item
    if (!existing || SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[existing.severity]) {
      seen.set(key, item)
    }
  }
  return Array.from(seen.values())
}

// ---------------------------------------------------------------------------
// Conflict prevention
// ---------------------------------------------------------------------------

function removeConflicts(items: DecisionItem[]): DecisionItem[] {
  // Index by asset for fast lookup
  const byAsset = new Map<string, DecisionItem[]>()
  for (const item of items) {
    const assetId = item.context.assetId
    if (!assetId) continue
    const list = byAsset.get(assetId) || []
    list.push(item)
    byAsset.set(assetId, list)
  }

  const suppressedIds = new Set<string>()

  for (const [, assetItems] of byAsset) {
    const hasExecutionPending = assetItems.some(i => i.id.startsWith('a2-execution-'))
    const hasIdea = assetItems.some(
      i => i.id.startsWith('a1-proposal-') ||
           i.id.startsWith('a2-execution-') ||
           i.id.startsWith('a3-unsimulated-'),
    )

    for (const item of assetItems) {
      // If proposal exists for this asset, suppress "no active idea" intel
      if (hasIdea && item.id.startsWith('i3-ev-')) {
        suppressedIds.add(item.id)
      }

      // If execution pending, suppress "proposal awaiting decision" for same trade
      if (hasExecutionPending && item.id.startsWith('a1-proposal-')) {
        // Only suppress if same trade idea
        const execItem = assetItems.find(
          i => i.id.startsWith('a2-execution-') &&
               i.context.tradeIdeaId === item.context.tradeIdeaId,
        )
        if (execItem) {
          suppressedIds.add(item.id)
        }
      }

      // Note: rating-no-followup is NOT suppressed by proposal-awaiting.
      // They are independent signals — a stalled proposal doesn't imply
      // the rating change was followed up on.
    }
  }

  return items.filter(i => !suppressedIds.has(i.id))
}

// ---------------------------------------------------------------------------
// Rollup aggregation
// ---------------------------------------------------------------------------

function portfolioBreakdownChips(children: DecisionItem[]): { label: string; value: string }[] {
  const counts = new Map<string, number>()
  for (const child of children) {
    const name = child.context.portfolioName || 'Unknown'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  // Sort by count desc
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  return entries.map(([name, count]) => ({ label: name, value: String(count) }))
}

export function rollupItems(items: DecisionItem[], now: Date): DecisionItem[] {
  const result: DecisionItem[] = []
  const consumed = new Set<string>()

  for (const config of ROLLUP_CONFIGS) {
    const candidates = items.filter(
      i => i.titleKey === config.titleKey && !consumed.has(i.id),
    )

    if (candidates.length >= config.minCount) {
      // Mark all candidates as consumed
      for (const c of candidates) consumed.add(c.id)

      // Highest severity among children
      let maxSeverity: DecisionSeverity = 'gray'
      for (const c of candidates) {
        if (SEVERITY_WEIGHT[c.severity] > SEVERITY_WEIGHT[maxSeverity]) {
          maxSeverity = c.severity
        }
      }

      // Compute rollup sort score: use max child score + small bonus for count
      let maxScore = 0
      for (const c of candidates) {
        if (c.sortScore > maxScore) maxScore = c.sortScore
      }

      const rollupItem: DecisionItem = {
        id: `rollup-${config.titleKey.toLowerCase().replace(/_/g, '-')}`,
        surface: candidates[0].surface,
        severity: maxSeverity,
        category: candidates[0].category,
        title: config.makeTitle(candidates.length),
        titleKey: config.titleKey,
        description: config.makeDescription(candidates, now),
        chips: portfolioBreakdownChips(candidates),
        context: {},
        ctas: [{
          label: config.ctaLabel,
          actionKey: config.ctaActionKey,
          kind: 'primary' as const,
          payload: config.ctaPayload?.(candidates),
        }],
        dismissible: false,
        children: candidates,
        decisionTier: candidates[0].decisionTier,
        sortScore: maxScore + candidates.length * 10,
        createdAt: candidates[0].createdAt,
      }

      result.push(rollupItem)
    }
  }

  // Add unconsumed items
  for (const item of items) {
    if (!consumed.has(item.id)) {
      result.push(item)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Main postprocess pipeline
// ---------------------------------------------------------------------------

export function postprocess(
  items: DecisionItem[],
  now: Date = new Date(),
): { actionItems: DecisionItem[]; intelItems: DecisionItem[] } {
  // 1. Dedup
  let processed = dedup(items)

  // 2. Conflict prevention
  processed = removeConflicts(processed)

  // 3. Compute sort scores (tier-aware)
  for (const item of processed) {
    item.sortScore = computeSortScore(item, now)
  }

  // 4. Rollup aggregation (action items only — intel stays flat)
  const actionCandidates = processed.filter(i => i.surface === 'action')
  const intelCandidates = processed.filter(i => i.surface === 'intel')
  const rolledUpActions = rollupItems(actionCandidates, now)

  // 5. Sort deterministically (tier → severity → age → tiebreaker)
  rolledUpActions.sort(compareItems)
  intelCandidates.sort(compareItems)

  return { actionItems: rolledUpActions, intelItems: intelCandidates }
}
