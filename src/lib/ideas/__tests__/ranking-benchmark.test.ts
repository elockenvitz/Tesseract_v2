import { describe, expect, it } from 'vitest'
import { rankMixedCandidates } from '../idea-priority'
import { DAY_MS } from '../../signals/thresholds'
import type { CoverageIndex } from '../../signals/coverage-relevance'
import type { PortfolioLens } from '../card-candidates'
import type { GeneratedSignal } from '../signal-candidates'
import type { ProcessFinding } from '../process-candidates'
import type { SignalCard } from '../../signals/contract'

/**
 * How long ranking actually takes at real candidate counts.
 *
 * "Single-digit milliseconds on a 38-row fixture" is encouraging and proves
 * nothing: the pipeline gained four candidate kinds, a dedupe pass and a
 * normalization step per row since that was measured, and the failure mode
 * worth catching is accidental O(n squared) — a nested find, a Set rebuilt per
 * row — which a small fixture cannot show.
 *
 * The assertions are deliberately loose. This is a regression tripwire against
 * a complexity change, not a performance target: the numbers are reported so a
 * reviewer can see them, and the bound is set far enough above the measurement
 * that ordinary machine noise cannot fail the suite.
 */

const NOW = Date.UTC(2026, 7, 28, 12)
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

function makeSources(n: number) {
  const assets = Array.from({ length: Math.max(1, Math.floor(n / 4)) }, (_, i) => uuid(i))
  const share = Math.floor(n / 5)

  const posts = Array.from({ length: n - share * 4 }, (_, i) => ({
    id: `post-${i}`,
    type: ['quick_thought', 'note', 'thesis_update', 'trade_idea'][i % 4],
    created_at: new Date(NOW - (i % 90) * DAY_MS).toISOString(),
    content: 'x'.repeat(120),
    author: { id: `author-${i % 12}` },
    asset: { id: assets[i % assets.length] },
    reactionCounts: [{ count: i % 5 }],
  }))

  const signals: GeneratedSignal[] = Array.from({ length: share }, (_, i) => ({
    id: `signal-${i}`,
    signalType: (['conflict', 'stale_coverage', 'attention_cluster'] as const)[i % 3],
    headline: 'h', body: 'b',
    relatedAssets: [{ id: assets[i % assets.length], symbol: `T${i}` }],
    createdAt: new Date(NOW).toISOString(),
    priority: 0.5,
  }))

  const cards: SignalCard[] = Array.from({ length: share }, (_, i) => ({
    id: `scenario_gap:${i}`, type: 'scenario_gap', surface: 'research',
    severity: i % 3 === 0 ? 'critical' : 'attention',
    headline: 'h', body: 'b',
    metric: { value: `${10 + (i % 20)}% below`, label: 'l', direction: 'bad', source: 'quote', asOf: new Date(NOW - DAY_MS).toISOString() },
    entity: { kind: 'asset', id: assets[i % assets.length], name: 'n', ticker: `T${i}` },
    context: [{ label: 'Portfolio', value: 'P' }],
  } as any))

  const lenses: PortfolioLens[] = Array.from({ length: share }, (_, i) => (
    i % 3 === 0
      ? { type: 'breach', breach: { assetId: assets[i % assets.length], overshootPct: 0.2 } }
      : i % 3 === 1
        ? { type: 'untargeted', position: { assetId: assets[i % assets.length], weightPct: 6 } }
        : { type: 'crowded', name: { assetId: assets[i % assets.length], maxWeightPct: 3 } }
  ))

  const process: ProcessFinding[] = Array.from({ length: share }, (_, i) => ({
    id: `a2-execution-t${i}`,
    titleKey: 'EXECUTION_NOT_CONFIRMED',
    title: 't', description: 'd', severity: 'red',
    createdAt: new Date(NOW - (i % 30) * DAY_MS).toISOString(),
    context: { assetId: assets[i % assets.length], tradeIdeaId: `t${i}` },
  }))

  return { posts, signals, cards, lenses, process }
}

const INDEX: CoverageIndex = {
  ready: true,
  direct: new Set([uuid(0), uuid(1)]),
  assigned: new Set([uuid(2)]),
  held: new Set([uuid(3), uuid(4)]),
}
const CTX = { userId: 'me', followedIds: ['author-1'], coverageIndex: INDEX }

const SIZES = [100, 250, 500, 1000]

describe('ranking scales linearly with candidate count', () => {
  const timings: { n: number; ms: number; perRow: number }[] = []

  for (const n of SIZES) {
    it(`ranks ${n} candidates`, () => {
      const sources = makeSources(n)
      // One warm pass, so the reported number is not a JIT artefact.
      rankMixedCandidates(sources, CTX, NOW)

      const started = performance.now()
      const ranked = rankMixedCandidates(sources, CTX, NOW)
      const ms = performance.now() - started

      timings.push({ n, ms, perRow: ms / n })
      // eslint-disable-next-line no-console
      console.log(`[rank] ${String(n).padStart(4)} candidates -> ${ms.toFixed(2)}ms (${(ms / n * 1000).toFixed(1)}us/row), ${ranked.length} ranked`)

      expect(ranked.length).toBeGreaterThan(0)
      // A generous ceiling. Ranking is not the cost centre — one page of this
      // feed costs eleven network round trips — and a bound tight enough to be
      // a target would fail on a loaded CI box.
      expect(ms).toBeLessThan(500)
    })
  }

  /**
   * The claim that matters: cost per row must not grow with n. A nested find
   * or a Set rebuilt per candidate would show here and nowhere else.
   */
  it('does not degrade super-linearly', () => {
    const small = timings.find(t => t.n === 100)!
    const large = timings.find(t => t.n === 1000)!
    // 10x the rows must not cost more than ~40x the time. Quadratic would be
    // 100x; the headroom absorbs allocation and GC noise on a small base.
    expect(large.ms).toBeLessThan(Math.max(small.ms, 0.5) * 40)
  })
})
