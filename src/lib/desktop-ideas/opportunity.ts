/**
 * The opportunity set: Explore's candidates, narrowed to the idea-worthy ones.
 *
 * ── Why this layer exists ─────────────────────────────────────────────────
 *
 * Explore and Ideas ask different questions of the same desk:
 *
 *   Explore   what is interesting? News, a colleague's post, an aggregate --
 *             anything worth a reader's attention.
 *   Ideas     what could plausibly START, REVIVE or ADVANCE an investment
 *             idea? A strict subset, and the difference is not presentation.
 *
 * So this is one shared truth with two presentations, rather than a second
 * generator. Nothing here produces a candidate: `useDesktopExplore` already
 * composes them from the mobile adapters and ranks them with
 * `diversifyExplore`, and this only decides which of those carry an
 * investment question and what kind of question it is.
 *
 * Pure -- no React, no Supabase, no queries -- so the rule can be tested
 * without standing up a surface, and so mobile could adopt the same subset if
 * it ever wants an Ideas mode of its own.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not re-rank. `diversifyExplore` has already scored, deduped and
 * applied repulsion between neighbours of the same sort, and a second ordering
 * rule here is exactly how two surfaces begin disagreeing about the same desk.
 * Order is preserved; only membership is decided.
 */
import type { ComposedExploreItem, ExploreItem } from '../mobile/explore-item'
/* Size is decided by the candidate's own content, and the page budget is
   applied separately -- mobile's rule, reused rather than re-derived. */
import { exploreCardSize, MAX_FEATURES } from '../mobile/explore-layout'
/* Type only -- this layer stays pure and never opens an engagement itself. */
import type { EngagementTarget } from '../engagement/types'

/**
 * What kind of investment question a candidate raises.
 *
 * Derived from facts the adapters already set -- never invented, and never a
 * type the mobile feed cannot actually produce. `other` exists so a candidate
 * that passes the subset test without matching a named shape is still carried
 * rather than silently dropped.
 */
export type OpportunityKind =
  /** A move big enough to be worth a second look. */
  | 'price_move'
  /** Held, with no written case behind it. */
  | 'no_thesis'
  /** What the book holds against what the index does. */
  | 'exposure'
  /** Research or evidence that has arrived since anyone looked. */
  | 'new_evidence'
  /** A scenario ladder, target or sizing question somebody can answer. */
  | 'framework'
  /** Assigned work that has resurfaced. */
  | 'workflow'
  /**
   * A person wrote this one. The card's own author raised it, not Tesseract.
   *
   * ── Not "Proposed" ──────────────────────────────────────────────────────
   *
   * The first cut of this label was "Proposed", which is a stage this product
   * retired after pilot graduation and does not have anywhere in the ontology
   * -- the four maturities are Researching, Thesis forming, Decision ready and
   * Deciding, and none of them is a proposal. Inventing a chip word that names
   * a dead stage tells the reader a post is somewhere it cannot be.
   *
   * What this kind actually knows is WHO raised it, which is the one thing
   * that genuinely distinguishes an authored post from a generated candidate
   * and the distinction this lens promised to keep visible.
   */
  | 'authored'
  /**
   * A name on the reader's own coverage with a gap and no idea open.
   *
   * Its own kind rather than folded into `no_thesis` or `new_evidence`,
   * because what distinguishes it is not the gap -- it is that TESSERACT
   * raised it from the coverage scan rather than anyone writing it down. That
   * is the same distinction `authored` exists for, seen from the other side,
   * and the reader is entitled to it on the chip.
   */
  | 'coverage_gap'
  | 'other'

export interface Opportunity {
  composed: ComposedExploreItem
  item: ExploreItem
  kind: OpportunityKind
}

/**
 * Subtypes that cannot start, revive or advance an idea on their own.
 *
 *   news        something that happened. It may PROMPT an idea, but the item
 *               itself is a story to read, and its action is the article
 *               reader rather than anything on the desk. Explore keeps it.
 *   aggregate   "4 new ideas this week" -- a navigation device that resolves
 *               to a filtered list. There is no single name to think about,
 *               which is the whole premise of a card in this lens.
 */
const NOT_IDEA_WORTHY = new Set(['news', 'aggregate'])

/**
 * Whether a candidate raises a question about a NAME the reader could act on.
 *
 * A symbol is required, and that is the substantive part of the test rather
 * than a technicality: every kind below is a question about an instrument, and
 * a candidate with no instrument has nothing for this lens to be about.
 */
export function isIdeaWorthy(item: ExploreItem): boolean {
  if (NOT_IDEA_WORTHY.has(item.subtype)) return false
  return !!(item.symbol || item.assetId)
}

/**
 * Which investment question this candidate raises.
 *
 * Read in order of how specific the evidence is: an explicit signal type beats
 * a subtype, because the adapters set `signalType` precisely and `subtype` is
 * a coarse family. Nothing is guessed from the title text -- prose matching is
 * how a rule silently stops working when somebody rewords a string.
 */
export function opportunityKind(item: ExploreItem): OpportunityKind {
  const sig = (item.signalType ?? '').toLowerCase()

  /* Checked before the substring rules below, which would otherwise claim it:
     `coverage_prompt` contains neither, but a future framing-qualified type
     might, and the exact match is the producer's own statement of what this
     is. An exact type always beats a substring guess. */
  if (sig === 'coverage_prompt') return 'coverage_gap'

  if (sig.includes('price') || sig.includes('move') || sig.includes('drift')) return 'price_move'
  if (sig.includes('thesis') || sig.includes('case')) {
    return sig.includes('no_') || sig.includes('missing') ? 'no_thesis' : 'new_evidence'
  }
  if (sig.includes('weight') || sig.includes('exposure') || sig.includes('active')) return 'exposure'
  if (sig.includes('evidence') || sig.includes('research') || sig.includes('note')) return 'new_evidence'
  if (sig.includes('scenario') || sig.includes('target') || sig.includes('ladder')) return 'framework'

  switch (item.subtype) {
    case 'research': return 'new_evidence'
    case 'workflow': return 'workflow'
    case 'idea': return 'authored'
    case 'signal': return 'framework'
    default: return 'other'
  }
}

/**
 * The opportunity set, in the order the ranker already put it.
 */
export function opportunitiesFrom(
  composed: readonly ComposedExploreItem[],
): Opportunity[] {
  const out: Opportunity[] = []
  for (const c of composed) {
    if (!isIdeaWorthy(c.item)) continue
    out.push({ composed: c, item: c.item, kind: opportunityKind(c.item) })
  }
  return out
}

/**
 * The engagement target for an opportunity: what Ask AI and a thread are about.
 *
 * ── Why this is not `targetFor` ───────────────────────────────────────────
 *
 * `model.targetFor` takes an `IdeaRow` -- an authored idea with a maturity, a
 * conviction and a thesis. An opportunity is a CANDIDATE and has none of those
 * by definition, so handing one to that builder would mean inventing a
 * maturity for something nobody has staged. Both builders return the same
 * type and both bind to the ASSET, which is the part that matters: a thread
 * raised from a candidate and a thread raised from the idea it becomes point
 * at the same object and land in the same place.
 *
 * Null where there is no asset id. The lens shows the candidate and simply
 * omits the actions rather than offering one that would open nothing --
 * the same rule the authored field applied through `discussable`.
 *
 * Every chip below is a field an adapter already set. Nothing is derived, and
 * the chips are display-only: the model's real context is assembled
 * server-side from the conversation's tags.
 */
export function targetForOpportunity(o: Opportunity): EngagementTarget | null {
  const { item } = o
  if (!item.assetId) return null

  const chips: { label: string; value: string }[] = []
  chips.push({ label: 'Raised by', value: OPPORTUNITY_LABEL[o.kind] })
  if (item.portfolio?.weightPct != null) {
    chips.push({ label: 'Weight', value: `${item.portfolio.weightPct.toFixed(1)}%` })
  }
  if (item.portfolio?.name) chips.push({ label: 'Portfolio', value: item.portfolio.name })
  if (item.metric?.value) {
    chips.push({ label: item.metric.label ?? 'Metric', value: item.metric.value })
  }

  return {
    objectType: 'asset',
    objectId: item.assetId,
    label: item.companyName && item.symbol
      ? `${item.symbol} — ${item.companyName}`
      : (item.symbol ?? item.companyName ?? 'Asset'),
    symbol: item.symbol ?? undefined,
    assetId: item.assetId,
    portfolioName: item.portfolio?.name ?? undefined,
    origin: { itemId: item.id, surface: 'ideas' },
    issue: {
      /* The producer's own headline and clause. This layer does not write
         prose about a finding it did not detect. */
      title: item.title,
      detail: item.context ?? undefined,
      reason: `opportunity:${o.kind}`,
      detectedAt: item.occurredAt ?? undefined,
    },
    contextChips: chips,
  }
}

/**
 * How much room each opportunity gets, as a heterogeneous ranked grid.
 *
 * ── Why this is not `sizeByRank` ─────────────────────────────────────────
 *
 * The other lenses rank one kind of object, so position alone can decide size.
 * This lens ranks a MIX, and the ranker has already marked which candidates
 * lead (`emphasis === 'feature'`) using evidence this module does not have.
 * Reading that beats re-deriving it.
 *
 * Position still decides the rest, so the grid stays a ranked field rather
 * than a bag of equal cards -- but a featured candidate is never demoted by
 * where it happens to land.
 */
export type OpportunitySize = 'hero' | 'large' | 'medium' | 'compact'

/**
 * Room is decided by the CANDIDATE, not by where it landed.
 *
 * ── Why the first version was wrong ──────────────────────────────────────
 *
 * It graded monotonically by index -- hero, large, large, medium, medium,
 * compact... -- so the page shrank as it scrolled and every wide card was at
 * the top. That is the "gradually larger/smaller" shape reported, and it also
 * makes size unexplainable: the same candidate is wide on one load and narrow
 * on the next because something above it changed.
 *
 * Mobile settled this already, and `explore-layout` says it plainly: size is a
 * property of the ITEM ("does this content warrant width"), and the page-level
 * budget is separate ("how much emphasis can one page carry before emphasis
 * stops being emphasis"). Conflating them is what made the old mobile rule
 * unexplainable too.
 *
 * So `exploreCardSize` decides, from the candidate's own facts, and a wide
 * card can therefore appear at rank 9 -- which is what scatters them down the
 * page instead of front-loading them.
 *
 * ── Order is still untouched ─────────────────────────────────────────────
 *
 * Nothing here reorders. A larger cell further down does not claim that item
 * outranks the ones above it; emission order is the ranker's and stays the
 * ranker's. Size says "this one has more to show", which is a different claim
 * from "this one matters more".
 */
export function opportunitySize(o: Opportunity, index: number): OpportunitySize {
  /* The strongest candidate leads, whatever its content would otherwise earn.
     A page whose first cell is compact reads as having nothing to say. */
  if (index === 0) return 'hero'

  const { size } = exploreCardSize(o.item)
  if (size === 'feature') return 'large'
  if (size === 'standard') return 'medium'
  return 'compact'
}

/**
 * The page's emphasis budget, applied after sizing and never inside it.
 *
 * `MAX_FEATURES` is mobile's number and mobile's reasoning: emphasis stops
 * being emphasis past a handful of it. Applied here so a demotion is a visible
 * page constraint rather than something hidden in the size rule -- and it
 * never changes what a candidate IS, only how much room this page can spare.
 *
 * The hero is not counted against the budget: it is the lead, not a feature.
 */
export function withFeatureBudget(
  sizes: readonly OpportunitySize[],
  max = MAX_FEATURES,
): OpportunitySize[] {
  let spent = 0
  return sizes.map((s, i) => {
    if (i === 0 || s !== 'large') return s
    spent += 1
    return spent <= max ? s : 'medium'
  })
}

/** The reader-facing name for a kind. One vocabulary, set in one place. */
export const OPPORTUNITY_LABEL: Record<OpportunityKind, string> = {
  price_move: 'Price move',
  no_thesis: 'No thesis',
  exposure: 'Exposure',
  new_evidence: 'New research',
  framework: 'Framework',
  workflow: 'Assigned work',
  authored: 'Written by someone',
  /* Names the SOURCE, not the gap -- the gap is already in the headline the
     candidate wrote, and the fact the reader cannot get anywhere else is that
     this came off their coverage rather than off someone's pen. */
  coverage_gap: 'From your coverage',
  other: 'Worth a look',
}
