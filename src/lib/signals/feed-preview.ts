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
  /**
   * A price path, optionally against a declared reference level.
   *
   * Dated closes rather than bare numbers: the desktop preview reads out the
   * date under the cursor, and a bare series cannot answer "when".
   */
  | { kind: 'price'; series: { date: string; close: number }[]; reference: number | null }
  /** Every case on a price axis, with the live price against them. */
  | { kind: 'scenario_ladder'; price?: number; cases: unknown[]; expected?: unknown; statedOn?: string | null }
  /** A weight distribution — across books, or against a benchmark. */
  | { kind: 'exposure'; rows: WeightRow[]; unitNote: string; baselineIndex: number }

/**
 * One pane of a feed card's carousel: an object, and the word for it.
 *
 * ── Why the feed draws one picture and the gallery draws several ──────────
 *
 * `previewFor` below answers with AT MOST ONE object, by a chain of early
 * returns. That is not a judgment that one is enough; it is the shape the
 * function was given before anything could page. Meanwhile the Explore tile
 * next to it has built a list of panels and shipped a pager for them for some
 * time, and `VisualPager` is a shared component precisely so both surfaces
 * page the same way.
 *
 * The cost is concrete. A scenario card's price series is already fetched
 * (the feed collects every preview symbol in one batched read) and already
 * handed to `previewFor` -- and then thrown away unread, because the ladder
 * branch returns before the sparkline branch is reached. The reader is shown
 * the cases and cannot reach the price that moved against them, on a card
 * whose entire claim is about the distance between the two.
 *
 * So: a list, ordered, with the pane that IS the finding first. Nothing new
 * is fetched and nothing is invented. `previewsFor` composes the same
 * branches; they just stop cutting each other off.
 */
export interface FeedPreviewPane {
  /** Stable handle, for tests and for restoring a pane. Never shown. */
  id: string
  /** One short sentence-case word, as `VisualPager` takes them. */
  label: string
  preview: FeedPreview
}

/**
 * The structured row a machine-derived candidate came from.
 *
 * ── Two readers now, and the second one is not the preview layer ─────────
 *
 * `previewFor` reads it to draw a pane, and every branch there is gated on
 * the family, so a row carrying another family's fields is inert.
 *
 * The workspace ENTRY CONTEXT reads it too (`entryContextFor`), because this
 * is the only place the finding's own numbers survive the trip from the
 * producer to the pane beside the feed. A card is a claim and drops the
 * numbers behind it: "has reached the target you set for it" cannot tell the
 * workspace which target, measured against what, or when it was stated.
 *
 * Still presentation, and still never authority: nothing routes, ranks or
 * authorises on these fields, and the workspace's own org-scoped queries
 * remain the source of truth for everything it draws from the database.
 */
export interface PreviewSource {
  /** `CrowdedName.weightsByPortfolio` */
  weightsByPortfolio?: { id: string; name: string; weightPct: number; valueUsd: number }[]
  /** `ConvictionGap` */
  weightPct?: number
  benchmarkPct?: number | null
  portfolioName?: string
  conviction?: string | null
  direction?: 'underweight' | 'overweight'
  /**
   * `TargetBreach` — the row behind a target hit.
   *
   * `price` is the HOLDINGS MARK the lens compared, not a traded close, and
   * `asOf` is the snapshot it came from. Both travel because a surface that
   * states the comparison has to be able to say what it compared and when.
   */
  target?: number
  price?: number
  overshootPct?: number
  caseName?: string | null
  cases?: { id: string; name: string; price: number }[]
  statedAt?: string
  asOf?: string
  heldIn?: string[]
  heldInIds?: string[]
  /** `RecommendationInput` — the row behind a pending recommendation. */
  id?: string
  action?: string | null
  proposedWeightPct?: number | null
  currentWeightPct?: number | null
  currentWeightAsOf?: string | null
  rationale?: string | null
  recommendedBy?: string | null
  createdAt?: string
}

const MAX_BOOKS = 5

export function previewFor(
  family: string,
  card: SignalCard,
  source: PreviewSource | null,
  series: { date: string; close: number }[] | undefined,
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
    if (!series || series.length < 2) return null
    const d = evidence.data as { target?: number | null } | null
    return { kind: 'price', series, reference: d?.target ?? null }
  }

  /*
   * `peer_bar` carries `{ books: n }` — a number the card's metric already
   * prints. Crowding is handled above from richer data; nothing else declares
   * it. Left undrawn rather than turned into a one-bar chart.
   */
  return null
}

/**
 * Every object this card can support, in the order a reader should meet them.
 *
 * The FINDING leads. Whatever raised the card is the first pane, because that
 * is the pane the headline is about and a reader who pages nowhere must still
 * be looking at the right thing. The price trails it, because "what has it
 * done lately" is the question asked second on every one of these cards and
 * the series is already in hand.
 *
 * Where the finding IS the price path, there is one pane and no pager -- the
 * sparkline branch of `previewFor` returns a `price` object, and a second
 * copy of it behind an arrow would be furniture. `VisualPager` draws nothing
 * below two labels, so that case needs no special handling here, but it is
 * guarded anyway so the list never carries the same object twice.
 */
export function previewsFor(
  family: string,
  card: SignalCard,
  source: PreviewSource | null,
  series: { date: string; close: number }[] | undefined,
): FeedPreviewPane[] {
  const panes: FeedPreviewPane[] = []

  const lead = previewFor(family, card, source, series)
  if (lead) {
    panes.push({
      id: lead.kind,
      /*
       * Sentence case and one word, which is `VisualPager`'s contract. These
       * are the reader's words for the object, not the descriptor's: "Cases"
       * rather than "scenario_ladder", "Exposure" rather than "exposure".
       */
      label: lead.kind === 'scenario_ladder' ? 'Cases'
        : lead.kind === 'exposure' ? 'Exposure'
        : 'Price',
      preview: lead,
    })
  }

  /*
   * The price, where it is not already the lead and where there is a line to
   * draw. Two closes is the same floor the sparkline branch uses: a single
   * point is not a path, and a flat stroke through it would be a claim about
   * the price that nobody made.
   */
  if (lead?.kind !== 'price' && series && series.length >= 2) {
    panes.push({
      id: 'price',
      label: 'Price',
      /*
       * No reference level. The ladder pane already carries the cases, and a
       * `reference` here would have to come from `evidence.data.target`,
       * which a scenario card does not have -- the sparkline branch reads it
       * from its own evidence kind. Drawing an unlabelled line at a number
       * this card never declared is the kind of invented fact the header
       * above rules out.
       */
      preview: { kind: 'price', series, reference: null },
    })
  }

  return panes
}

/** The symbol a candidate needs price history for. Drives the feed's batch. */
export function previewSymbol(card: SignalCard): string | null {
  /*
   * ── Why this used to answer only for sparkline cards ─────────────────────
   *
   * The feed collects these symbols into ONE batched price read, and the only
   * consumer of that read was the sparkline branch of `previewFor`. So the
   * gate was "does this card's evidence declare a sparkline", and for every
   * other card the answer was null.
   *
   * That gate is now circular. `previewsFor` gives a scenario or exposure
   * card a second pane carrying the price -- which is the question a reader
   * asks second on exactly those cards, since the claim is about the distance
   * between a written case and where the price actually went. But the pane
   * can only exist if the series was fetched, and the series was only fetched
   * if the card was already a price card. A ladder card could never reach its
   * own price.
   *
   * So the question becomes the one that was always meant: is this card about
   * a NAME. A card with a ticker can show that ticker's price; a prompt, a
   * thought or a card about a book has no ticker and still answers null, so
   * the batch does not grow by a single symbol that has nothing to draw.
   *
   * The sparkline's own `data.symbol` still wins where it is present -- an
   * evidence row may name a symbol other than the card's entity, and that one
   * is the one its line was computed for.
   */
  const d = card.evidence?.kind === 'sparkline'
    ? (card.evidence.data as { symbol?: string } | null)
    : null
  return (d?.symbol ?? card.entity?.ticker ?? null)?.toUpperCase() ?? null
}
