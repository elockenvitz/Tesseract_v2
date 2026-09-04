import {
  rowsVisual, plotVisual, interactivePlotVisual, TILE_COST,
  type TileRequirement, type VisualRequirement,
} from '../signals/tile-geometry'
import { insightPanePlan } from '../signals/pane-plan'
import { ideaPanePlan, newsPanePlan } from '../signals/pane-plan'
import { ideaCardType } from '../signals/builders/ideas'

type AnyEntry = Record<string, any>

/**
 * What a feed entry will need on screen, before its card is built.
 *
 * ── The boundary this file exists to hold ─────────────────────────────────
 *
 * `tile-geometry.ts` cannot see a SignalType, and must not. But something has
 * to translate "an unwritten position with three missing thesis sections" into
 * "a claim, one context row and a three-row visual" — that translation is
 * domain knowledge and it lives here. The rule is a one-way valve:
 *
 *     this file   knows domain state, returns SHARED REQUIREMENTS
 *     the resolver knows requirements, returns PIXELS
 *
 * So an adapter below may branch on entry kind. It may never return a height,
 * a tier, or anything that resolves to one. If a future reader finds `448` in
 * this file, the boundary has been broken.
 *
 * ── Why the entry and not the card ────────────────────────────────────────
 *
 * `FeedSlot` reserves a box for entries it has not mounted. A requirement read
 * off a rendered card would exist only for tiles already passed, so a deep
 * offset would mean two different things depending on how the reader got
 * there. Everything here reads fields the entry already carries.
 *
 * ── Why the pane planners, and not a second copy of their rules ───────────
 *
 * A pane is a real part of a card's height, and which panes exist is already
 * decided by `insightPanePlan`, `newsPanePlan` and `ideaPanePlan`. Restating
 * those conditions here would be a second prediction of the same thing, free
 * to drift — and the failure mode of geometry disagreeing with the renderer is
 * a clipped card. Only `guaranteed` is consulted: an eligible-but-async pane
 * (a price series that may not resolve) must not have room reserved for it,
 * which is the same lesson the fixture work landed on.
 */

/** Two lines is what the card clamps prose to; anything longer is a drawer. */
const CLAMPED_BODY_LINES = 2

/** Core thesis sections a case is scored against. Drives the rows visual. */
const THESIS_ROWS = 3

/** Bear, base and bull — the cases an untargeted position is missing. */
const CASE_ENTRY_ROWS = 3

/**
 * Connecting phrasing in a GENERATED claim, in characters.
 *
 * Some families do not carry a headline on the entry — a lens is domain state
 * and its sentence is composed later — so the claim length has to be estimated
 * from the nouns that sentence will contain plus the words between them. One
 * shared constant, deliberately: a per-family number here would be a fixed
 * height wearing a disguise, which is the whole thing this file exists to
 * avoid. It is only ever an input to `claimLinesAt`, so being a few characters
 * out changes a line count at worst, never a family's geometry rule.
 *
 * Raised from 34 by the calibration suite: a real lens claim reads like "MSFT
 * is 6.2% of Core Equity against 3.1% in the benchmark" — 57 characters for a
 * 4-character symbol and an 11-character book, so the connecting words are
 * closer to 42. Under-counting here cost a claim line, and a claim line is
 * 30px the card did not reserve.
 */
const CLAIM_PHRASING_CHARS = 42

/** A claim the card will compose from these nouns. */
function generatedClaimChars(...parts: unknown[]): number {
  const nouns = parts.reduce<number>(
    (n, p) => n + (typeof p === 'string' ? p.length : 0), 0)
  return nouns + CLAIM_PHRASING_CHARS
}

/**
 * The entry kinds the feed actually produces.
 *
 * Anything here must resolve to a requirement; anything not here is unknown
 * input and gets the defensive fallback. Exported so a test can hold the two
 * lists together — see `tile-requirement.test.ts`, which is what makes a new
 * family's missing adapter visible instead of silently full-height.
 */
export const PRODUCTION_ENTRY_KINDS = [
  'scenario', 'template', 'signal', 'insight', 'news', 'idea', 'lens', 'attention',
] as const

function claimCharsOf(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().length
  }
  return 0
}

/** One row of chips holds a couple of short labels; more wrap to a second. */
function contextRowsFor(n: number): number {
  if (n <= 0) return 0
  return n <= 2 ? 1 : 2
}

/**
 * A contract card describes itself; this reads it without interpreting it.
 *
 * `hasDetail` is passed by the caller rather than read off the card, because a
 * detail region is composed by the renderer, not declared by the contract. It
 * is a second region below the band and it carries its own floor, so a card
 * with both must budget for both — modelling them as one collapsed the detail
 * below its minimum on three shipping compositions.
 */
function fromContractCard(
  card: AnyEntry, visual: VisualRequirement | null, hasDetail = false,
): TileRequirement {
  return {
    claimChars: claimCharsOf(card.headline),
    hasMetric: !!card.metric,
    hasPrompt: !!card.prompt,
    hasDetailRegion: hasDetail,
    contextRows: contextRowsFor(card.context?.length ?? 0),
    bodyLines: card.body ? CLAMPED_BODY_LINES : 0,
    visual,
    hasActionTray: true,
    workflow: 'passive',
  }
}

export interface RequirementOptions {
  /**
   * The reader is working in this tile — a response open, a note being
   * written. Known by the feed because the feed owns the state that put it
   * there, never inferred from the DOM.
   */
  workflow?: 'passive' | 'active'
}

/**
 * The requirement for one entry, or null when this file cannot describe it.
 *
 * Null is the honest answer for a shape nobody has taught it, and the caller
 * treats it as "give this tile the whole feed" — which is exactly the
 * behaviour every tile had before geometry existed. A wrong guess clips a
 * card; no guess costs a little room on a family nobody has measured.
 */
/**
 * The taller of two declared visuals, or whichever one exists.
 *
 * Panes in a carousel share a viewport, so their requirements combine by
 * `max`, never by sum — summing would reserve room for a chart AND the rows it
 * is paged against, on a surface where the card already has exactly one screen.
 */
function maxVisual(
  a: VisualRequirement | null, b: VisualRequirement | null,
): VisualRequirement | null {
  if (!a) return b
  if (!b) return a
  return { min: Math.max(a.min, b.min), preferred: Math.max(a.preferred, b.preferred) }
}

export function tileRequirementFor(
  e: AnyEntry, opts: RequirementOptions = {},
): TileRequirement | null {
  const workflow = opts.workflow ?? 'passive'
  const withState = (r: TileRequirement | null): TileRequirement | null =>
    r && { ...r, workflow }

  switch (e?.kind) {
    /**
     * A ladder is the point of the card, and a plot can use room it is given.
     */
    case 'scenario':
      return e.card
        ? withState(fromContractCard(e.card, plotVisual(), !!e.hasDetailRegion))
        : null

    case 'template':
      return e.card
        ? withState(fromContractCard(e.card, null, !!e.hasDetailRegion))
        : null

    case 'signal':
      return e.signal
        ? withState(fromContractCard(e.signal, null, !!e.hasDetailRegion))
        : null

    /**
     * Research and capital cards. The case pane is always mounted, and what it
     * draws is a row per core thesis section — so the visual requirement is
     * literally "three readable rows", not "this is a no_research card".
     */
    case 'insight': {
      const ins = e.insight
      if (!ins?.issue?.framing) return null
      const plan = insightPanePlan({
        framing: ins.issue.framing,
        hasCapital: !!ins.capital || !!e.card?.capital,
        evidenceCount: ins.issue.evidence?.length ?? 0,
      })
      return withState({
        claimChars: claimCharsOf(ins.headline, e.card?.headline),
        hasMetric: true,
        hasPrompt: !!ins.prompt,
        contextRows: contextRowsFor(ins.portfolioCount ? 2 : 1),
        bodyLines: ins.body ? CLAMPED_BODY_LINES : 0,
        // A judgment pane is a row of answers, not a picture.
        controlRows: plan.guaranteed.includes('judgment') ? 1 : 0,
        /**
         * The band holds the TALLEST pane, not the first one.
         *
         * Both live in one carousel, sharing one viewport, so a band sized to
         * the three-row case pane compresses the chart beside it — which is
         * precisely the GOOGL failure, where a plot declaring 128px rendered
         * at 99 and pushed its own date axis outside the card. Now that every
         * Research framing carries the tape, the case pane stopped being the
         * binding constraint on the sparse ones and the chart started being it.
         *
         * Reserved off `order` rather than `guaranteed` deliberately. A price
         * pane may not mount — `pricePane` returns null for a symbol that does
         * not resolve — so this can over-reserve, and over-reserving is the
         * safe direction: it costs whitespace on a card that already gets the
         * whole screen, where under-reserving collapses the analytical region.
         */
        visual: maxVisual(
          plan.guaranteed.includes('case') ? rowsVisual(THESIS_ROWS) : null,
          plan.order.includes('price') ? interactivePlotVisual() : null,
        ),
        hasActionTray: true,
      })
    }

    case 'news': {
      const n = e.news
      if (!n) return null
      const plan = newsPanePlan({ hasLinkedAsset: !!n.primarySymbol })
      return withState({
        claimChars: claimCharsOf(n.headline),
        contextRows: 1,
        bodyLines: n.summary ? CLAMPED_BODY_LINES : 0,
        controlRows: plan.guaranteed.includes('verdict') ? 1 : 0,
        // The tape is eligibility, never a promise — see the header.
        visual: null,
        hasActionTray: true,
      })
    }

    case 'idea': {
      const i = e.idea
      if (!i?.type) return null
      const body = claimCharsOf(i.content, i.title)
      const plan = ideaPanePlan({
        isPair: ideaCardType(i.type) === 'pair_trade',
        hasLadder: false,
        hasAsset: !!i.asset?.symbol,
        bodyLength: body,
        hasEvolution: false,
        hasLegContext: false,
      })
      return withState({
        claimChars: Math.min(body, 90),
        contextRows: 1,
        bodyLines: body ? CLAMPED_BODY_LINES : 0,
        controlRows: plan.guaranteed.includes('verdict') ? 1 : 0,
        visual: null,
        hasActionTray: true,
      })
    }

    /**
     * A lens is a view over one position, and its several types are several
     * PRESENTATION shapes rather than one kind with a label. What separates
     * them geometrically is whether a bar list is guaranteed: a cohort or a
     * book breakdown is only drawn when there is more than one row to compare,
     * which is the same condition the renderer gates those panes on.
     *
     * The price pane is eligibility, never a promise, so no room is reserved
     * for it — the same rule the news and idea adapters follow.
     */
    case 'lens': {
      const l = e.lens
      if (!l?.type) return null
      const subject = l.gap ?? l.name ?? l.breach ?? l.target ?? l.position ?? {}
      const cohort: unknown[] = l.gap?.cohort ?? []
      const books: unknown[] = l.name?.weightsByPortfolio ?? []
      const bars =
        l.type === 'conviction' && cohort.length > 1 ? cohort.length
        : l.type === 'crowded' && books.length > 1 ? books.length
        : 0
      /**
       * Some lenses ARE a price claim, and for those the tape is not context.
       *
       * A reached target, an expired one and an untargeted position all say
       * the same kind of thing — where the price is against a line — so the
       * interactive price presentation is the card, not a pane it might also
       * have. Elsewhere the tape stays eligibility and gets no reserved room.
       *
       * This is the omission that produced the GOOGL card: the adapter said
       * `visual: null` for a stale lens, the resolver budgeted nothing for a
       * chart the card certainly renders, and the body ran 166px through the
       * action tray. The adapter names a PRESENTATION, never a height, and the
       * primitive says what that presentation costs.
       */
      const priceLed = l.type === 'stale' || l.type === 'breach' || l.type === 'untargeted'
      /**
       * An untargeted position offers the cases it is missing.
       *
       * The card's whole point is that no price has been committed to, so it
       * shows the entry rows for the ones that are absent — a control group,
       * in the same shared vocabulary a response row uses. The calibration
       * suite caught this omission: the model predicted 359px for a
       * composition needing 509.
       */
      /**
       * The entry rows are a PANE beside the chart, not a group under it.
       *
       * `CardCarousel` labels them "Price" and "Price it" and the reader pages
       * between them, so they share one viewport and combine by `max` — the
       * same rule the insight adapter applies to its case-and-chart pair.
       * Charged as `controlRows` they were added to the chart's height, which
       * made this the last family still overflowing a 360x590 feed when the
       * card was engaged, by 31px off the bottom.
       */
      const entryRows = l.type === 'untargeted' ? CASE_ENTRY_ROWS : 0
      return withState({
        claimChars: generatedClaimChars(subject.symbol, l.gap?.portfolioName),
        // Every lens leads with a number about the position, and asks a
        // question above its band.
        hasMetric: true,
        hasPrompt: true,
        contextRows: 1,
        bodyLines: CLAMPED_BODY_LINES,
        controlRows: 0,
        visual: maxVisual(
          bars ? rowsVisual(bars) : priceLed ? interactivePlotVisual() : null,
          entryRows ? rowsVisual(entryRows, TILE_COST.controlRow) : null,
        ),
        hasActionTray: true,
      })
    }

    /**
     * The workflow families — a recommendation waiting on someone, a review
     * that is overdue. Text, a day count, and one row of answers; the visual,
     * where one exists at all, is a price pane and therefore eligibility.
     */
    case 'attention': {
      const a = e.attention
      if (!a) return null
      return withState({
        claimChars: generatedClaimChars(a.title, a.symbol),
        hasMetric: true,
        contextRows: 1,
        bodyLines: a.description || a.body ? CLAMPED_BODY_LINES : 0,
        controlRows: 1,
        visual: null,
        hasActionTray: true,
      })
    }

    /**
     * Unknown input only.
     *
     * Every kind the feed produces is above; this is the defensive branch for
     * something new, and a new family reaching it takes the whole feed. That
     * is the safe direction but it is not a strategy — the test over
     * `PRODUCTION_ENTRY_KINDS` is what stops it becoming one silently, and the
     * warning is what makes it visible while somebody is looking.
     */
    default:
      if (import.meta.env?.DEV && e?.kind) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tile-requirement] no geometry adapter for entry kind "${e.kind}"; ` +
          'it will occupy the whole feed. Add an adapter in tile-requirement.ts.',
        )
      }
      return null
  }
}
