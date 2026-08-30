import type { ComposedExploreItem, ExploreEmphasis, ExploreItem } from './explore-item'
import { exploreVisualKind, visualNeedsWidth, type ExploreVisual } from './explore-visual'

/**
 * How big an Explore card is, and how the cards fill the grid.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `assignEmphasis` decided width with one OR over three unrelated conditions
 * — aggregate, or a 5% position, or a decision the ranker scored above 0.7 —
 * gated on the item's INDEX in the composed order. Two rules of a page's shape
 * were therefore properties of arrival rather than of content, and the result
 * read as accidental because it was:
 *
 *   • AMZN led at 14.2% of a book, so it took the full width.
 *   • MSFT and JNJ were under the weight bar and paired.
 *   • TGT was under it too and had nowhere to pair, because the next item was
 *     itself wide — leaving half a row of page showing.
 *   • PG was over the bar and far enough from AMZN to clear `FEATURE_GAP`, so
 *     it went wide again.
 *
 * Nothing there is wrong item by item. It is unexplainable as a page, and the
 * hole under TGT is not a styling bug at all: a `col-span-full` tile landing on
 * an odd column offset leaves the preceding cell empty, and CSS grid has no
 * reason to fill it.
 *
 * ── The split this file makes ─────────────────────────────────────────────
 *
 * **Size is a property of the item.** `exploreCardSize` reads only the item —
 * what kind of thing it is, how material it is, what the ranker thought of it,
 * whether it has evidence worth width. Never the ticker, never the position in
 * the list. The same item is the same size wherever it lands.
 *
 * **Packing is a property of the page.** `packExplore` walks the ranked order
 * and decides which cards share a row, promoting a later compact card by at
 * most `LOOKAHEAD` places when doing so closes a hole. That is the only
 * reordering it performs, and it is bounded so ranking still means something.
 *
 * Keeping these apart is what makes both testable: sizing has no order to
 * perturb, and packing has no content to reason about beyond the size.
 *
 * Pure — no React, no Supabase. The gallery imports it directly.
 */

/** How much room a card gets. Two values, so "featured" keeps meaning one thing. */
export type ExploreCardSize = 'feature' | 'compact'

/**
 * The vertical rhythm variants. Three, deliberately — one per shape of content,
 * not one per card type.
 *
 * A grid with a different height for every subtype has no rhythm; a grid with
 * one height for everything either crops the long cards or pads the short ones.
 * These three are the distinct shapes: a text card, a text card with a chart
 * under it, and a wide card.
 */
export type ExploreCardHeight = 'compact' | 'compact-chart' | 'feature' | 'banner'

/** Why a card is the size it is. Rendered nowhere; asserted in tests, read in review. */
export interface ExploreSizeDecision {
  size: ExploreCardSize
  reason: string
}

/**
 * A position big enough that its card is about the book, not just the name.
 *
 * The same threshold the old rule used, kept because it is the right one: at
 * this weight a finding is a portfolio event rather than a research note.
 */
const MATERIAL_WEIGHT_PCT = 5

/** What the ranker has to think of a decision before width is warranted. */
const HIGH_PRIORITY = 0.7

/**
 * Families that are never featured, and why each one.
 *
 * ── Why this is a deny-list rather than an allow-list ─────────────────────
 *
 * The brief's rule is that width must be *earned by the content*, and the
 * things that cannot earn it are a short closed set: a headline somebody else
 * wrote, a task with a due date, and a colleague's post. None of those has a
 * second dimension a wide card would show — a news tile at double width is the
 * same sentence with more air around it.
 *
 * Everything else is judged on its merits below. An allow-list would mean a new
 * subtype silently defaulting to compact, which is the failure mode this file
 * exists to remove: a rule nobody can explain from the page.
 */
const NEVER_FEATURED = new Set(['news', 'workflow', 'idea'])

/**
 * How big this card is, from the item alone.
 *
 * Deterministic and total: every item gets an answer, and the answer does not
 * depend on what else is on the page, what order it arrived in, or which ticker
 * it is about.
 */
export function exploreCardSize(item: ExploreItem): ExploreSizeDecision {
  /**
   * An aggregate stands for several things, so it is several things wide.
   *
   * It is also the only card whose tap does not open a surface — it narrows the
   * grid — and width is how a reader tells those apart before spending the tap.
   */
  if (item.subtype === 'aggregate') {
    return { size: 'feature', reason: 'aggregate: stands for several items' }
  }

  if (NEVER_FEATURED.has(item.subtype)) {
    return { size: 'compact', reason: `${item.subtype}: no second dimension to show` }
  }

  /**
   * A material position, with a number to put in the width.
   *
   * Both halves matter. Weight alone featured cards that had nothing to fill
   * the space with — the old rule's most common wide card was a bare headline
   * over a 6% holding. A metric is the thing a wide card is FOR: the headline
   * gets its own line, the number gets prominence, and the chart gets enough
   * width to be read rather than decoded.
   */
  const weight = item.portfolio?.weightPct ?? 0
  if (weight >= MATERIAL_WEIGHT_PCT && item.metric) {
    return { size: 'feature', reason: `material position (${weight.toFixed(1)}%) with a metric` }
  }

  /**
   * A decision the ranker rated highly, whatever it weighs.
   *
   * §17: a high-value Tesseract signal must not be buried under a low-value
   * article purely on type. This is the clause that prevents it — a breach the
   * ranker scored 0.9 on a 2% position is still the most consequential thing on
   * the page, and it gets the width even though the holding is small.
   */
  if (item.category === 'decisions' && (item.importance ?? 0) >= HIGH_PRIORITY) {
    return { size: 'feature', reason: `high-priority decision (${(item.importance ?? 0).toFixed(2)})` }
  }

  /**
   * A picture that cannot be read at half width earns the row.
   *
   * A range bar with three labelled cases and a marker outside it, or a
   * two-span timeline with three dates under it, is unreadable in a 170px
   * cell — the labels collide and the thing the card exists to show becomes a
   * smudge. An exposure bar and a quote are fine narrow, and stay narrow.
   *
   * Last, so it never outranks materiality or priority: this promotes a card
   * that had no other claim to width, it does not demote one that did.
   */
  const kind = exploreVisualKind(item)
  if (visualNeedsWidth(kind)) {
    return { size: 'feature', reason: `${kind}: the visual needs the width to be read` }
  }

  return { size: 'compact', reason: 'no material position, metric or priority to justify width' }
}

/** Which of the three rhythm variants this card renders at. */
export function exploreCardHeight(item: ExploreItem, size: ExploreCardSize): ExploreCardHeight {
  /**
   * An aggregate is a banner, and width is the whole of what it needs.
   *
   * It gets the full row because it stands for several things — but its content
   * is one sentence and a "See all", and a featured card's floor under one
   * sentence is 160px of nothing. Measured: "3 research updates this week" drew
   * a 90px-tall headline in a 164px box between rows of 200, and read as a card
   * that had failed to load rather than as a summary.
   *
   * So: full width, short. The two are independent decisions and this is the
   * one case where they come apart.
   */
  /**
   * A banner, not a short card.
   *
   * An aggregate is one line of text and one action, at full width. Given a
   * card's floor it drew a 132px box around ~50px of content, and the two of
   * them were the emptiest tiles on the page while also being the widest —
   * visual weight in inverse proportion to how much each had to say.
   *
   * Its own variant rather than a smaller `compact`, because it is a different
   * shape of thing: a rule between sections that happens to be tappable. The
   * floor still exists, it is just set to what a banner needs.
   */
  if (item.subtype === 'aggregate') return 'banner'
  if (size === 'feature') return 'feature'
  /**
   * The taller variant is for cards carrying a PICTURE, whatever kind.
   *
   * It used to mean "has a chart", which after the archetype split would have
   * left a range bar, a timeline and an exposure bar squeezed into the short
   * box while a news story with a ticker got the tall one. The question the
   * height is answering is "is there a visual under the text", and that is now
   * the archetype rather than the presence of a symbol.
   */
  return exploreVisualKind(item) === 'none' ? 'compact' : 'compact-chart'
}

/**
 * How far ahead the packer may reach to close a hole.
 *
 * Three, which is one row plus a wide card. Far enough to fill the common case
 * — a compact card followed by a feature followed by more compacts — and near
 * enough that a reader cannot perceive the reordering as the ranking being
 * ignored. Unbounded lookahead would pack perfectly and turn the page into an
 * arbitrary order, which is the failure the ranking exists to prevent.
 */
export const LOOKAHEAD = 3

/**
 * How many wide cards a page may spend, and why there is a limit at all.
 *
 * Size is a property of the item; a BUDGET is a property of the page, and the
 * two are separate on purpose. `exploreCardSize` answers "does this item's
 * content warrant width", which has nothing to do with what else is on screen.
 * The budget answers "how much emphasis can one page carry before emphasis
 * stops being emphasis", which is only about what else is on screen.
 *
 * Conflating them is what made the old rule unexplainable — an item's width
 * depended on its index, so the same item was wide on one page and narrow on
 * another for no reason a reader could name. Here a demotion is a page
 * constraint, applied last, visible in the packer, and it never changes what
 * the item IS.
 */
export const MAX_FEATURES = 4

/** One card, placed. `span` is what the grid needs; `height` is the rhythm variant. */
export interface PackedExploreCard {
  entry: ComposedExploreItem
  size: ExploreCardSize
  /** `full` for a feature, and for a compact card with genuinely nothing to pair with. */
  span: 'full' | 'half'
  height: ExploreCardHeight
  /** How far this card moved from its ranked position to close a hole. 0 for most. */
  promotedBy: number
}

/**
 * Arrange sized cards into rows that leave no holes.
 *
 * The algorithm, in full:
 *
 *   1. Take the next card in ranked order.
 *   2. A feature takes the row alone.
 *   3. A compact card looks for a partner: the next compact card within
 *      `LOOKAHEAD`, preferring one of the same height variant so the row's two
 *      halves have the same shape.
 *   4. If there is no partner in reach, the compact card spans the row instead
 *      of sitting beside a hole.
 *
 * Step 4 is the one worth defending. The alternative — leave the cell empty —
 * is what produced the gap beside TGT, and a reader cannot tell an empty cell
 * from a card that failed to render. A single wide compact card is at least
 * legible as a decision. It is also rare: it needs `LOOKAHEAD` consecutive
 * features, or the end of the page on an odd count.
 *
 * Deterministic. No clock, no randomness, and the input order is the only
 * ordering input.
 */
/**
 * How many cards in a row may share one archetype before the page looks flat.
 *
 * Two. Three identical pictures in sequence is the point at which a reader
 * stops seeing cards and starts seeing wallpaper — which is the complaint the
 * whole archetype split exists to answer, and it would return the moment the
 * ranker happened to hand over four exposure bars.
 *
 * This is a PRESENTATION constraint and it is deliberately weak: it may only
 * bring a card forward from within the existing lookahead window, never push
 * one back and never reorder beyond it. Priority decides what appears; this
 * decides only which of two adjacent-ranked cards is drawn first.
 */
export const MAX_SAME_VISUAL_RUN = 2

export function packExplore(entries: ComposedExploreItem[]): PackedExploreCard[] {
  const queue = entries.map((entry, rank) => {
    const { size } = exploreCardSize(entry.item)
    return {
      entry, rank, size,
      height: exploreCardHeight(entry.item, size),
      visual: exploreVisualKind(entry.item),
    }
  })

  const out: PackedExploreCard[] = []
  let placed = 0
  let featuresUsed = 0
  let lastRowWasFeature = false
  /** The archetypes already placed, most recent last. Presentation only. */
  const recentVisuals: ExploreVisual['kind'][] = []

  while (queue.length) {
    /**
     * Break a run of identical pictures, if something near by can break it.
     *
     * Looks only inside the same `LOOKAHEAD` window the partner search uses,
     * and only when the last two placed cards already share the incoming
     * card's archetype. If nothing in the window differs, the run stands —
     * a page that genuinely holds six exposure findings should show six, not
     * reorder itself into incoherence to look varied.
     */
    if (recentVisuals.length >= MAX_SAME_VISUAL_RUN) {
      const run = recentVisuals.slice(-MAX_SAME_VISUAL_RUN)
      const stuck = run.every(v => v === queue[0].visual) && queue[0].visual !== 'none'
      if (stuck) {
        const window = Math.min(LOOKAHEAD, queue.length)
        for (let i = 1; i < window; i++) {
          if (queue[i].visual !== queue[0].visual) {
            queue.unshift(queue.splice(i, 1)[0])
            break
          }
        }
      }
    }

    const head = queue.shift()!

    /**
     * The two page-level constraints, applied before anything is placed.
     *
     * A spent budget, or a feature row immediately above, and this card renders
     * at compact size instead. It keeps its rank — nothing moves — and it keeps
     * its earned size in `exploreCardSize`, which is what tests and review read.
     * Only the page says no.
     *
     * "A feature never follows a feature" replaces the old `FEATURE_GAP`, which
     * counted ITEMS between wide cards and so depended on how the compacts
     * between them happened to pair. Counting rows is the thing a reader
     * actually sees.
     */
    if (head.size === 'feature' && (featuresUsed >= MAX_FEATURES || lastRowWasFeature)) {
      head.size = 'compact'
      head.height = exploreCardHeight(head.entry.item, 'compact')
    }

    const headCard = (span: 'full' | 'half'): PackedExploreCard => ({
      entry: head.entry, size: head.size, span, height: head.height,
      promotedBy: 0,
    })

    if (head.size === 'feature') {
      out.push(headCard('full'))
      recentVisuals.push(head.visual)
      placed += 1
      featuresUsed += 1
      lastRowWasFeature = true
      continue
    }
    lastRowWasFeature = false

    /**
     * The partner search, preferring shape.
     *
     * Two passes over the same bounded window rather than one scored pass: the
     * preference is strictly lexicographic — a same-shape partner always beats
     * a nearer one — and expressing that as a score would invite somebody to
     * tune weights on a decision that has no continuum in it.
     */
    const window = Math.min(LOOKAHEAD, queue.length)
    let partnerAt = -1
    for (let i = 0; i < window; i++) {
      if (queue[i].size === 'compact' && queue[i].height === head.height) { partnerAt = i; break }
    }
    if (partnerAt < 0) {
      for (let i = 0; i < window; i++) {
        if (queue[i].size === 'compact') { partnerAt = i; break }
      }
    }

    if (partnerAt < 0) {
      // Nothing in reach. A wide compact card, not half a row of page.
      out.push(headCard('full'))
      recentVisuals.push(head.visual)
      placed += 1
      continue
    }

    const partner = queue.splice(partnerAt, 1)[0]
    out.push(headCard('half'))
    recentVisuals.push(head.visual, partner.visual)
    out.push({
      entry: partner.entry, size: partner.size, span: 'half', height: partner.height,
      // How far it came forward: its ranked position against where it landed.
      promotedBy: Math.max(0, partner.rank - (placed + 1)),
    })
    placed += 2
  }

  return out
}

/**
 * The composed page, sized and packed.
 *
 * `emphasis` on the entry is kept in step with the size so the existing
 * `data-emphasis` contract — and the phone suite that measures it — still
 * describes what is on screen.
 */
export function layoutExplore(entries: ComposedExploreItem[]): PackedExploreCard[] {
  return packExplore(entries).map(card => ({
    ...card,
    entry: { ...card.entry, emphasis: (card.size === 'feature' ? 'feature' : 'standard') as ExploreEmphasis },
  }))
}
