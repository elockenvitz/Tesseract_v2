/**
 * The numbers a ranking change has to be argued with.
 *
 * Each one exists because a plausible-sounding unification can break it while
 * every unit test still passes:
 *
 *   · scopedRecall        — did the reader's own names actually surface, or did
 *                           we widen retrieval and then rank them nowhere
 *   · urgentUnscopedRecall— did relevance quietly become a filter, burying an
 *                           urgent name nobody declared
 *   · suppressedLeakage   — did anything the reader dismissed come back
 *   · maxAuthorRun        — did one prolific colleague take the page
 *   · medianAgeDays       — did the feed become an archive, or stay a feed
 *
 * Reported per shell, because the shells are allowed to differ in presentation
 * and are not allowed to differ in what they consider.
 */

import type { RankSnapshot, ReplayResult, ReplayRow } from './types'

export interface RankMetrics {
  engine: string
  candidateCount: number
  suppressedCount: number
  durationMs: number
  visibleCount: number
  /** Scoped candidates that reached the top N, over scoped candidates present. */
  scopedRecall: { hit: number; of: number; pct: number }
  /** Same, for candidates the reader has no relationship to but are urgent. */
  urgentUnscopedRecall: { hit: number; of: number; pct: number }
  /** Rows present in the output that the store says are suppressed. Must be 0. */
  suppressedLeakage: number
  distinctAuthors: number
  distinctAssets: number
  maxAuthorRun: number
  medianAgeDays: number
  maxAgeDays: number
  topN: ReplayRow[]
}

const SCOPED = new Set(['direct', 'assigned', 'personal_scope', 'assigned_scope'])

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function maxRun(values: (string | null)[]): number {
  let best = 0, run = 0, prev: string | null | undefined
  for (const v of values) {
    run = v !== null && v === prev ? run + 1 : 1
    prev = v
    if (run > best) best = run
  }
  return best
}

export function metricsFor(
  result: ReplayResult,
  snap: RankSnapshot,
  n = 20,
): RankMetrics {
  const topN = result.ranked.slice(0, n)
  const inTop = new Set(topN.map(r => r.id))

  const scopedCandidates = result.ranked.filter(r => SCOPED.has(r.scope))
  const urgentUnscoped = snap.candidates.filter(
    c => (c.urgency === 'urgent' || c.urgency === 'high')
      && !result.ranked.some(r => r.id === c.id && SCOPED.has(r.scope)),
  )

  const suppressedIds = new Set(result.ranked.filter(r => r.suppressed).map(r => r.id))

  const ages = topN.map(r => (snap.context.now - new Date(r.createdAt).getTime()) / 86_400_000)

  const pct = (hit: number, of: number) => (of === 0 ? 100 : Math.round((hit / of) * 1000) / 10)
  const scopedHit = scopedCandidates.filter(r => inTop.has(r.id)).length
  const urgentHit = urgentUnscoped.filter(c => inTop.has(c.id)).length

  return {
    engine: result.engine,
    candidateCount: result.candidateCount,
    suppressedCount: result.suppressedCount,
    durationMs: result.durationMs,
    visibleCount: result.ranked.length,
    scopedRecall: { hit: scopedHit, of: scopedCandidates.length, pct: pct(scopedHit, scopedCandidates.length) },
    urgentUnscopedRecall: { hit: urgentHit, of: urgentUnscoped.length, pct: pct(urgentHit, urgentUnscoped.length) },
    suppressedLeakage: [...inTop].filter(id => suppressedIds.has(id)).length,
    distinctAuthors: new Set(topN.map(r => r.authorId)).size,
    distinctAssets: new Set(topN.map(r => r.assetSymbol).filter(Boolean)).size,
    maxAuthorRun: maxRun(topN.map(r => r.authorId)),
    medianAgeDays: Math.round(median(ages) * 10) / 10,
    // The median says whether the feed is a feed; the max says whether the
    // oldest thing that reached the page had a reason to be there.
    maxAgeDays: ages.length ? Math.round(Math.max(...ages) * 10) / 10 : 0,
    topN,
  }
}

/** How much two ranked lists agree at the head, which is what a reader meets. */
export function overlapAt(a: ReplayRow[], b: ReplayRow[], n = 10): number {
  const left = new Set(a.slice(0, n).map(r => r.id))
  return b.slice(0, n).filter(r => left.has(r.id)).length
}

/** Rows that moved, so a report can explain each one rather than list all. */
export function movements(before: ReplayRow[], after: ReplayRow[], n = 20) {
  const beforeIndex = new Map(before.map((r, i) => [r.id, i]))
  const afterIndex = new Map(after.map((r, i) => [r.id, i]))
  const ids = new Set([...before.slice(0, n).map(r => r.id), ...after.slice(0, n).map(r => r.id)])

  return [...ids].map(id => {
    const from = beforeIndex.has(id) ? beforeIndex.get(id)! : null
    const to = afterIndex.has(id) ? afterIndex.get(id)! : null
    return {
      id,
      from,
      to,
      delta: from !== null && to !== null ? from - to : null,
      status: from === null ? 'entered' : to === null ? 'left' : from === to ? 'held' : 'moved',
      reasons: after.find(r => r.id === id)?.reasons ?? [],
    }
  }).sort((x, y) => (x.to ?? 999) - (y.to ?? 999))
}
