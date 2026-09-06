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

/**
 * How much room a card gets.
 *
 * ── Why a third value, and what its absence was doing ────────────────────
 *
 * This was `feature | compact`, and the binary is what flattened the surface.
 * Three separate mechanisms all ended at the SAME fallback:
 *
 *   1. `NEVER_FEATURED` bars news, workflow and idea from width outright —
 *      31 of the 60 live tiles.
 *   2. The three feature tests are deliberately high bars: a 5% position WITH
 *      a metric, a decision the ranker rated 0.7+, or a picture that cannot be
 *      read narrow. Substantive items that clear none of them fall through.
 *   3. The packer demotes features over budget.
 *
 * With two values every one of those paths lands on `compact`, so a research
 * finding with a real number, a story about a 30% holding, and a one-line task
 * all render as the same half-width box. Six families collapse into "big
 * signal card" and "generic small card", and the surface reads as a masonry of
 * templates rather than a map of what is happening.
 *
 * `standard` is the missing middle: full width, shallower than a feature. It
 * is also the new DEFAULT, which is the other half of the fix. Compact stopped
 * being where unclassified things land and became something a card earns by
 * being genuinely short — see `earnsCompact`.
 */
export type ExploreCardSize = 'feature' | 'standard' | 'compact'

/**
 * The vertical rhythm variants. Three, deliberately — one per shape of content,
 * not one per card type.
 *
 * A grid with a different height for every subtype has no rhythm; a grid with
 * one height for everything either crops the long cards or pads the short ones.
 * These three are the distinct shapes: a text card, a text card with a chart
 * under it, and a wide card.
 */
export type ExploreCardHeight =
  | 'compact' | 'compact-chart' | 'standard' | 'feature' | 'banner'

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
 * How many characters of claim survive half width before the meaning does not.
 *
 * A compact cell is ~170px at 390px of viewport, and the tile headline is
 * 15px semibold — about 19 characters a line. Two lines is the point past
 * which a headline stops being scannable and becomes a paragraph in a box:
 *
 *   "Eric Lockenvitz on GOOGL"                                24  — fine
 *   "Price Target Expired: AMZN Base"                         31  — fine
 *   "McDonald's launches exclusive state-themed meal"          46  — 3 lines
 *   "AAPL has moved +28.2% since its thesis was last written"  54  — 4 lines
 *
 * The last two are the reported symptom. This is the "does the headline
 * survive at half width" test the composition rule needs, expressed as the one
 * thing that actually decides it.
 */
const COMPACT_CLAIM_CHARS = 38

/**
 * The exposure at which a story stops being news and becomes a desk event.
 *
 * Lower than `MATERIAL_WEIGHT_PCT`, deliberately. That threshold decides
 * whether a finding is a portfolio event worth a FEATURE's depth; this one
 * only decides whether a story has a second thing to show at all, and a 2%
 * holding is enough for "we own this" to be the more useful half of the card.
 * A name held in more than one book clears it regardless of size, because the
 * count is itself the finding.
 */
const NEWS_RELEVANT_WEIGHT_PCT = 2

/**
 * Pictures that stay legible in a 170px cell.
 *
 * `none` has nothing to show and `quote` is already prose — a wider box gives
 * the same words more air. `exposure` is one number, one bar and a book name,
 * which reads perfectly narrow; that judgment predates this pass and is not
 * one this pass has any evidence against, so it stands.
 *
 * Everything else carries a second dimension that a half-width cell destroys:
 * a price against a target, a path since a date, a stage in a pipeline. Those
 * are the cards this file was flattening.
 */
const NARROW_LEGIBLE_VISUALS = new Set(['none', 'quote', 'exposure'])

/**
 * Can this item be understood in a second and a half, at half width?
 *
 * Compact is now something a card EARNS rather than where unclassified cards
 * land, so this is a positive test and everything it rejects goes to
 * `standard`. Three ways to earn it, all of them "there is not much here":
 *
 *   • assigned work — a task is an asset, an action and a date, and the whole
 *     point of it is density; a wide task card is a deadline with air around it
 *   • a remark — an idea whose visual is the quote itself
 *   • a bare statement — no picture and no number, just a short line
 *
 * In every case the claim must also physically fit. A task with a 60-character
 * title is still a task, and it still wraps to four lines in a 170px cell, so
 * the length test applies to all three rather than only to the last.
 */
function earnsCompact(item: ExploreItem, visual: string): boolean {
  const fits = (item.title ?? '').trim().length <= COMPACT_CLAIM_CHARS

  // A task is an asset, an action and a date. Density is the entire point of
  // it, and a wide task card is a deadline with air around it.
  if (item.subtype === 'workflow') return fits

  /**
   * A story is judged on the desk, not on its headline length.
   *
   * The headline is somebody else's sentence and it is nearly always too long
   * to fit — judged on length alone every story took a row, which is how 15 of
   * 60 tiles became full width and the page became a single column.
   *
   * It is also the wrong question. The headline is evidence; the product is
   * whether this desk owns the name and how much of it. A story about a 30%
   * position earns the row because there is a real second thing to show. A
   * story about a name nobody holds is a headline, and a headline clamps to
   * two lines perfectly well in a narrow cell.
   */
  if (item.subtype === 'news') {
    const weight = item.portfolio?.weightPct ?? 0
    const books = item.portfolio?.heldInCount ?? 0
    return !(weight >= NEWS_RELEVANT_WEIGHT_PCT || books > 1)
  }

  // Everything else: it must physically fit AND have no picture that a
  // half-width cell would destroy.
  return fits && NARROW_LEGIBLE_VISUALS.has(visual)
}

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

  /**
   * Barred from FEATURE, which is not the same as sentenced to compact.
   *
   * This was an early `return compact`, and it was the single biggest cause of
   * the flattening: news, workflow and idea are 31 of the 60 live tiles, and
   * every one of them left this function at half width without any of the
   * rules below ever running. A 46-character story headline and a 24-character
   * post got identical boxes, because neither was ever asked.
   *
   * The set's own name is the correct rule. These families have no second
   * dimension that a FEATURE's depth would show — a story at double height is
   * the same sentence with more air. Whether the row is warranted is a
   * different question, and it is the one the tests below answer.
   */
  const barred = NEVER_FEATURED.has(item.subtype)

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
  if (!barred && weight >= MATERIAL_WEIGHT_PCT && item.metric) {
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
  if (!barred && item.category === 'decisions' && (item.importance ?? 0) >= HIGH_PRIORITY) {
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
  if (!barred && visualNeedsWidth(kind)) {
    return { size: 'feature', reason: `${kind}: the visual needs the width to be read` }
  }

  /**
   * Everything below here used to be one `return compact`.
   *
   * The three feature tests above are high bars, correctly — emphasis that is
   * spent everywhere is not emphasis. But "did not clear the feature bar" is
   * not the same claim as "can be read in a second at half width", and
   * collapsing the two is what put a research finding with a real number in
   * the same box as a one-line task.
   */
  if (earnsCompact(item, kind)) {
    return { size: 'compact', reason: `${kind}: short enough to read at half width` }
  }

  /**
   * The default, and deliberately so.
   *
   * A card reaches here because it has something to show — a picture with a
   * second dimension, a number about a name, or a claim too long to survive a
   * 170px cell — and not enough significance to take a feature's depth. That
   * is the majority of a real page, and it is exactly the population that was
   * being crushed.
   */
  if (!NARROW_LEGIBLE_VISUALS.has(kind)) {
    return { size: 'standard', reason: `${kind}: a second dimension worth the width` }
  }
  return { size: 'standard', reason: 'the claim does not survive half width' }
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
   * Full width, and shallower than a feature on purpose.
   *
   * A standard card puts its text and its evidence side by side rather than
   * stacked, so it needs about the height of one compact card even though it
   * spans the row. Making it as tall as a feature would spend a feature's
   * emphasis on something that did not earn it, and the whole point of the
   * role is that width and depth are separable.
   */
  if (size === 'standard') return 'standard'
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
 * How far the packer may reach for a SECOND COMPACT, and only for that.
 *
 * Separate from `LOOKAHEAD` because it answers a different question. That one
 * bounds how far the page may reorder findings; this one bounds how far it may
 * reach to avoid stranding a card that has already been judged too slight to
 * need a row. Eight is about two screens of mixed content — far enough to pair
 * the tasks and short remarks a real page carries, near enough that a promoted
 * card is still recognisably where the ranker put it.
 */
export const COMPACT_PARTNER_REACH = 8

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
      /**
       * Demoted to STANDARD, not to compact.
       *
       * The budget's claim is "this page has had enough emphasis", which is an
       * argument about depth. It was being used to also strip the card's
       * width, so an item that earned a feature on its merits could end up in
       * a 170px cell because three other cards happened to arrive first — the
       * same "size depends on arrival" problem this file was written to
       * remove, surviving in the one place the page is allowed to overrule.
       *
       * Standard keeps the row and gives back the depth, which is what the
       * budget was actually asking for.
       */
      head.size = 'standard'
      head.height = exploreCardHeight(head.entry.item, 'standard')
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

    /**
     * A standard card takes the row without spending the budget.
     *
     * It is not emphasis — it is the ordinary width for something with a
     * second dimension — so it neither counts against `MAX_FEATURES` nor sets
     * `lastRowWasFeature`. Counting it would starve the page of features;
     * setting the flag would mean a feature could never follow one, which is a
     * perfectly good rhythm (STANDARD then FEATURE) and not a defect.
     */
    if (head.size === 'standard') {
      out.push(headCard('full'))
      recentVisuals.push(head.visual)
      placed += 1
      lastRowWasFeature = false
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
    /**
     * A longer reach, for compacts only, because compacts became rare.
     *
     * `LOOKAHEAD` is 3 — one row plus a wide card — and that was the right
     * number when most of the page was compact and a partner was almost always
     * the very next item. Now that compact is earned rather than assumed, two
     * of them are often five or six apart with standards in between, and a
     * three-item window finds nothing.
     *
     * The failure that causes is not a hole; it is worse. A lone compact falls
     * through to the "nothing in reach" branch below and renders full width, so
     * a page with few compacts renders as sixty full-width cards and the role
     * disappears entirely — measured: every card on the first screen came back
     * `span: full`, including the tasks.
     *
     * So the reach is longer HERE and nowhere else. It only ever pulls a
     * compact card forward, which is the cheapest possible reordering — a
     * one-line task moving up four places changes nothing a reader is tracking
     * — and `promotedBy` still records the distance for review. Features and
     * standards keep their ranked positions exactly.
     */
    if (partnerAt < 0) {
      const reach = Math.min(COMPACT_PARTNER_REACH, queue.length)
      for (let i = window; i < reach; i++) {
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
    // `emphasis` is the DOM contract the phone suite measures, and it has two
    // values. A standard card is wide but is not emphasis, so it maps with
    // compact — the `data-explore-span` attribute is what now distinguishes
    // the two, and it is the thing that actually changed.
    entry: { ...card.entry, emphasis: (card.size === 'feature' ? 'feature' : 'standard') as ExploreEmphasis },
  }))
}
