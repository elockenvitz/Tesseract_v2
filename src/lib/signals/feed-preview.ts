import type { SignalCard } from './contract'
import type { WeightRow } from '../../components/signals/WeightBars'

/**
 * What contextual object a feed candidate can support.
 *
 * ── Why this exists beside `CardEvidence` ─────────────────────────────────
 *
 * `evidence` is what a BUILDER declares, and it is deliberately conservative:
 * three kinds, declared years apart, and two of them carrying a reference
 * rather than a series. Treating it as the only thing desktop may draw was the
 * right constraint while the architecture was unstable, and it is too tight
 * now — a crowding card declares `{ books: 4 }` while the producer behind it
 * is holding the per-portfolio weights that make crowding legible.
 *
 * So this is a PRESENTATION descriptor: given a card and the structured row
 * its producer already returned, what compact object best answers "why does
 * this matter". It invents no fact and draws no conclusion — every number here
 * is read directly off data the pool already fetched.
 *
 * ── Semantic, not component ───────────────────────────────────────────────
 *
 * The descriptor names product objects — a price path, a ladder, an exposure
 * distribution — never a component. Mobile can consume the same descriptor and
 * compose it differently. Mobile is NOT migrated in this stage.
 *
 * Pure: no React, no Supabase, no clock.
 */

export type FeedPreview =
  /** A price path, optionally against a declared reference level. */
  | { kind: 'price'; points: number[]; reference: number | null }
  /** Every case on a price axis, with the live price against them. */
  | { kind: 'scenario_ladder'; price?: number; cases: unknown[]; expected?: unknown; statedOn?: string | null }
  /** A weight distribution — across books, or against a benchmark. */
  | { kind: 'exposure'; rows: WeightRow[]; unitNote: string; baselineIndex: number }

/** The structured row a machine-derived candidate came from. */
export interface PreviewSource {
  /** `CrowdedName.weightsByPortfolio` */
  weightsByPortfolio?: { id: string; name: string; weightPct: number; valueUsd: number }[]
  /** `ConvictionGap` */
  weightPct?: number
  benchmarkPct?: number | null
  portfolioName?: string
  conviction?: string | null
  direction?: 'underweight' | 'overweight'
}

const MAX_BOOKS = 5

export function previewFor(
  family: string,
  card: SignalCard,
  source: PreviewSource | null,
  points: number[] | undefined,
): FeedPreview | null {
  /*
   * Crowding: the count was the whole tile, and the count is the least
   * interesting part. `weightsByPortfolio` is already on the producer row —
   * which book holds most, and how unevenly it is spread, is the actual
   * question "crowded" is asking.
   */
  if (family === 'crowding' && source?.weightsByPortfolio?.length) {
    const rows = [...source.weightsByPortfolio]
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, MAX_BOOKS)
      .map<WeightRow>(w => ({ label: w.name, weightPct: w.weightPct }))
    if (rows.length < 2) return null
    return { kind: 'exposure', rows, unitNote: 'of each book', baselineIndex: 0 }
  }

  /*
   * Conviction: the inconsistency IS the claim, so the two numbers belong side
   * by side. A benchmark is often absent and is omitted rather than defaulted
   * to zero, which would assert an underweight nobody measured.
   */
  if (family === 'conviction' && source?.weightPct != null) {
    const rows: WeightRow[] = [
      {
        label: source.portfolioName ?? 'Held',
        weightPct: source.weightPct,
        tone: 'subject',
        note: source.conviction ? `${source.conviction} conviction` : undefined,
      },
    ]
    if (source.benchmarkPct != null) {
      rows.push({ label: 'Benchmark', weightPct: source.benchmarkPct })
    }
    if (rows.length < 2) return null
    return { kind: 'exposure', rows, unitNote: 'of the book', baselineIndex: 1 }
  }

  const evidence = card.evidence
  if (!evidence || evidence.kind === 'none') return null

  if (evidence.kind === 'scenario_ladder') {
    const d = evidence.data as { price?: number; cases?: unknown[]; expected?: unknown; statedOn?: string | null } | null
    if (!d || !Array.isArray(d.cases) || d.cases.length === 0) return null
    return { kind: 'scenario_ladder', price: d.price, cases: d.cases, expected: d.expected, statedOn: d.statedOn }
  }

  if (evidence.kind === 'sparkline') {
    // Fewer than two closes is not a line. A flat stroke is a claim about the
    // price and one point is not.
    if (!points || points.length < 2) return null
    const d = evidence.data as { target?: number | null } | null
    return { kind: 'price', points, reference: d?.target ?? null }
  }

  /*
   * `peer_bar` carries `{ books: n }` — a number the card's metric already
   * prints. Crowding is handled above from richer data; nothing else declares
   * it. Left undrawn rather than turned into a one-bar chart.
   */
  return null
}

/** The symbol a candidate needs price history for. Drives the feed's batch. */
export function previewSymbol(card: SignalCard): string | null {
  if (card.evidence?.kind !== 'sparkline') return null
  const d = card.evidence.data as { symbol?: string } | null
  return (d?.symbol ?? card.entity?.ticker ?? null)?.toUpperCase() ?? null
}
