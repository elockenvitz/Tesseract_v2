/**
 * The harness entry: capture or load a snapshot, replay the rankers, report.
 *
 * Kept apart from `cli.ts` so the capture (which can touch the network) and the
 * reporting (which never does) stay separable — a replay of a committed
 * snapshot must be runnable with no credentials and no connection at all.
 */

import { readFileSync } from 'node:fs'
import { eligibleFeedItems } from '../feed-suppression'
import { captureSnapshot } from './cli'
import { replayLegacyDesktop, replayLegacyMobileIntake } from './legacy-rankers'
import { metricsFor, movements, overlapAt, type RankMetrics } from './metrics'
import type { RankSnapshot, ReplayResult } from './types'

export interface RunOptions {
  mode: 'fixture' | 'staging' | 'replay'
  engines: string
  top: number
  replayPath: string | null
  label: string
}

/**
 * The canonical replay, when the canonical ranker exists.
 *
 * Imported lazily and tolerantly on purpose: the BEFORE artifact has to be
 * capturable from a tree where unification has not happened yet, and a harness
 * that could only run after the change it is meant to measure would be useless.
 */
async function tryCanonical(snap: RankSnapshot): Promise<ReplayResult | null> {
  try {
    const mod = await import('./canonical-replay')
    return mod.replayCanonical(snap)
  } catch {
    return null
  }
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

function renderMetrics(m: RankMetrics, top: number): string {
  const rows = m.topN.map((r, i) => [
    pad(String(i + 1), 3),
    pad(r.id, 22),
    pad(r.type, 14),
    pad(`${r.ageDays}d`, 7),
    pad(r.tier === null ? '-' : `T${r.tier}`, 4),
    pad(r.score.toFixed(4), 8),
    pad(r.scope, 15),
    pad(r.urgency ?? (r.actionable ? 'open' : '-'), 7),
    pad(r.suppressed ? 'SUPPRESSED' : 'visible', 10),
    pad(r.assetSymbol ?? '-', 6),
    pad(r.authorId ?? '-', 9),
    r.reasons.join(','),
  ].join(' ')).join('\n')

  return [
    `engine              ${m.engine}`,
    `candidates          ${m.candidateCount}`,
    `suppressed          ${m.suppressedCount}`,
    `visible             ${m.visibleCount}`,
    `scoped recall       ${m.scopedRecall.hit}/${m.scopedRecall.of} (${m.scopedRecall.pct}%)`,
    `urgent unscoped     ${m.urgentUnscopedRecall.hit}/${m.urgentUnscopedRecall.of} (${m.urgentUnscopedRecall.pct}%)`,
    `suppressed leakage  ${m.suppressedLeakage}`,
    `distinct authors    ${m.distinctAuthors}`,
    `distinct assets     ${m.distinctAssets}`,
    `max author run      ${m.maxAuthorRun}`,
    `median age (days)   ${m.medianAgeDays}`,
    `max age (days)      ${m.maxAgeDays}`,
    `ranking duration    ${m.durationMs}ms`,
    ``,
    `top ${top}:`,
    `    ${pad('id', 22)} ${pad('type', 14)} ${pad('age', 7)} ${pad('tier', 4)} ${pad('score', 8)} ${pad('scope', 15)} ${pad('urg', 7)} ${pad('state', 10)} ${pad('sym', 6)} ${pad('author', 9)} reasons`,
    rows,
  ].join('\n')
}

export async function run(opts: RunOptions) {
  /**
   * A replay accepts either a bare snapshot or a full report artifact.
   *
   * The artifact is what `--out` writes, so it is the file somebody actually
   * has, and demanding they unwrap it first is a papercut on the one workflow
   * this tool exists for.
   */
  const loadSnapshot = (path: string): RankSnapshot => {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.snapshot ?? parsed
  }

  const snapshot: RankSnapshot = opts.mode === 'replay' && opts.replayPath
    ? loadSnapshot(opts.replayPath)
    : await captureSnapshot(opts.mode === 'staging' ? 'staging' : 'fixture', opts.label)

  /**
   * Suppression is applied ONCE, here, and both engines see the result.
   *
   * It is shared and settled — `suppressionFor`, ported to desktop in the
   * previous phase — so it is not what this comparison is measuring. Filtering
   * before either ranker keeps the diff attributable to the ranking change
   * instead of re-litigating a decision already made, and it is also what the
   * shipped pipeline does: eligibility precedes scoring on both shells.
   */
  const eligible = eligibleFeedItems(
    snapshot.candidates.map(c => ({ ...c, id: c.id, type: c.type })),
    snapshot.context.dispositions,
    snapshot.context.now,
  )
  const eligibleIds = new Set(eligible.map(c => c.id))
  const suppressedCount = snapshot.candidates.length - eligibleIds.size
  const ranked: RankSnapshot = {
    ...snapshot,
    candidates: snapshot.candidates.filter(c => eligibleIds.has(c.id)),
  }

  const wantLegacy = opts.engines === 'legacy' || opts.engines === 'all'
  const wantCanonical = opts.engines === 'canonical' || opts.engines === 'all'

  const results: ReplayResult[] = []
  if (wantLegacy) {
    results.push(replayLegacyDesktop(ranked))
    results.push(replayLegacyMobileIntake(ranked))
  }
  const canonical = wantCanonical ? await tryCanonical(ranked) : null
  if (canonical) results.push(canonical)

  // Reported against the full candidate set, so the count of what suppression
  // removed is visible rather than implied by a shorter list.
  for (const r of results) {
    r.candidateCount = snapshot.candidates.length
    r.suppressedCount = suppressedCount
  }

  const metrics = results.map(r => metricsFor(r, snapshot, opts.top))

  const sections: string[] = [
    `RANK REPORT — ${snapshot.source} — ${snapshot.label}`,
    `captured ${snapshot.capturedAt} · clock ${new Date(snapshot.context.now).toISOString()}`,
    `candidates ${snapshot.candidates.length} · suppressed ${suppressedCount} · scoped names ${snapshot.context.coverage.direct.length} personal / ${snapshot.context.coverage.assigned.length} assigned · dispositions ${Object.keys(snapshot.context.dispositions).length}`,
    ...(snapshot.source === 'staging' && Object.keys(snapshot.context.dispositions).length === 0
      ? ['NOTE: dispositions live in browser storage and are not reachable headlessly, so no suppression is applied to this capture.']
      : []),
    '',
    ...metrics.map(m => `${'='.repeat(78)}\n${renderMetrics(m, opts.top)}`),
  ]

  const legacyDesktop = results.find(r => r.engine === 'legacy-desktop')
  const legacyMobile = results.find(r => r.engine === 'legacy-mobile')

  /**
   * All three pairwise overlaps, not just the one that flatters the change.
   *
   * Desktop-vs-mobile is the number that states the ORIGINAL defect: two ranked
   * lists from one account. It should be reported next to the two after-numbers
   * so the comparison is "how far apart were they" against "how far apart are
   * they now", rather than only "how much did desktop move".
   */
  if (legacyDesktop && legacyMobile) {
    sections.push(
      '='.repeat(78),
      'OVERLAPS (top 10)',
      `legacy desktop vs legacy mobile   ${overlapAt(legacyDesktop.ranked, legacyMobile.ranked, 10)}/10`,
      ...(canonical ? [
        `legacy desktop vs canonical       ${overlapAt(legacyDesktop.ranked, canonical.ranked, 10)}/10`,
        `legacy mobile  vs canonical       ${overlapAt(legacyMobile.ranked, canonical.ranked, 10)}/10`,
      ] : []),
    )
  }

  if (canonical && legacyDesktop) {
    const moved = movements(legacyDesktop.ranked, canonical.ranked, opts.top)
    sections.push(
      '='.repeat(78),
      'LEGACY DESKTOP  ->  CANONICAL',
      `top-10 overlap      ${overlapAt(legacyDesktop.ranked, canonical.ranked, 10)}/10`,
      `top-20 overlap      ${overlapAt(legacyDesktop.ranked, canonical.ranked, 20)}/20`,
      '',
      `    ${pad('id', 24)} ${pad('from', 6)} ${pad('to', 6)} ${pad('status', 8)} reasons`,
      moved.map(m => [
        '   ',
        pad(m.id, 24),
        pad(m.from === null ? '-' : String(m.from + 1), 6),
        pad(m.to === null ? '-' : String(m.to + 1), 6),
        pad(m.status, 8),
        m.reasons.join(','),
      ].join(' ')).join('\n'),
    )
  }

  return {
    text: sections.join('\n'),
    artifact: {
      snapshot,
      metrics: metrics.map(({ topN, ...rest }) => ({ ...rest, topN })),
      comparison: canonical && legacyDesktop
        ? {
            top10Overlap: overlapAt(legacyDesktop.ranked, canonical.ranked, 10),
            top20Overlap: overlapAt(legacyDesktop.ranked, canonical.ranked, 20),
            legacyDesktopVsLegacyMobile10: legacyMobile
              ? overlapAt(legacyDesktop.ranked, legacyMobile.ranked, 10) : null,
            legacyMobileVsCanonical10: legacyMobile
              ? overlapAt(legacyMobile.ranked, canonical.ranked, 10) : null,
            movements: movements(legacyDesktop.ranked, canonical.ranked, opts.top),
          }
        : null,
    },
  }
}
