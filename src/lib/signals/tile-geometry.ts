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
  /** One line of the claim at its shipping type size. Measured 48 for two. */
  claimLine: 24,
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
 */
const CLAIM_GLYPH_PX = 10.5

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

/** A plotted series. Legible small, better with room. */
export function plotVisual(): VisualRequirement {
  return { min: 168, preferred: 300 }
}

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
  requested += (req.controlRows ?? 0) * COST.controlRow
  if (req.workflow === 'active') requested += COST.noteField

  if (req.visual) {
    /**
     * A visual takes what it prefers only if the container can afford it, and
     * never less than it can be read at. `preferred` is where a chart earns a
     * taller tile and a row list does not — the difference is declared by the
     * primitive, not inferred from the card.
     */
    const room = container.height - (requested + COST.rhythm + tray)
    const preferred = req.visual.preferred ?? req.visual.min
    requested += Math.max(req.visual.min, Math.min(preferred, room))
  }

  requested += COST.rhythm + tray

  const height = Math.min(requested, container.height)
  return { height, requested, capped: requested > container.height, claimLines }
}

/** Exposed for tests and for anything that needs to reason about the parts. */
export const TILE_COST = COST
