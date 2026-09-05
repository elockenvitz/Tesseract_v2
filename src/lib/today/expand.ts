/**
 * Today — object-level expansion.
 *
 * ── The defect this exists to fix ─────────────────────────────────────────
 *
 * `postprocess.ts` collapses repetitive findings into synthetic parents before
 * anything downstream sees them. Three configs do it today: PROPOSAL_AWAITING
 * _DECISION at 2+, THESIS_STALE at 3+, IDEA_NOT_SIMULATED at 3+. Each parent
 * gets `id: rollup-<key>`, `title: "7 theses may be stale"`, a "Review all"
 * CTA — and, critically, **`context: {}`**.
 *
 * That empty context is why the surface degraded so badly. `fromDecisionContext`
 * has no object to bind, so the target is null, so Ask AI and Discuss vanish;
 * the chips become `portfolioBreakdownChips`, which emit
 * `{ label: portfolioName || 'Unknown', value: count }` — the literal `7 /
 * UNKNOWN` metric on screen; and the CTA becomes a batch verb that acts on
 * everything at once, which is not what Today is for.
 *
 * The rollup is right for a dashboard summarising a queue. It is wrong for a
 * surface whose unit is ONE object, ONE issue, ONE next action.
 *
 * ── Why expand rather than disable the rollup ─────────────────────────────
 *
 * The rollup is shared: the old Dashboard and other consumers read the same
 * `selectForDashboard()` output and want the parents. Turning it off would
 * change those surfaces, which is out of scope and would be a regression for
 * them. So Today unwraps for itself, exactly as `flattenForFilter` already
 * unwraps for the asset and portfolio views. Nothing upstream changes.
 */

import type { DecisionItem } from '../../engine/decisionEngine/types'

/** A rollup parent is any item carrying children. */
export function isAggregate(item: DecisionItem): boolean {
  return !!item.children?.length
}

/** How many findings a given evaluator produced, for quiet provenance. */
export interface AggregateNote {
  titleKey: string
  /** The parent's own wording — "7 theses may be stale". */
  title: string
  count: number
}

export interface ExpandedCandidates {
  /** Object-level items only. No parent ever survives. */
  items: DecisionItem[]
  /** What was rolled up, so the surface can say so without showing a tile. */
  aggregates: AggregateNote[]
}

/**
 * Replace every rollup parent with the individual findings it consumed.
 *
 * The children are the untouched evaluator items: real `context.assetId`, real
 * `assetTicker`, real per-object CTAs. Nothing is reconstructed — the data was
 * always there, one level down.
 *
 * A parent is never kept alongside its children, because it would compete for a
 * slot with the very objects it describes and would win on the score the
 * rollup inflated (`maxScore + count * 10`).
 */
export function expandToObjects(items: DecisionItem[]): ExpandedCandidates {
  const out: DecisionItem[] = []
  const aggregates: AggregateNote[] = []

  for (const item of items) {
    if (isAggregate(item)) {
      aggregates.push({
        titleKey: item.titleKey ?? 'unknown',
        title: item.title,
        count: item.children!.length,
      })
      // Children may themselves be rollups in principle; recurse so the
      // invariant "no aggregate survives" holds at any depth.
      const nested = expandToObjects(item.children!)
      out.push(...nested.items)
      aggregates.push(...nested.aggregates)
      continue
    }
    out.push(item)
  }

  return { items: out, aggregates }
}
