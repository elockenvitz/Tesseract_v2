/**
 * Where the book and the investment framework disagree.
 *
 * ── The product is the gap, not the holding ───────────────────────────────
 *
 * A holdings table states facts: ticker, weight, price. Every one of them is
 * true and none of them is a reason to open the page. What is worth a PM's
 * morning is the small set of places where what is OWNED and what is BELIEVED
 * have come apart -- a 25% position with no written case, a name whose thesis
 * has not been revisited since the stock doubled, a book line trading through
 * its own bull case.
 *
 * ── Every gap is proved, none is inferred ────────────────────────────────
 *
 * Each state below names the durable rows it needs. A gap that cannot be
 * proved is not shown, and its absence is never dressed up as "no issues" --
 * `no-framework` says the framework is missing, which is a different and
 * usually more important statement than "the framework is fine".
 *
 * Production does not carry a policy max, a risk budget, a target weight or a
 * position limit. `portfolios.settings` is jsonb and empty of them. So there
 * is no OVER LIMIT state here, however natural it would look beside the
 * others: it would be a number this product invented about someone's mandate.
 *
 * ── Cash is excluded from every price-shaped claim ───────────────────────
 *
 * Three of the nine books in the reviewing org are 100% CASH_USD. Cash cannot
 * have a stale thesis or trade above its bull case. It can still be LARGE, and
 * an unusual cash weight is a real finding, so cash is ranked but only ever
 * described by size.
 */

import type { EngagementTarget } from '../engagement'
import type { Position } from '../portfolio/holdings'
import type { CurrentLadder } from '../signals/current-ladder'
import type { SemanticTone } from '../semantic-tone'

/** Everything known about one (asset, portfolio) line, beyond the holding. */
export interface PositionFrame {
  /** Newest updated_at across CORE thesis sections. Null when none is written. */
  thesisUpdatedAt: string | null
  daysSinceReview: number | null
  /** Research items dated after the thesis anchor. */
  newEvidence: number
  evidenceCount: number
  /** The shared ladder, or null when fewer than two priced rungs exist. */
  ladder: CurrentLadder | null
  /** A live, undecided idea on this asset IN THIS PORTFOLIO. */
  liveIdea: LiveIdea | null
}

export interface LiveIdea {
  id: string
  action: string | null
  stage: string | null
  /** True only when the portfolio track has no decision and the idea is open. */
  awaitingDecision: boolean
}

export const EMPTY_FRAME: PositionFrame = {
  thesisUpdatedAt: null, daysSinceReview: null,
  newEvidence: 0, evidenceCount: 0, ladder: null, liveIdea: null,
}

/**
 * Why this position wants attention, most actionable first.
 *
 * Ordering is a claim about investment consequence, not severity theatre. A
 * decision nobody has made outranks a stale document, because it is the one
 * state where the book is waiting on a person.
 */
export type GapState =
  | 'decision-open'      // a live idea on this name is awaiting a decision
  | 'above-bull'         // spot has passed the top of the current framework
  | 'no-framework'       // meaningful size, no written thesis
  | 'evidence-since'     // research arrived after the case was last written
  | 'stale-thesis'       // held size, case not revisited
  | 'below-bear'         // spot has fallen through the bottom of the framework
  | 'large-cash'         // an unusual cash weight -- the one cash claim
  | 'aligned'            // framework present, current, and spot inside it

export const GAP_LABEL: Record<GapState, string> = {
  'decision-open': 'Decision pending',
  'above-bull': 'Above bull case',
  // The same words Research uses for the same condition. A reader crossing
  // between the two must not have to work out that they are one fact.
  'no-framework': 'No thesis on file',
  'evidence-since': 'New research',
  'stale-thesis': 'Review due',
  'below-bear': 'Below bear case',
  'large-cash': 'Cash weight',
  aligned: 'Aligned',
}

/**
 * How bad each gap is — which is NOT how important it is.
 *
 * The first Portfolio screenshot rendered five positions in rose: four merely
 * missing a written case, one genuinely trading through its own bear case. The
 * screen said all five were equally broken. They are not the same kind of
 * problem, and a reader who cannot tell them apart at a glance has lost the
 * only thing colour was doing.
 *
 * `critical` is reserved for a framework that is actually broken: a price
 * outside the range the case itself defined. Everything else that wants a
 * person -- an unwritten case, a review nobody has done, evidence nobody has
 * read, a decision nobody has made -- is `review`. Work outstanding is not an
 * emergency, however much capital sits behind it.
 *
 * Severity is deliberately absent from `tierOf` and `scoreOf`. A 28.2%
 * unwritten case still ranks first and is still amber; ranking answers "what
 * first", tone answers "how bad", and neither is computed from the other.
 */
export function toneForGap(gap: GapState): SemanticTone {
  switch (gap) {
    // Spot is outside the range the written case defined. The framework and
    // the market disagree, and that is a real break rather than an omission.
    case 'above-bull':
    case 'below-bear':
      return 'critical'

    // All work states: something needs writing, reviewing, reading or
    // deciding. Frequently the most important thing on the page; never broken.
    case 'decision-open':
    case 'no-framework':
    case 'evidence-since':
    case 'stale-thesis':
      return 'review'

    // An unusual cash weight is context worth noticing, not a fault.
    case 'large-cash':
      return 'info'

    case 'aligned':
      return 'neutral'
  }
}

/** A position must be worth the reader's time before a gap is worth naming. */
export const MATERIAL_PCT = 1
const STALE_DAYS = 90
const LARGE_CASH_PCT = 20

const rung = (l: CurrentLadder | null, name: string): number | null =>
  l?.cases.find(c => c.name === name)?.price ?? null

export function gapOf(p: Position, f: PositionFrame = EMPTY_FRAME): GapState {
  if (p.isCash) return p.weightPct >= LARGE_CASH_PCT ? 'large-cash' : 'aligned'

  if (f.liveIdea?.awaitingDecision) return 'decision-open'

  // The framework claim comes before the document claim: a stock trading
  // through its own bull case is a live disagreement with the view, whereas a
  // stale review date is only a disagreement with the calendar.
  if (p.price > 0 && f.ladder?.valid) {
    const bull = rung(f.ladder, 'Bull')
    const bear = rung(f.ladder, 'Bear')
    if (bull != null && p.price > bull) return 'above-bull'
    if (bear != null && p.price < bear) return 'below-bear'
  }

  if (!f.thesisUpdatedAt) return p.weightPct >= MATERIAL_PCT ? 'no-framework' : 'aligned'
  if (f.newEvidence > 0) return 'evidence-since'
  if ((f.daysSinceReview ?? 0) >= STALE_DAYS) return 'stale-thesis'
  return 'aligned'
}

/** How far past the framework spot has travelled, as a percent of the rung. */
export function breakPct(p: Position, f: PositionFrame): number | null {
  if (!f.ladder?.valid || !(p.price > 0)) return null
  const bull = rung(f.ladder, 'Bull')
  const bear = rung(f.ladder, 'Bear')
  if (bull != null && p.price > bull && bull > 0) return ((p.price - bull) / bull) * 100
  if (bear != null && p.price < bear && bear > 0) return ((p.price - bear) / bear) * 100
  return null
}

/**
 * The one-line investment reason.
 *
 * Every branch is built from counts, dates and prices that were read, and the
 * position's own weight is always in it -- the same gap on a 25% stake and a
 * 0.2% stake are not the same problem.
 */
export function whyItMatters(p: Position, f: PositionFrame = EMPTY_FRAME): string {
  const t = p.symbol ?? 'this line'
  const w = `${p.weightPct.toFixed(1)}%`
  switch (gapOf(p, f)) {
    case 'decision-open':
      return `A ${f.liveIdea?.action ?? 'trade'} is waiting on a decision, on a ${w} position.`
    case 'above-bull': {
      const by = breakPct(p, f)
      return by != null
        ? `Spot is ${by.toFixed(1)}% above your bull case.`
        : `Spot is above your bull case.`
    }
    case 'below-bear': {
      const by = breakPct(p, f)
      return by != null
        ? `Spot is ${Math.abs(by).toFixed(1)}% below your bear case.`
        : `Spot is below your bear case.`
    }
    case 'no-framework':
      return `${w} of the book in ${t}, with no thesis behind it.`
    case 'evidence-since':
      return `${f.newEvidence} new research note${f.newEvidence === 1 ? '' : 's'} since the thesis was written.`
    case 'stale-thesis':
      return `Thesis last reviewed ${f.daysSinceReview} days ago.`
    case 'large-cash':
      return `${w} of the book is in cash.`
    case 'aligned':
      return f.thesisUpdatedAt
        ? `Reviewed ${f.daysSinceReview} days ago; spot sits inside the framework.`
        : `${w} of the book, nothing outstanding.`
  }
}

/** The verb, and the surface that can actually honor it. */
export type RouteTo = 'ideas' | 'research' | null

export function primaryActionFor(p: Position, f: PositionFrame = EMPTY_FRAME): { label: string; route: RouteTo } {
  switch (gapOf(p, f)) {
    case 'decision-open': return { label: 'Review the decision', route: 'ideas' }
    case 'above-bull':
    case 'below-bear': return { label: 'Review thesis', route: 'research' }
    case 'no-framework': return { label: 'Write the case', route: 'research' }
    case 'evidence-since': return { label: 'Review new evidence', route: 'research' }
    case 'stale-thesis': return { label: 'Review thesis', route: 'research' }
    // Cash has no case to open, and nothing below is a document problem.
    case 'large-cash': return { label: 'Review allocation', route: null }
    case 'aligned': return { label: p.isCash ? 'Review allocation' : 'Read the case', route: p.isCash ? null : 'research' }
  }
}

/* ----------------------------------------------------------------- ranking */

/**
 * Tier-first, exactly as Today, Ideas and Research rank.
 *
 * Tier is a hard partition and size only orders WITHIN it, so a 25% aligned
 * position can never displace a 3% one that is waiting on a decision. Size
 * decides which of two equally-broken positions to look at first, which is the
 * question it can actually answer.
 */
export function tierOf(p: Position, f: PositionFrame = EMPTY_FRAME): 0 | 1 | 2 | 3 {
  switch (gapOf(p, f)) {
    case 'decision-open': return 0
    case 'above-bull':
    case 'below-bear': return 1
    case 'no-framework':
    case 'evidence-since': return 1
    case 'stale-thesis': return 2
    case 'large-cash': return 2
    case 'aligned': return 3
  }
}

/** Size band. Materiality is the only thing that orders within a tier. */
export function scoreOf(p: Position): number {
  const w = p.weightPct
  return w >= 10 ? 1 : w >= 5 ? 0.8 : w >= 3 ? 0.6 : w >= 1 ? 0.45 : 0.2
}

export function comparePositions(
  a: { position: Position; frame: PositionFrame },
  b: { position: Position; frame: PositionFrame },
): number {
  const ta = tierOf(a.position, a.frame), tb = tierOf(b.position, b.frame)
  if (ta !== tb) return ta - tb
  const sa = scoreOf(a.position), sb = scoreOf(b.position)
  if (sb !== sa) return sb - sa
  if (b.position.weightPct !== a.position.weightPct) return b.position.weightPct - a.position.weightPct
  return a.position.assetId.localeCompare(b.position.assetId)
}

/* -------------------------------------------------------------- engagement */

export function issueFor(p: Position, f: PositionFrame = EMPTY_FRAME): string {
  return GAP_LABEL[gapOf(p, f)]
}

export function seedPromptFor(p: Position, f: PositionFrame = EMPTY_FRAME): string {
  const t = p.symbol ?? 'this position'
  const w = `${p.weightPct.toFixed(1)}%`
  switch (gapOf(p, f)) {
    case 'decision-open':
      return `A ${f.liveIdea?.action ?? 'trade'} on ${t} is awaiting a decision while we hold ${w}. What would have to be true to act, and what argues for leaving the size alone?`
    case 'above-bull':
      return `${t} is trading above our current bull case and is still ${w} of the book. What assumptions would need to change for this size to remain justified?`
    case 'below-bear':
      return `${t} has fallen through our bear case on a ${w} position. Which parts of the case are most likely broken rather than early?`
    case 'no-framework':
      return `We hold ${w} of the book in ${t} with no written case. What would a defensible thesis have to claim, and what would it hinge on?`
    case 'evidence-since':
      return `${f.newEvidence} research items arrived on ${t} after our case was last written, on a ${w} position. Summarise them against the existing view and say which most challenges the current size.`
    case 'stale-thesis':
      return `Our case for ${t} has not been revisited in ${f.daysSinceReview} days and the position is ${w}. Which claims are most likely stale, and does the size still match them?`
    case 'large-cash':
      return `${w} of this book is in cash. What does that imply about the opportunity set we are currently seeing?`
    case 'aligned':
      return `We hold ${w} of the book in ${t}. What would have to change for that size to be wrong?`
  }
}

export function targetFor(p: Position, f: PositionFrame = EMPTY_FRAME, portfolioName?: string): EngagementTarget | null {
  if (!p.assetId) return null
  const chips: { label: string; value: string }[] = []
  chips.push({ label: 'Weight', value: `${p.weightPct.toFixed(1)}%` })
  if (portfolioName) chips.push({ label: 'Portfolio', value: portfolioName })
  if (p.price > 0) chips.push({ label: 'Spot', value: `$${p.price.toFixed(2)}` })
  if (f.ladder?.valid) {
    const bull = rung(f.ladder, 'Bull'), bear = rung(f.ladder, 'Bear')
    if (bear != null && bull != null) {
      chips.push({ label: 'Framework', value: `$${bear.toFixed(0)}–$${bull.toFixed(0)}` })
    }
  }
  if (f.daysSinceReview != null) chips.push({ label: 'Last review', value: `${f.daysSinceReview}d` })
  if (f.evidenceCount) chips.push({ label: 'Research', value: `${f.evidenceCount} item${f.evidenceCount === 1 ? '' : 's'}` })
  if (f.newEvidence) chips.push({ label: 'New since review', value: String(f.newEvidence) })
  if (f.liveIdea) chips.push({ label: 'Live idea', value: f.liveIdea.action ?? 'open' })

  return {
    // The asset, not the position: `asset` is already in
    // DISCUSSABLE_OBJECT_TYPES, so Team works without widening any constraint,
    // and a thread about AAPL is the same thread from either book. The
    // portfolio it was raised from travels in the chips and the origin.
    objectType: 'asset',
    objectId: p.assetId,
    label: p.companyName ? `${p.symbol} — ${p.companyName}` : (p.symbol ?? 'Position'),
    symbol: p.symbol ?? undefined,
    assetId: p.assetId,
    // The target carries portfolio context first-class, so AI is told which
    // book the 25% refers to rather than being handed a bare asset.
    portfolioId: p.portfolioId,
    portfolioName,
    origin: { itemId: `${p.portfolioId}:${p.assetId}`, surface: 'portfolio' },
    issue: {
      title: issueFor(p, f),
      detail: whyItMatters(p, f),
      reason: `portfolio:${gapOf(p, f)}`,
    },
    seedPrompt: seedPromptFor(p, f),
    contextChips: chips,
  }
}
