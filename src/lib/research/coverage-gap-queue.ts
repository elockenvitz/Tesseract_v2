/**
 * The Research lens's work queue over coverage research gaps.
 *
 * Presentation only. Which names qualify and why is decided upstream
 * (`coverageResearchCandidates`, over the shared research scan); this turns
 * that list into what Research shows: one summary, a short ranked queue, and
 * labels and actions written for Research rather than for a feed card.
 *
 * ── Why a queue and not a gallery ─────────────────────────────────────────
 *
 * A fresh account covers fifty names and has written nothing, so every one of
 * them is "no thesis". Fifty tiles saying the same thing is not a work queue,
 * it is the same sentence fifty times. The summary states the size of the gap
 * once; the queue shows where to start.
 */

import { CORE_SECTION_LABEL, type ResearchFraming } from './case-state'
import { COVERAGE_GAP_PRIORITY, type CoverageResearchCandidate } from './coverage-research-gaps'

/** Rows shown before "View all". */
export const GAP_QUEUE_LIMIT = 8

/** What Research calls each gap. Canonical order, strongest first. */
export const GAP_LABEL: Record<ResearchFraming, string> = {
  new_evidence: 'New evidence',
  price_move: 'Price moved since review',
  no_case: 'No thesis',
  incomplete_case: 'Incomplete thesis',
  long_silence: 'Stale',
}

/** The one action each gap asks for. Always opens the asset's Research view. */
export const GAP_ACTION: Record<ResearchFraming, string> = {
  new_evidence: 'Review evidence',
  price_move: 'Revisit thesis',
  no_case: 'Write thesis',
  incomplete_case: 'Finish thesis',
  long_silence: 'Review thesis',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The summary line for one kind of gap, or for a mix. */
export function gapSummary(candidates: readonly CoverageResearchCandidate[]): string {
  const n = candidates.length
  const names = plural(n, 'covered name')
  const kinds = new Set(candidates.map(c => c.framing))
  if (kinds.size !== 1) return `${names} need research`
  const need = n === 1 ? 'needs' : 'need'
  const have = n === 1 ? 'has' : 'have'
  switch ([...kinds][0]) {
    case 'new_evidence': return `${names} ${have} new evidence to review`
    case 'price_move': return `${names} moved since the thesis was reviewed`
    case 'no_case': return `${names} ${need} a thesis`
    case 'incomplete_case': return `${names} ${have} an incomplete thesis`
    case 'long_silence': return `${names} ${have} not been reviewed in 90+ days`
  }
}

/** The gap, in Research's words, from the facts the rule produced. */
export function gapDetail(c: CoverageResearchCandidate): string {
  const f = c.facts
  const since = f.anchoredOn === 'reviewed' ? 'reviewed' : 'written'
  switch (c.framing) {
    case 'new_evidence': {
      const n = f.evidenceSince.length
      return `${plural(n, 'new item')} since the thesis was ${since}`
    }
    case 'price_move': {
      const m = f.movePct ?? 0
      return `${m >= 0 ? 'Up' : 'Down'} ${Math.abs(m).toFixed(1)}% since the thesis was ${since}`
    }
    case 'no_case':
      return 'Nothing written yet'
    case 'incomplete_case':
      return `Missing ${f.missingSections.map(s => CORE_SECTION_LABEL[s] ?? s).join(', ').toLowerCase()}`
    case 'long_silence':
      return f.daysSinceReview != null ? `Not reviewed in ${f.daysSinceReview} days` : 'Not reviewed in 90+ days'
  }
}

/** Exposure and live-idea context, or null when there is none to state. */
export function gapContext(c: CoverageResearchCandidate): string | null {
  const parts: string[] = []
  const e = c.exposure
  if (e.held && e.weightPct != null) {
    parts.push(e.portfolioName ? `${e.weightPct.toFixed(1)}% of ${e.portfolioName}` : `${e.weightPct.toFixed(1)}% held`)
    if (e.portfolioCount > 1) parts.push(`in ${e.portfolioCount} books`)
  } else if (!e.held) {
    parts.push('Not held')
  }
  if (c.liveIdeas.length) parts.push(plural(c.liveIdeas.length, 'open idea'))
  return parts.length ? parts.join(' · ') : null
}

/**
 * Queue order: the canonical priority and score first, then the context that
 * makes a gap more pressing among equals -- an open idea on the name, then how
 * much of it is held -- then the ticker, so the order never varies between loads.
 */
export function compareGapRows(a: CoverageResearchCandidate, b: CoverageResearchCandidate): number {
  return a.priority - b.priority
    || b.score - a.score
    || b.liveIdeas.length - a.liveIdeas.length
    || (b.exposure.weightPct ?? 0) - (a.exposure.weightPct ?? 0)
    || a.symbol.localeCompare(b.symbol)
}

export interface GapGroup {
  framing: ResearchFraming
  label: string
  /** Every candidate of this kind, not just the ones shown. */
  total: number
  rows: CoverageResearchCandidate[]
}

export interface GapQueue {
  summary: string
  total: number
  /** Count per kind, canonical order, kinds with none omitted. */
  counts: { framing: ResearchFraming; label: string; count: number }[]
  /** The rows to mount, grouped under their label in canonical order. */
  groups: GapGroup[]
  /** How many are not shown. Zero when showing all. */
  hidden: number
}

export function buildGapQueue(
  candidates: readonly CoverageResearchCandidate[],
  { showAll = false, limit = GAP_QUEUE_LIMIT }: { showAll?: boolean; limit?: number } = {},
): GapQueue {
  const ordered = [...candidates].sort(compareGapRows)
  const shown = showAll ? ordered : ordered.slice(0, limit)
  const counts = COVERAGE_GAP_PRIORITY
    .map(framing => ({ framing, label: GAP_LABEL[framing], count: ordered.filter(c => c.framing === framing).length }))
    .filter(c => c.count > 0)
  const groups = counts
    .map(({ framing, label, count }) => ({ framing, label, total: count, rows: shown.filter(c => c.framing === framing) }))
    .filter(g => g.rows.length > 0)
  return { summary: gapSummary(ordered), total: ordered.length, counts, groups, hidden: ordered.length - shown.length }
}
