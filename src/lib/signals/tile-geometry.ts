/**
 * How much room a tile needs, from what it contains and the room it has.
 *
 * ── The system this replaces ──────────────────────────────────────────────
 *
 * Height was `SignalType -> tier -> fixed rem`. Three properties made that
 * wrong, and all three were found by human review on a real device rather than
 * by the fixtures:
 *
 *   1. The type decided the height, so a sparse card of a "tall" type kept a
 *      tall shell and filled it with a growing spacer. `no_research` carrying
 *      246px of content sat in a 512px box.
 *   2. Width was not an input. `h-[28rem]` is the same at 360 and at 430, even
 *      though a claim that wraps to three lines at 360 wraps to two at 430.
 *   3. Interaction was not an input, so a passive card either permanently
 *      reserved room for a response it was not showing, or clipped one it was.
 *
 * ── What this asks instead ────────────────────────────────────────────────
 *
 * "How much room does THIS composition need in THIS container?" — never "what
 * type is this?". A requirement is written in shared presentation terms that
 * any family can express, so a new family gets its geometry from the same
 * resolver without a rule of its own. That is the architectural test: adding a
 * tile with a claim, a five-row visual and an action bar should need no new
 * height code.
 *
 * ── One tile, one screen ─────────────────────────────────────────────────
 *
 * Every tile resolves to the feed's height. The requirement model below does
 * not choose that number any more; it decides whether the composition FITS
 * inside it, which is the failure that actually loses content. See
 * `resolveTile` for why a shorter tile is not an option on a snap scroller.
 *
 * ── The direction of error matters ───────────────────────────────────────
 *
 * A tile with slightly too much room shows a little unearned whitespace. A
 * tile with too little CLIPS — and worse, the evidence band is a flex child
 * that shrinks, so the content does not overflow visibly, it silently
 * collapses. Human review found exactly that: a rich analytical card reduced
 * to a headline and a CTA. So where this model is uncertain it rounds UP, and
 * every part the card renders must appear here — a region omitted from the
 * costs is a region the resolver will not reserve.
 *
 * ── Why not measure the DOM ───────────────────────────────────────────────
 *
 * `FeedSlot` reserves a box for entries it has not mounted, so a height read
 * off a rendered card would exist only for tiles the reader had already passed
 * — and a deep offset would then mean two different things depending on how
 * they got there. Everything here is arithmetic over declared requirements and
 * a container size, so a collapsed slot and a mounted one resolve identically.
 *
 * The container size is measured, once, for the feed as a whole. That is not
 * the same thing: it is one observation of the box every tile shares, not a
 * per-tile measurement, and without it "responsive" is not expressible.
 */

/** Vertical cost of the parts a tile is built from, in CSS px. */
const COST = {
  /** Kind chip, timestamp and overflow menu. Measured at 44. */
  eyebrow: 44,
  /**
   * One line of the claim at its shipping type size.
   *
   * 30, from the live DOM walk: "AMZN has passed every case you wrote" — 36
   * characters at 400px — rendered a 60px headline, which is two lines of 30
   * rather than the three of 24 this originally assumed. Getting the line
   * HEIGHT wrong compounds with getting the line COUNT wrong, which is how the
   * model came to under-predict every claim.
   */
  claimLine: 30,
  /** The hero metric band. Measured 44. */
  metric: 44,
  /** One row of context chips. Measured 20. */
  contextRow: 20,
  /** One line of clamped body prose. Measured ~22. */
  bodyLine: 22,
  /** One row of interactive controls, at the platform touch minimum. */
  controlRow: 48,
  /** The sticky action tray, including its safe-area padding. Measured 69. */
  actionTray: 69,
  /** Breathing room between the body and the tray. The rhythm spacer. */
  rhythm: 14,
  /** A note field in an active response, plus its label. */
  noteField: 76,
  /**
   * The detail region below the evidence band, at its declared floor.
   *
   * `SignalCardView` gives it `min-h-[168px]` — "a question line plus a 44px
   * answer row plus the confirm control and their spacing". A card can carry
   * BOTH a band and a detail, and this model saw only one of them, so on those
   * cards the detail was squeezed to 70-112px against its own floor and its
   * content clipped. Found by routing the gallery through this resolver.
   */
  detailRegion: 168,
  /**
   * The judgment question above the band — "Has the investment view changed?".
   *
   * Measured at 21px plus its margin. It was missing from this model entirely,
   * which is part of why several shipping cards resolved too short.
   */
  prompt: 28,
  /**
   * The severity rule at the top of a critical card.
   *
   * 4px, and worth modelling only because it is unconditional space on the
   * cards that have it and this model had drifted low.
   */
  severityRule: 4,
  /**
   * Cumulative margins BETWEEN regions.
   *
   * The parts above were each measured in isolation, and the gaps between them
   * were not modelled at all: `mt-1`, `mt-3`, `mt-2`, `mt-2.5` and the
   * container's own padding sum to roughly this on a shipping card. Leaving it
   * out is a systematic under-estimate of every tile, which is exactly the
   * direction that clips content rather than wasting space.
   */
  regionGaps: 44,
} as const

/**
 * Average glyph advance for the claim, in px, at its shipping type size.
 *
 * Used only to turn a character count into a line count, which is the one
 * place width becomes height. Deliberately a single number rather than real
 * text metrics: the resolver must produce the same answer on the server, in a
 * test, and in a slot that has not mounted, and `measureText` is available in
 * none of those.
 *
 * 14, derived from the same live walk as `claimLine`: 36 characters wrapped to
 * two lines in a 368px content box, so roughly 26 characters per line. It was
 * 10.5, which predicted one line where the renderer produced two.
 *
 * Where this is uncertain it should read HIGH. A generous glyph estimates more
 * lines and therefore more height, and a claim given a spare line wastes 30px
 * where a claim given one too few pushes a region into collapsing.
 */
const CLAIM_GLYPH_PX = 14

/** Horizontal padding the card spends on both sides together. */
const GUTTER_PX = 32

/**
 * What a visual needs, declared by the primitive rather than by the card.
 *
 * A ladder, a price chart and a row of weight bars know their own legibility
 * floor; the resolver does not, and must not learn it per family. `min` is the
 * height below which the visual stops being readable. `preferred` is what it
 * would use given room — a chart is better bigger, a five-row bar list is not.
 */
export interface VisualRequirement {
  min: number
  preferred?: number
}

/** N readable rows plus their labels, whatever family is drawing them. */
export function rowsVisual(rows: number, rowPx = 26): VisualRequirement {
  const h = Math.max(1, rows) * rowPx + 24
  return { min: h, preferred: h }
}

/**
 * The least a carousel's pane viewport can be and still be worth drawing.
 *
 * Shared, and deliberately not per-family: a pane is a pane, and below this it
 * is a sliver with a label. `SignalCardView` applies it as a real `min-height`
 * on the band so the region cannot silently collapse when a card is sized too
 * short — which is the failure mode that made a rich analytical card render as
 * a headline and a CTA while every height assertion passed.
 *
 * Matching `plotVisual().min` is not a coincidence: the plot is the most
 * demanding thing a pane holds, and a viewport that cannot show one cannot
 * show the others either.
 */
export const PANE_VIEWPORT_MIN_PX = 168

/** A plotted series. Legible small, better with room. */
export function plotVisual(): VisualRequirement {
  return { min: 168, preferred: 300 }
}

/**
 * The parts an interactive price presentation renders, measured at 400px.
 *
 * A chart is not a plot. `PriceContext` draws a header carrying the readout,
 * the compare figure and the period controls; then the plot; then the date
 * axis beneath it. Budgeting only the plot band is what produced the GOOGL
 * Target Expired card: the resolver reserved nothing for the presentation at
 * all, the plot was compressed from its declared 128px to 99, the axis fell
 * outside the card and the body ran 166px THROUGH the action tray.
 */
const PRICE_PRESENTATION = {
  /** Readout, compare figure and the 5D/1M/3M/6M/1Y/ALL controls. */
  header: 22,
  /** The plot's own declared height. */
  plot: 128,
  /** Date labels under the plot — the region that vanished first. */
  axis: 14,
  /** `mt-1` above the plot and the gap under it. */
  gaps: 12,
} as const

/**
 * An interactive price presentation, whole.
 *
 * The primitive declares what it renders; the resolver allocates it and never
 * learns which family asked. `preferred` is higher than `min` because a chart
 * genuinely reads better with room — the same reason `plotVisual` prefers 300
 * — but the floor is now the complete presentation rather than one band of it.
 */
export function interactivePlotVisual(): VisualRequirement {
  const min = PRICE_PRESENTATION.header + PRICE_PRESENTATION.plot
    + PRICE_PRESENTATION.axis + PRICE_PRESENTATION.gaps
  return { min, preferred: min + 120 }
}

/** Exposed so the calibration suite can state the parts independently. */
export const PRICE_PRESENTATION_PARTS = PRICE_PRESENTATION

/**
 * A tile's requirement, in terms every family can express.
 *
 * Nothing here names a SignalType, and nothing should: two families with the
 * same shape must resolve to the same height, and one family in two states
 * must be able to resolve differently.
 */
export interface TileRequirement {
  /** Characters in the claim. Becomes lines once a width is known. */
  claimChars: number
  hasMetric?: boolean
  /** The judgment question the card asks above its band. */
  hasPrompt?: boolean
  /** Rows of context chips. */
  contextRows?: number
  /** Lines of body prose the resting card shows. */
  bodyLines?: number
  /** Rows of interactive controls — response chips, case-entry rows. */
  controlRows?: number
  visual?: VisualRequirement | null
  /**
   * A detail region BELOW the band — a judgment, a peer list, an editor.
   *
   * Separate from `visual` because a card can have both, and modelling them as
   * one is what let the second region collapse below its declared floor.
   */
  hasDetailRegion?: boolean
  hasActionTray?: boolean
  /**
   * Passive is a briefing. Active is the reader working — a response with a
   * note and a commit — and may earn height a passive card must not reserve.
   */
  workflow?: 'passive' | 'active'
}

export interface TileContainer {
  /** The feed's own width, not the viewport's. */
  width: number
  /** The feed SCROLLER's height. Never `100dvh`: app chrome is not the feed. */
  height: number
}

export interface ResolvedTile {
  /** What to render at. Never exceeds `container.height`. */
  height: number
  /** What the content asked for, before the ceiling. */
  requested: number
  /** True when the ceiling bit — the content wanted more than the feed has. */
  capped: boolean
  /** Lines the claim takes at this width. Width's route into height. */
  claimLines: number
}

/** How many lines the claim needs at this width. */
export function claimLinesAt(chars: number, width: number): number {
  const perLine = Math.max(12, Math.floor((width - GUTTER_PX) / CLAIM_GLYPH_PX))
  return Math.max(1, Math.ceil(chars / perLine))
}

/**
 * The whole geometry decision, as arithmetic.
 *
 * Width enters through `claimLinesAt` — a 64-character claim is three lines at
 * 360px and two at 430px, so the same content legitimately resolves taller on
 * the narrower phone. Height enters only as a ceiling, and it is the FEED's
 * height: a tile that cannot fit is capped rather than allowed to overflow the
 * box it lives in, which is what keeps it from growing an inner scroller and
 * taking the drag the feed needs.
 */
export function resolveTile(req: TileRequirement, container: TileContainer): ResolvedTile {
  const claimLines = claimLinesAt(req.claimChars, container.width)
  const tray = req.hasActionTray === false ? 0 : COST.actionTray

  let requested = COST.severityRule + COST.regionGaps
    + COST.eyebrow + claimLines * COST.claimLine
  if (req.hasPrompt) requested += COST.prompt
  if (req.hasMetric) requested += COST.metric
  requested += (req.contextRows ?? 0) * COST.contextRow
  requested += (req.bodyLines ?? 0) * COST.bodyLine
  if (req.hasDetailRegion) requested += COST.detailRegion

  /**
   * The response TAKES the band; it is not stacked under it.
   *
   * ── The clipping this fixes ───────────────────────────────────────────
   *
   * This charged the visual, then the control rows, then the note field, as
   * three separate regions. `SignalCardView` does not render them that way —
   * "an ENGAGED judgment takes the whole band", and an inline one is a
   * carousel page beside the evidence. Either way the reader sees ONE of them
   * at a time, so summing them reserved room for a chart and the answer form
   * it is paged against simultaneously.
   *
   * The effect, measured across every production family at a 400x590 feed:
   * all eight overflowed the moment the card was engaged, by 121-177px. The
   * card cannot grow — one tile, one screen — so the overflow came off the
   * bottom, which is where the note field is. Reported as "on some respond
   * cards the note entry box is getting cut off"; it was in fact all of them
   * at that height, and none of them at 430x822, which is why it looked
   * intermittent.
   *
   * Panes in one viewport combine by `max`, exactly as `maxVisual` does for
   * the case-and-chart pair in the adapter.
   */
  const active = req.workflow === 'active'
  const controls = (req.controlRows ?? 0) * COST.controlRow
  // Passive control rows are a row of options ABOVE the band, and still cost
  // their own height. Engaged, they are part of the response that replaces it.
  if (!active) requested += controls
  const responseBand = active ? controls + COST.noteField : 0

  const bandMin = Math.max(req.visual?.min ?? 0, responseBand)
  if (bandMin > 0) {
    /**
     * A visual takes what it prefers only if the container can afford it, and
     * never less than it can be read at. `preferred` is where a chart earns a
     * taller tile and a row list does not — the difference is declared by the
     * primitive, not inferred from the card.
     */
    const room = container.height - (requested + COST.rhythm + tray)
    const preferred = Math.max(
      req.visual ? (req.visual.preferred ?? req.visual.min) : 0,
      responseBand,
    )
    requested += Math.max(bandMin, Math.min(preferred, room))
  }

  requested += COST.rhythm + tray

  /**
   * One tile, one screen — always.
   *
   * ── Why the resolved height is not the requirement ────────────────────
   *
   * This returned `min(requested, container.height)`, so a sparse card was
   * short and the reader saw the top of the next tile below it. On a
   * snap-start scroller that is unavoidable at any height below the
   * container: a 400px tile in a 590px feed shows 190px of its neighbour.
   * Product direction is that two tiles must never be on screen together, and
   * the only floor that guarantees it is the feed itself.
   *
   * ── So what is `requested` still for ──────────────────────────────────
   *
   * Everything except choosing the height, and it is not decoration. It is
   * the only thing that can say a composition needs MORE room than the feed
   * has — the clipping case — which is what `capped` reports and what the
   * calibration suite asserts against. The GOOGL card was budgeted 371px for
   * a chart needing 537 and ran 166px through its action tray; under this
   * rule it would have had the whole screen, but the requirement model is
   * still what proves the content fits inside one.
   *
   * The cost of this rule is honest and worth stating: a sparse card now has
   * whitespace again. That is a composition problem — those families should
   * earn their screen with content rather than padding — and it is not one
   * geometry can solve by making the card smaller.
   */
  return {
    height: container.height,
    requested,
    capped: requested > container.height,
    claimLines,
  }
}

/** Exposed for tests and for anything that needs to reason about the parts. */
export const TILE_COST = COST
