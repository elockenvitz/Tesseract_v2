/**
 * Dashboard selectors — curate action items for display.
 *
 * selectTopForDashboard enforces "Rule of 6" with tier + category diversity:
 *   - Max 6 rows (fits Decision Control's tiered layout)
 *   - At least 1 capital-tier item (if any exist)
 *   - At least 1 integrity-tier item (if any exist)
 *   - At least 1 coverage-tier item (if any exist)
 *   - Category diversity: process, risk, project represented if available
 *   - Prefer highest sortScore first, then backfill by diversity
 */

import type { DecisionItem, DecisionCategory, DecisionTier } from './types'
import { compareItems } from './scoring'

const MAX_DASHBOARD_ITEMS = 6

/** Tiers that should be represented if available */
const DIVERSITY_TIERS: DecisionTier[] = ['capital', 'integrity', 'coverage']

/** Categories that should be represented if available */
const DIVERSITY_CATEGORIES: DecisionCategory[] = ['process', 'risk', 'project']

export function selectTopForDashboard(actionItems: DecisionItem[]): DecisionItem[] {
  if (actionItems.length <= MAX_DASHBOARD_ITEMS) return actionItems

  // Items are already sorted by sortScore desc from postprocess.
  const selected: DecisionItem[] = []
  const usedIds = new Set<string>()

  // Pass 1: Take top 2 highest-score items regardless of tier/category
  for (const item of actionItems) {
    if (selected.length >= 2) break
    selected.push(item)
    usedIds.add(item.id)
  }

  // Pass 2: Ensure tier diversity — at least 1 from each tier
  const representedTiers = new Set(selected.map(i => i.decisionTier).filter(Boolean))

  for (const tier of DIVERSITY_TIERS) {
    if (representedTiers.has(tier)) continue
    if (selected.length >= MAX_DASHBOARD_ITEMS) break

    const candidate = actionItems.find(
      i => i.decisionTier === tier && !usedIds.has(i.id),
    )
    if (candidate) {
      selected.push(candidate)
      usedIds.add(candidate.id)
      representedTiers.add(tier)
    }
  }

  // Pass 3: Ensure category diversity — process, risk, project
  const representedCategories = new Set(selected.map(i => i.category))

  for (const category of DIVERSITY_CATEGORIES) {
    if (representedCategories.has(category)) continue
    if (selected.length >= MAX_DASHBOARD_ITEMS) break

    const candidate = actionItems.find(
      i => i.category === category && !usedIds.has(i.id),
    )
    if (candidate) {
      selected.push(candidate)
      usedIds.add(candidate.id)
      representedCategories.add(category)
    }
  }

  // Pass 4: Fill remaining slots by sortScore order
  for (const item of actionItems) {
    if (selected.length >= MAX_DASHBOARD_ITEMS) break
    if (usedIds.has(item.id)) continue
    selected.push(item)
    usedIds.add(item.id)
  }

  // Re-sort by sortScore (deterministic) for visual consistency
  selected.sort(compareItems)

  return selected
}
