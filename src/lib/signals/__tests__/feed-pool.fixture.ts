import type { Severity, SignalType } from '../contract'
import type { PriorityInput } from '../feed-priority'

/**
 * A feed's worth of candidates, in the shape the dashboard's entries reduce to.
 *
 * ── Reconstructed, and said so ────────────────────────────────────────────
 *
 * This worktree can reach the database with the anon key only, which RLS
 * correctly refuses, so no real candidate set is available to a test here. The
 * SHAPE is taken from figures the codebase already records about the live org
 * rather than invented:
 *
 *   45 candidates with no written case against 9 with one  `research-order.ts`
 *   26 of 36 positions carrying no weight at all           `research-order.ts`
 *   three books holding AAPL in the Tesseract org          `gallery/main.tsx`
 *
 * Every number this fixture produces is therefore about a reconstruction of
 * production's proportions, not about production. Where those numbers are
 * quoted, they are quoted with that qualifier attached.
 *
 * The proportions are the part that matters for ordering: a family with 45
 * members and a tier with nothing else in it is what makes runs, and that is
 * what this reproduces.
 */

export interface Cand {
  id: string
  kind: string
  category: string
  family: string
  type: SignalType
  symbol: string
  severity: Severity
  weightPct: number | null
  held: boolean
  deviationPct: number | null
  occurredAt: number | null
  base?: number | null
}

export const NOW = Date.UTC(2026, 8, 1)
const DAY = 86_400_000

const TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JNJ', 'NVO', 'ASML',
  'LVMH', 'TSM', 'V', 'UNH', 'COST', 'ADBE', 'CRM', 'AMD', 'NFLX', 'SHOP',
  'SPOT', 'ABNB', 'UBER', 'SQ', 'PLTR', 'SNOW', 'DDOG', 'NET', 'MDB', 'ZS',
  'PANW', 'CRWD', 'TTD', 'RBLX', 'DASH', 'COIN',
]

export function buildPool(): Cand[] {
  const pool: Cand[] = []
  let n = 0
  const t = () => TICKERS[n++ % TICKERS.length]

  // Research: 45 with no written case, 9 with one. Most carry no weight.
  for (let i = 0; i < 45; i++) {
    pool.push({
      id: `insight-no_case-${i}`, kind: 'insight', category: 'research',
      family: 'research:no_case', type: 'no_research', symbol: t(),
      severity: 'attention',
      weightPct: i % 4 === 0 ? 1 + (i % 9) : null,
      held: i % 3 !== 0,
      deviationPct: null, occurredAt: null, base: 0.55,
    })
  }
  for (let i = 0; i < 5; i++) {
    pool.push({
      id: `insight-price_move-${i}`, kind: 'insight', category: 'research',
      family: 'research:price_move', type: 'research_stale', symbol: t(),
      severity: 'attention', weightPct: 2 + i, held: true,
      deviationPct: null, occurredAt: NOW - (2 + i) * DAY, base: 0.72,
    })
  }
  for (let i = 0; i < 4; i++) {
    pool.push({
      id: `insight-silence-${i}`, kind: 'insight', category: 'research',
      family: 'research:long_silence', type: 'research_stale', symbol: t(),
      severity: 'attention', weightPct: null, held: true,
      deviationPct: null, occurredAt: NOW - 120 * DAY, base: 0.45,
    })
  }

  // Portfolio and decision lenses.
  for (let i = 0; i < 6; i++) {
    pool.push({
      id: `untargeted-${i}`, kind: 'lens', category: 'portfolio',
      family: 'no_target', type: 'no_target', symbol: t(),
      severity: i < 2 ? 'critical' : 'attention', weightPct: 6 - i, held: true,
      deviationPct: null, occurredAt: NOW - 30 * DAY,
    })
  }
  for (let i = 0; i < 5; i++) {
    pool.push({
      id: `crowded-${i}`, kind: 'lens', category: 'portfolio',
      family: 'crowding', type: 'crowding', symbol: t(),
      severity: 'informational', weightPct: 25 - i * 5, held: true,
      deviationPct: null, occurredAt: NOW - 130 * DAY,
    })
  }
  for (let i = 0; i < 3; i++) {
    pool.push({
      id: `conviction-${i}`, kind: 'lens', category: 'portfolio',
      family: 'conviction_oversized', type: 'conviction_oversized', symbol: t(),
      severity: 'attention', weightPct: 8 - i, held: true,
      deviationPct: 40, occurredAt: NOW - 30 * DAY,
    })
  }
  for (let i = 0; i < 3; i++) {
    pool.push({
      id: `breach-${i}`, kind: 'lens', category: 'decisions',
      family: 'target_hit', type: 'target_hit', symbol: t(),
      severity: i === 0 ? 'critical' : 'attention', weightPct: null, held: true,
      deviationPct: 18 - i * 5, occurredAt: NOW - (1 + i) * DAY,
    })
  }
  for (let i = 0; i < 4; i++) {
    pool.push({
      id: `stale-target-${i}`, kind: 'lens', category: 'decisions',
      family: 'target_expired', type: 'target_expired', symbol: t(),
      severity: i === 0 ? 'critical' : 'attention', weightPct: null, held: true,
      deviationPct: 30 - i * 5, occurredAt: NOW - (40 + i) * DAY,
    })
  }

  // Both halves of `scenario_gap` — the reason family is not the same as type.
  for (let i = 0; i < 4; i++) {
    pool.push({
      id: `framework-${i}`, kind: 'scenario', category: 'portfolio',
      family: 'portfolio:framework_break', type: 'scenario_gap', symbol: t(),
      severity: i < 2 ? 'critical' : 'attention', weightPct: 12 - i * 2, held: true,
      deviationPct: 20 - i * 4, occurredAt: NOW - (1 + i) * DAY,
    })
  }
  for (let i = 0; i < 5; i++) {
    pool.push({
      id: `casevprice-${i}`, kind: 'scenario', category: 'decisions',
      family: 'scenario_gap', type: 'scenario_gap', symbol: t(),
      severity: 'attention', weightPct: null, held: false,
      deviationPct: 12 - i, occurredAt: NOW - (3 + i) * DAY,
    })
  }

  // Everything else that reaches the feed.
  for (let i = 0; i < 2; i++) {
    pool.push({
      id: `rec-${i}`, kind: 'attention', category: 'decisions',
      family: 'recommendation', type: 'recommendation', symbol: t(),
      severity: 'critical', weightPct: null, held: true,
      deviationPct: null, occurredAt: NOW - i * DAY,
    })
  }
  for (let i = 0; i < 3; i++) {
    pool.push({
      id: `project-${i}`, kind: 'attention', category: 'workflow',
      family: 'project_overdue', type: 'project_overdue', symbol: t(),
      severity: 'attention', weightPct: null, held: false,
      deviationPct: null, occurredAt: NOW - 10 * DAY,
    })
  }
  for (let i = 0; i < 4; i++) {
    pool.push({
      id: `activerisk-${i}`, kind: 'template', category: 'portfolio',
      family: 'active_risk', type: 'active_risk', symbol: t(),
      severity: 'attention', weightPct: 6 + i, held: true,
      deviationPct: null, occurredAt: NOW - 5 * DAY,
    })
  }
  for (let i = 0; i < 8; i++) {
    pool.push({
      id: `news-${i}`, kind: 'news', category: 'news',
      family: 'news', type: 'news', symbol: t(),
      severity: 'informational', weightPct: null, held: false,
      deviationPct: null, occurredAt: NOW - i * DAY * 0.4,
    })
  }
  for (let i = 0; i < 4; i++) {
    pool.push({
      id: `idea-${i}`, kind: 'idea', category: 'ideas',
      family: 'trade_idea', type: 'trade_idea', symbol: t(),
      severity: 'informational', weightPct: null, held: false,
      deviationPct: null, occurredAt: NOW - (1 + i) * DAY,
    })
  }

  // Four findings on ONE name — the adjacency case §10 describes, which the
  // proportions above would otherwise never produce.
  pool.push(
    { id: 'framework-AAPL', kind: 'scenario', category: 'portfolio',
      family: 'portfolio:framework_break', type: 'scenario_gap', symbol: 'AAPL',
      severity: 'critical', weightPct: 25, held: true, deviationPct: 22,
      occurredAt: NOW - DAY },
    { id: 'crowded-AAPL', kind: 'lens', category: 'portfolio', family: 'crowding',
      type: 'crowding', symbol: 'AAPL', severity: 'informational', weightPct: 25,
      held: true, deviationPct: null, occurredAt: NOW - 130 * DAY },
    { id: 'insight-AAPL', kind: 'insight', category: 'research',
      family: 'research:no_case', type: 'no_research', symbol: 'AAPL',
      severity: 'attention', weightPct: 25, held: true, deviationPct: null,
      occurredAt: null, base: 0.55 },
    { id: 'untargeted-AAPL', kind: 'lens', category: 'portfolio', family: 'no_target',
      type: 'no_target', symbol: 'AAPL', severity: 'critical', weightPct: 25,
      held: true, deviationPct: null, occurredAt: NOW - 30 * DAY },
  )

  return pool
}

export const toInput = (c: Cand): PriorityInput => ({
  id: c.id, type: c.type, severity: c.severity,
  occurredAt: c.occurredAt, weightPct: c.weightPct, held: c.held,
  deviationPct: c.deviationPct, base: c.base ?? null,
})

/** The longest run of one value, for metrics. */
export function runOf(xs: Cand[], key: (c: Cand) => string): { len: number; what: string } {
  let best = 0, bestWhat = '', cur = 0, prev = ''
  for (const x of xs) {
    const k = key(x)
    if (k === prev) cur += 1
    else { cur = 1; prev = k }
    if (cur > best) { best = cur; bestWhat = k }
  }
  return { len: best, what: bestWhat }
}
