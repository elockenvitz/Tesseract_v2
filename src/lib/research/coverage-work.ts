/**
 * Coverage work: what to put in front of a reader, and why it matters now.
 *
 * Shared by the Research field and Today's backfill so the two surfaces rank
 * the same names first and say the same thing about them. It reads only the
 * shared source's candidates (`coverageResearchCandidates`); which gap a name
 * has is that source's decision, never this module's.
 *
 * ── Context, not just a blank field ───────────────────────────────────────
 *
 * "No thesis" is true of fifty names on a new account and means very different
 * things across them:
 *
 *   idea     an idea is open on the name -- work is under way without its case
 *   held     the book owns it -- capital sits on reasoning nobody wrote down
 *   unheld   it is coverage and nothing more -- a real gap, and the weakest
 *
 * ── Order ─────────────────────────────────────────────────────────────────
 *
 * An open idea first, then how much of the book the name is, then the shared
 * source's own priority and score, then the ticker so the order never varies
 * between loads.
 */

import { CORE_SECTION_LABEL } from './case-state'
import type { CoverageResearchCandidate } from './coverage-research-gaps'

export type CoverageWorkContext = 'idea' | 'held' | 'unheld'

export function coverageWorkContext(c: CoverageResearchCandidate): CoverageWorkContext {
  if (c.liveIdeas.length > 0) return 'idea'
  if (c.exposure.held && c.exposure.weightPct != null && c.exposure.weightPct > 0) return 'held'
  return 'unheld'
}

export function compareCoverageWork(a: CoverageResearchCandidate, b: CoverageResearchCandidate): number {
  return (b.liveIdeas.length > 0 ? 1 : 0) - (a.liveIdeas.length > 0 ? 1 : 0)
    || (b.exposure.weightPct ?? 0) - (a.exposure.weightPct ?? 0)
    || a.priority - b.priority
    || b.score - a.score
    || a.symbol.localeCompare(b.symbol)
}

/** The structural gaps that say the same thing about every name they touch. */
export type StructuralKey = 'no_case:unheld' | 'incomplete_case' | 'long_silence'

export function structuralKeyOf(c: CoverageResearchCandidate): StructuralKey | null {
  if (c.framing === 'no_case') return coverageWorkContext(c) === 'unheld' ? 'no_case:unheld' : null
  if (c.framing === 'incomplete_case' || c.framing === 'long_silence') return c.framing
  return null
}

/**
 * The best `limit` names, in work order, capped per structural gap.
 *
 * A no-thesis name with an open idea or a position is not capped: each one is
 * a different, specific risk. Bare coverage with no thesis, a partly written
 * case and a long silence are capped, so they cannot crowd the field.
 */
export function selectCoverageWork(
  candidates: readonly CoverageResearchCandidate[],
  { limit, caps, exclude = new Set<string>() }: {
    limit: number
    caps: Record<StructuralKey, number>
    exclude?: ReadonlySet<string>
  },
): CoverageResearchCandidate[] {
  const out: CoverageResearchCandidate[] = []
  if (limit <= 0) return out
  const taken = new Map<StructuralKey, number>()
  const seen = new Set<string>()
  for (const c of [...candidates].sort(compareCoverageWork)) {
    if (out.length >= limit) break
    if (exclude.has(c.assetId) || seen.has(c.assetId)) continue
    const key = structuralKeyOf(c)
    if (key) {
      const n = taken.get(key) ?? 0
      if (n >= caps[key]) continue
      taken.set(key, n + 1)
    }
    seen.add(c.assetId)
    out.push(c)
  }
  return out
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

/** "5.4% of Tech & Consumer Growth", or null when the name is not held. */
function position(c: CoverageResearchCandidate): string | null {
  const e = c.exposure
  if (!e.held || e.weightPct == null || e.weightPct <= 0) return null
  return e.portfolioName ? `${e.weightPct.toFixed(1)}% of ${e.portfolioName}` : `${e.weightPct.toFixed(1)}% of the book`
}

/** A short label for the work, in the reader's words. */
export function coverageWorkLabel(c: CoverageResearchCandidate): string {
  switch (c.framing) {
    case 'new_evidence': return 'New research'
    case 'price_move': return 'Moved since review'
    case 'incomplete_case': return 'Incomplete thesis'
    case 'long_silence': return 'Review due'
    case 'no_case': {
      const ctx = coverageWorkContext(c)
      return ctx === 'idea' ? 'Idea without a case' : ctx === 'held' ? 'Position without a thesis' : 'No thesis on file'
    }
  }
}

/**
 * Why this name deserves work now, as one sentence from the rule's facts.
 *
 * `weightShown`: the surface already leads with the position weight and book
 * (Research's gap tiles do), so the sentence says why it matters without
 * reading the same figure out again.
 */
export function coverageWorkClaim(c: CoverageResearchCandidate, { weightShown = false }: { weightShown?: boolean } = {}): string {
  const t = c.symbol
  const f = c.facts
  const where = position(c)
  const since = f.anchoredOn === 'reviewed' ? 'reviewed' : 'written'
  switch (c.framing) {
    case 'no_case': {
      const ctx = coverageWorkContext(c)
      if (ctx === 'idea') {
        const n = c.liveIdeas.length
        const ideas = n === 1 ? 'an open idea' : `${n} open ideas`
        if (where && weightShown) return `${t} is being worked without a written case: ${ideas}, on a live position.`
        return where
          ? `${t} is being worked without a written case: ${ideas}, and ${where}.`
          : `${t} is being worked without a written case: ${ideas}, and no thesis behind it.`
      }
      if (ctx === 'held') {
        if (weightShown) return `A live position with no written thesis behind it.`
        const w = (c.exposure.weightPct ?? 0).toFixed(1)
        return c.exposure.portfolioName
          ? `A ${w}% position in ${c.exposure.portfolioName} with no written thesis.`
          : `A ${w}% position with no written thesis.`
      }
      return `${t} is on your coverage with no thesis yet.`
    }
    case 'incomplete_case': {
      const missing = f.missingSections.map(s => (CORE_SECTION_LABEL[s] ?? s).toLowerCase()).join(' and ')
      if (where && weightShown) return `The ${t} case is missing ${missing}, on a live position.`
      return where ? `The ${t} case is missing ${missing}, with ${where} behind it.` : `The ${t} case is missing ${missing}.`
    }
    case 'price_move':
      return `${t} has moved ${pct(f.movePct ?? 0)} since the thesis was ${since}${where ? `, and it is ${where}` : ''}.`
    case 'new_evidence': {
      const n = f.evidenceSince.length
      return `${n} new research item${n === 1 ? '' : 's'} on ${t} since the thesis was ${since}.`
    }
    case 'long_silence':
      return `The ${t} thesis has not been ${since === 'reviewed' ? 'reviewed' : 'revisited'} in ${f.daysSinceReview != null ? `${f.daysSinceReview} days` : 'over 90 days'}${where ? `, with ${where} behind it` : ''}.`
  }
}
