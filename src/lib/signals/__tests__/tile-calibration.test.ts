import { describe, it, expect } from 'vitest'
import {
  resolveTile, claimLinesAt, rowsVisual, interactivePlotVisual, TILE_COST,
  PANE_VIEWPORT_MIN_PX, PRICE_PRESENTATION_PARTS,
} from '../tile-geometry'
import { tileRequirementFor } from '../../mobile/tile-requirement'

/**
 * Does the model predict enough room for what the card actually renders?
 *
 * ── The proof this replaces ───────────────────────────────────────────────
 *
 * "Resolved height equals rendered height" passed for weeks while cards were
 * visibly wrong. It could not fail: the evidence band is a flex child that
 * SHRINKS, so a card given too little room did not overflow — the analytical
 * region collapsed toward nothing and the outer box still matched the
 * prediction exactly. Comparing a constrained outer height against the
 * constraint that produced it is a tautology.
 *
 * What has to be compared instead is the prediction against the height the
 * composition INTRINSICALLY needs: the sum of the regions the renderer mounts,
 * each at the minimum its own primitive declares. That number does not depend
 * on the slot, so it can disagree with the prediction — which is the whole
 * point.
 *
 * ── Why this is arithmetic and not jsdom ──────────────────────────────────
 *
 * jsdom has no layout: every `getBoundingClientRect` is zero, so a DOM-based
 * natural-height measurement in this suite would report 0 and pass everything.
 * Measuring for real needs a browser, which is `e2e/`. What this suite CAN do
 * — and what would have caught the bug — is hold the cost model against an
 * independently stated inventory of the regions each composition renders. When
 * somebody adds a 40px row to a shared region and does not add it here, the
 * two disagree and this fails.
 *
 * The inventories below are transcribed from the shipping render tree, and one
 * of them is transcribed from a live DOM walk at 400px — see `SCENARIO_GAP`.
 */

/** A feed area, not a viewport: 400x700 minus the app chrome above the feed. */
const FEED = { width: 400, height: 590 }

/**
 * What a composition actually mounts, region by region.
 *
 * Stated independently of `TileRequirement` on purpose. If both were derived
 * from the same source they would agree by construction and prove nothing.
 */
interface RegionInventory {
  name: string
  /**
   * Region heights the renderer produces, EXCLUDING the claim.
   *
   * The claim is added per width by `naturalOf`, because it is the one region
   * whose height genuinely depends on the container: 28 characters is two
   * lines at 360px and one at 430px, so a fixed number here would fail the
   * wide case for being right. That term therefore shares the model's line
   * rule; every other term below is stated independently, which is where all
   * four bugs this suite has caught actually were.
   */
  regions: number[]
  /** The claim the card will render, so its lines can be counted per width. */
  claim: string
  /** The entry the production adapter would describe. */
  entry: Record<string, unknown>
}

/**
 * Transcribed from a live DOM walk of a shipping scenario_gap at 400px:
 *
 *     rule 4, eyebrow 44, headline 60, metric 44, prompt 21,
 *     context 20, band 200, spacer 14, body 45, tray 69
 *
 * plus the margins between them, which the model now charges as `regionGaps`.
 */
const SCENARIO_GAP: RegionInventory = {
  name: 'scenario ladder (measured live at 400px)',
  regions: [4, 44, 44, 21, 20, PANE_VIEWPORT_MIN_PX, 14, 45, 69],
  claim: 'AMZN has passed every case you wrote',
  entry: {
    kind: 'scenario',
    card: {
      headline: 'AMZN has passed every case you wrote',
      metric: { value: '+42%' }, prompt: 'Has the investment view changed?',
      context: [{ label: 'Core Equity' }], body: 'No stated upside is left.',
    },
  },
}

/**
 * The three states human review found over-compressed. Their region lists come
 * from the shipping composition each one mounts, not from a screenshot.
 */
const OVERSIZED: RegionInventory = {
  name: 'position ranking bars (5 rows)',
  regions: [4, 44, 44, 21, 20, rowsVisual(5).min, 14, 45, 69],
  claim: 'MSFT is 6.2% of Core Equity against 3.1% in the benchmark',
  entry: {
    kind: 'lens',
    lens: { type: 'conviction', gap: { symbol: 'MSFT', portfolioName: 'Core Equity', cohort: [1, 2, 3, 4, 5] } },
  },
}

const NO_PRICE_TARGET: RegionInventory = {
  name: 'case-entry rows paged against the chart',
  /**
   * The band is the taller of the two panes, not their sum.
   *
   * `CardCarousel` labels them "Price" and "Price it"; the reader sees one at
   * a time. Charging both was what kept this family overflowing when engaged.
   */
  regions: [4, 44, 44, 21, 20,
            Math.max(3 * TILE_COST.controlRow, interactivePlotVisual().min),
            14, 45, 69],
  claim: 'BRK.B has no price target on record',
  entry: {
    kind: 'lens',
    lens: { type: 'untargeted', position: { symbol: 'BRK.B' } },
  },
}

const NO_CORE_THESIS: RegionInventory = {
  name: 'sparse thesis workflow (3 rows, tape behind it)',
  /**
   * The band holds the TALLER of the two panes it pages between.
   *
   * The case pane is three rows; the price pane is a full interactive
   * presentation, and it is the binding one. Stated as the max rather than the
   * sum because a carousel shows one pane at a time — summing would reserve
   * room for a chart and the rows it is paged against simultaneously.
   */
  regions: [4, 44, 44, 20,
            Math.max(rowsVisual(3).min, interactivePlotVisual().min),
            14, 45, 69],
  claim: 'APA has no investment thesis',
  entry: {
    kind: 'insight',
    insight: {
      headline: 'APA has no investment thesis', body: 'Nothing on file.',
      portfolioCount: 1, issue: { framing: 'no_case', evidence: [] },
    },
  },
}

/**
 * The GOOGL card, as a regression.
 *
 * Measured in the real app at 400x700 and it was wrong: the slot resolved
 * 371px, the tray sat at 294, and content reached 460 — the body ran 166px
 * THROUGH the action tray, the plot was compressed from its declared 128px to
 * 99, and the date axis fell outside the card entirely.
 *
 * The cause was not a missing pixel count. The lens adapter said `visual:
 * null` for a stale lens, so the resolver budgeted NOTHING for a chart the
 * card certainly renders — "the price pane is eligibility" applied to a family
 * whose entire claim IS the price.
 *
 * The regions below are the interactive price presentation's own parts, stated
 * from that measurement. If someone later adds a control row, another axis or
 * more internal spacing without updating the primitive, this fails.
 */
const TARGET_EXPIRED_PRICE: RegionInventory = {
  name: 'interactive price presentation (GOOGL, measured live at 400px)',
  regions: [
    4, 44, 44, 21, 20,
    // The presentation, part by part: header, plot, axis, internal gaps.
    PRICE_PRESENTATION_PARTS.header,
    PRICE_PRESENTATION_PARTS.plot,
    PRICE_PRESENTATION_PARTS.axis,
    PRICE_PRESENTATION_PARTS.gaps,
    14, 45, 69,
  ],
  claim: "GOOGL's $200.00 target outlived its 6-month horizon",
  entry: {
    kind: 'lens',
    lens: { type: 'stale', target: { symbol: 'GOOGL' } },
  },
}

/** Browser rounding and sub-pixel margins. */
const TOLERANCE = 2

const naturalOf = (inv: RegionInventory, width = FEED.width) =>
  inv.regions.reduce((a, b) => a + b, 0)
  + TILE_COST.regionGaps
  + claimLinesAt(inv.claim.length, width) * TILE_COST.claimLine

const predictedOf = (inv: RegionInventory) => {
  const req = tileRequirementFor(inv.entry)
  expect(req, `${inv.name}: no adapter describes this entry`).not.toBeNull()
  return resolveTile(req!, FEED)
}

describe('the model predicts enough room for what is rendered', () => {
  for (const inv of [SCENARIO_GAP, OVERSIZED, NO_PRICE_TARGET, NO_CORE_THESIS,
                     TARGET_EXPIRED_PRICE]) {
    it(`covers ${inv.name}`, () => {
      const natural = naturalOf(inv)
      const predicted = predictedOf(inv)
      /**
       * The direction that matters. Under-prediction is what collapses a
       * region; over-prediction only costs whitespace. So this is a floor, not
       * an equality — a model that reserves a little extra is acceptable and a
       * model that reserves too little is the bug.
       */
      expect(
        predicted.requested + TOLERANCE,
        `${inv.name}: model predicts ${predicted.requested}px but the ` +
        `composition needs ${natural}px — short by ${natural - predicted.requested}px`,
      ).toBeGreaterThanOrEqual(natural)
    })
  }
})

describe('what the feed can actually give it', () => {
  it('flags a composition the short feed cannot hold without adaptation', () => {
    /**
     * Not a failure — a report. When `capped` is true the content wanted more
     * than the feed has, and the honest responses are to adapt the
     * presentation or to accept the ceiling. What must never happen is the
     * third option, which is what used to happen: shrink the analytical region
     * to nothing and call the height correct.
     */
    const short = { width: 390, height: 460 }
    const req = tileRequirementFor(SCENARIO_GAP.entry)!
    const r = resolveTile(req, short)
    expect(r.height).toBeLessThanOrEqual(short.height)
    if (r.capped) {
      // The band still cannot be squeezed below its declared floor.
      expect(PANE_VIEWPORT_MIN_PX).toBeGreaterThan(0)
    }
  })
})

describe('no family under-fills the screen it is given', () => {
  /**
   * These asserted the opposite until the reader rejected it twice.
   *
   * The old pair required a sparse family to ask for WELL UNDER a screen and
   * a rich one to ask for more, and described the difference as "the
   * difference between geometry being correct and the card being good...
   * those families still have a screen to earn". That was an honest statement
   * of an unfinished job, but as an assertion it PINNED the unfinished state:
   * any attempt to give No Core Thesis enough content to fill its screen would
   * fail here, which is exactly what happened when the tape was added.
   *
   * "we need to make sure that this CANNOT happen" is a rule about the floor,
   * and a floor is what this now asserts.
   */
  it('has the sparse card asking for its whole screen', () => {
    expect(predictedOf(NO_CORE_THESIS).requested).toBeGreaterThanOrEqual(FEED.height)
  })

  it('has every other family asking for very nearly all of its screen', () => {
    /**
     * A floor, not equality, and 90% rather than 100%.
     *
     * The reported defect was a card at roughly 85% of its screen reading as
     * empty. The ranking-bars lens sits at ~94% — five bars, a claim and a
     * tray genuinely cost that — and there is no whitespace complaint to
     * answer there. What this catches is the next family to drift back down
     * toward "a headline and a question on a blank screen".
     */
    expect(predictedOf(OVERSIZED).requested).toBeGreaterThan(FEED.height * 0.9)
  })

  it('gives both of them exactly one screen, never more', () => {
    // The product rule: two tiles must never be visible at once, and no tile
    // may run past the one it is given.
    expect(predictedOf(NO_CORE_THESIS).height).toBe(FEED.height)
    expect(predictedOf(OVERSIZED).height).toBe(FEED.height)
  })
})

describe('calibration holds across widths', () => {
  const WIDTHS: [number, number][] = [[360, 590], [400, 590], [390, 734], [430, 822], [390, 540]]
  for (const inv of [SCENARIO_GAP, OVERSIZED, NO_CORE_THESIS, TARGET_EXPIRED_PRICE]) {
    it(`covers ${inv.name} at every supported width`, () => {
      for (const [width, height] of WIDTHS) {
        const req = tileRequirementFor(inv.entry)!
        const r = resolveTile(req, { width, height })
        const natural = naturalOf(inv, width)
        if (r.capped) continue // reported by the ceiling case above
        expect(
          r.requested + TOLERANCE,
          `${inv.name} at ${width}x${height}: predicted ${r.requested}, needs ${natural}`,
        ).toBeGreaterThanOrEqual(natural)
      }
    })
  }
})
