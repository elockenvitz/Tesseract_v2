import { useState } from 'react'
import { clsx } from 'clsx'

import { groupCases } from '../../lib/signals/scenario-state'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

interface ScenarioLadderProps {
  price: number
  cases: ScenarioCase[]
  expected: number | null
  /**
   * The last year's trading range, as MARKET CONTEXT — never as two more cases.
   *
   * ── Why the card wanted it ────────────────────────────────────────────────
   *
   * "The price is 29% above your highest case" is a fact about the framework
   * and says nothing about whether the move is remarkable. A name whose bull
   * case is $180 and which has traded between $86 and $242 this year has
   * spent months outside the ladder; one that has traded $170–$185 has just
   * broken out. Those are different findings and the card could not tell them
   * apart.
   *
   * ── Why it is drawn quietly ───────────────────────────────────────────────
   *
   * Bear / Base / Bull are the analyst's own work and are what this card is
   * about. The 52-week range is the market's, and it is here to give the
   * framework a scale. So the cases keep the dots, the bold labels and the
   * selection; the range gets a faint span, two hairline ticks and lighter,
   * smaller type, and none of it is tappable. A reader must never have to work
   * out which of five marks on this axis they wrote down.
   *
   * Null whenever the range is not known — see `range52wFrom`, which returns
   * null rather than a partial answer. Nothing is drawn in that case, which is
   * the common one: only a minority of assets carry any cached history.
   */
  range52w?: { low: number; high: number } | null
  /**
   * When the cases were last written, already formatted ("5 Feb 2026").
   *
   * Printed on the second line of the readout, which the resting state
   * reserves and does not use. It answers the question the card's response
   * pane asks — has the thesis changed, or are the cases just old — and it is
   * a fact about THIS axis, so it belongs under it.
   *
   * It used to be appended to the card's body instead, where a two-line clamp
   * cut it off and pasted a "more" affordance over the year. See
   * `scenarioGap.ts`, which now passes it here.
   *
   * Null or absent whenever the builder could not parse `statedAt`; the line
   * is then simply not drawn, and the reserved height is unchanged either way.
   */
  statedOn?: string | null
}

/**
 * The scenario spread on a price axis, with the live price against it.
 *
 * ── Why there are no labels on the axis ───────────────────────────────────
 *
 * There were, and they could not survive real density. AAPL carries six cases
 * — 205, 230, 255, 285, 345, 500 — two named "Bear" and two named "Bull".
 * Labelling each on a 390px axis produced four defects, read off a screenshot
 * rather than guessed at:
 *
 *   1. The collision packer assigned rows 1,0,2,2,0,0, so BEAR $205 rendered
 *      *below* BASE $230. Vertical position meant nothing but read as though
 *      it did, and the eye could not recover price order.
 *   2. With three rows exhausted the packer clamped, and "BEAR $255 10%" was
 *      struck through by "BULL $285".
 *   3. Duplicate scenario names were indistinguishable without reading prices.
 *   4. Row offsets lifted the markers off the axis, so the band drawn between
 *      lowest and highest case no longer related to the dots.
 *
 * Each earlier fix moved a collision instead of removing it, because the
 * problem was never the packing — it was asking one 390px line to carry six
 * labels.
 *
 * So the axis carries only dots. Their x positions are the claim: a red tick
 * far left with every dot clustered right *is* "the tape is below your worst
 * case", legible without reading a word. Names, prices, probabilities and
 * reasoning live in the detail pane, which has room for them and can
 * disambiguate two cases called "Bear" by showing their prices together.
 *
 * Deliberately not a sparkline of price history. History is what every other
 * tool shows; the analyst's own modelled range is what only this product knows.
 */
/**
 * Is a 52-week range real enough to put on the axis?
 *
 * Declared at module scope because the DOMAIN needs the answer before
 * `rangeUsable` is computed further down, and one predicate used twice cannot
 * drift the way two copies of the same four conditions would.
 */
/**
 * The ladder's selection. `null` is the resting state.
 *
 * `expected` carries no id because there is only ever one expected value on a
 * ladder — it is the whole distribution reduced to a point.
 */
export type LadderSelection =
  | { type: 'scenario'; key: string }
  | { type: 'expected' }
  | null

function rangeUsableFor(r: { low: number; high: number } | null | undefined): boolean {
  return !!r
    && Number.isFinite(r.low) && Number.isFinite(r.high)
    && r.low > 0
    && r.high > r.low
}

export function ScenarioLadder({ price, cases, expected, range52w, statedOn }: ScenarioLadderProps) {
  /**
   * ONE selection, keyed on the coordinate rather than on a position.
   *
   * It was an index, and two things indexed different lists: the dots mapped
   * over CASES and the legend over GROUPS, both compared against the same
   * number. Selecting Bull — group 1 — highlighted case 1, which is Base at
   * $800. The wrong dot, on the ladder the grouping exists to disambiguate.
   *
   * A key also survives an edit. When a case is repriced the groups rebuild,
   * and an index would silently point at whatever now sits in that slot.
   */
  /**
   * What the reader has asked about, modelled explicitly.
   *
   * The expected value is not a scenario and must not be smuggled in as one:
   * it is derived from the cases rather than written by anybody, it has no
   * horizon, and it is not editable. A discriminated union says that in the
   * type instead of in a comment, and keeps `selected` — which is a GROUP —
   * from having to pretend.
   */
  const [selection, setSelection] = useState<LadderSelection>(null)
  const selectedKey = selection?.type === 'scenario' ? selection.key : null
  const evSelected = selection?.type === 'expected'
  if (cases.length < 2) return null

  const sorted = [...cases].sort((a, b) => a.price - b.price)
  /**
   * The legend lists COORDINATES; the Cases pane lists records.
   *
   * Two cases at $800 are one point on this axis and were drawn as two dots
   * with two legend chips — "BASE $800 · BEAR $800 · BULL $1605" — which reads
   * as three levels on a ladder that has two, and gave the reader two
   * indistinguishable tap targets at the same coordinate.
   *
   * Grouping is presentation only. Nothing here mutates a case, and the Cases
   * pane still shows Bear and Base separately with their own horizons, which is
   * where that difference actually matters.
   */
  const groups = groupCases(sorted)
  /**
   * A selection that no longer exists is dropped, not carried.
   *
   * Editing Bear from $800 to $500 splits the `Bear / Base` group, so the key
   * held here matches nothing. Falling back to null shows the resting state
   * rather than highlighting an arbitrary survivor.
   */
  const selected = groups.find(g => g.key === selectedKey) ?? null
  /**
   * Label every coordinate, or only the selected one.
   *
   * The labels stagger across two rows, so coordinates 0 and 2 share the top
   * row and 1 and 3 share the lower one. At three groups the only pair sharing
   * a row is the two ENDS, which are as far apart as the axis allows —
   * measured 74px of clearance at the tightest, on a 390px screen. At four the
   * pairs become adjacent, and at six the gap measured 1px: not overlapping by
   * the rectangle test that let it through review, and unreadable.
   *
   * Above three, the axis carries marks only and the label belongs to whatever
   * is selected. That is the honest trade: a dense ladder cannot name six
   * coordinates on a 358px line, and printing them anyway names none of them.
   */
  const labelAll = groups.length <= 3

  /** One thing at a time. Tapping the selected thing clears it. */
  const toggle = (g: { key: string }) =>
    setSelection(selectedKey === g.key ? null : { type: 'scenario', key: g.key })
  const toggleExpected = () =>
    setSelection(evSelected ? null : { type: 'expected' })
  /** "12 months" → "12-month view". "on a 11 months view" was the alternative. */
  const horizonPhrase = (t: string | null | undefined) => {
    if (!t) return null
    const m = t.trim().match(/^(\d+)\s*(month|year|week|day)s?$/i)
    return m ? `${m[1]}-${m[2].toLowerCase()} view` : `${t.trim()} view`
  }
  /** "Bear 6m · Base 12m" — the distinction a shared target hides. */
  const memberSummary = (g: { cases: { name: string; timeframe?: string | null }[] }) =>
    g.cases
      .map(c => {
        const short = c.timeframe?.trim().match(/^(\d+)\s*(month|year|week|day)s?$/i)
        return short ? `${c.name} ${short[1]}${short[2][0].toLowerCase()}` : c.name
      })
      .join(' · ')
  const lo = sorted[0].price
  const hi = sorted[sorted.length - 1].price

  /**
   * The MODELLED range owns most of the axis; the price gets the margins.
   *
   * ── The compression this fixes ───────────────────────────────────────────
   *
   * The scale ran from min(cases, price) to max(cases, price), so a price far
   * outside the ladder stole the axis from the thing the ladder is about.
   * Measured on AMZN — cases 120/150/180 against a price of 261 — the three
   * cases were squeezed into the left 44% while 56% of the chart drew the gap
   * between the top case and the tape. Reported as the cases not being spaced
   * properly given where the current price sits, which is exactly right: the
   * spacing between Bear, Base and Bull is the reader's whole comparison, and
   * it was being set by a number that is not a case.
   *
   * So the cases are laid out across a fixed band, and the price is placed
   * relative to THAT band — inside it when it is inside, and out in the margin
   * when it is beyond, clamped so it stays on the chart. The gap still reads as
   * a gap; it just no longer flattens the ladder to buy the room.
   */
  const caseLo = lo
  const caseHi = hi
  const caseSpan = caseHi - caseLo
  if (caseSpan <= 0 && price === caseLo) return null

  /**
   * ONE quantitative scale, over everything the axis draws.
   *
   * ── What this replaces, and why it was misleading ────────────────────────
   *
   * The cases used to own a FIXED band — 22% to 78% of the axis whatever their
   * dollar span — and anything outside it was `sqrt`-compressed into the
   * margins. That was a reasonable answer to an older problem (a price far
   * outside the ladder stealing the axis from the cases it is about) and it
   * became wrong the moment the 52-week range was drawn on the same axis,
   * because the two are then measured with different rulers.
   *
   * Measured on AMZN: the modelled range is $90 wide (Bear $90 to Bull $180)
   * and the 52-week range is about $85 wide ($199-$284). Two almost identical
   * dollar widths. The band gave the cases exactly 56% of the axis and the
   * `sqrt` margin gave the 52-week range a fraction of one edge, so the chart
   * asserted that the market's year of trading was a narrow sliver beside a
   * broad framework. That is not a styling preference, it is a false
   * quantitative claim, and a reader comparing the two spreads by eye — which
   * is the entire point of putting them on one axis — was misled.
   *
   * ── The domain ───────────────────────────────────────────────────────────
   *
   *   domainMin = min(52w low, every case, current price)
   *   domainMax = max(52w high, every case, current price)
   *   pad       = 8% of that span at each end, so an endpoint is never
   *               drawn on the frame and its label has somewhere to sit
   *   x(v)      = 4% + (v - lo) / (hi - lo) * 92%
   *
   * Linear, shared by every mark: the 52-week ends, every case dot, the
   * expected-value ring, the modelled span, the gap and the tape. Equal dollar
   * distances now produce equal pixel distances anywhere on the axis, which is
   * asserted directly in `scenario-ladder-scale.test.tsx`.
   *
   * ── The trade this accepts, deliberately ─────────────────────────────────
   *
   * A price very far outside a tight ladder now compresses the cases, which is
   * what the band was built to prevent. That is the honest rendering: if the
   * market is three times the highest case, the cases ARE clustered relative
   * to the distance travelled, and drawing them spread out to look comfortable
   * is drawing a different chart. The card states the figure on the NOW pill
   * and in the metric, so nothing depends on measuring it off the axis.
   */
  const domainValues = [
    caseLo,
    caseHi,
    price,
    ...sorted.map(c => c.price),
    ...(rangeUsableFor(range52w) ? [range52w!.low, range52w!.high] : []),
  ].filter(v => Number.isFinite(v))

  const rawLo = Math.min(...domainValues)
  const rawHi = Math.max(...domainValues)
  const rawSpan = rawHi - rawLo
  /** 8% of the span at each end. A degenerate domain gets a nominal one. */
  const padding = rawSpan > 0 ? rawSpan * 0.08 : Math.max(Math.abs(rawLo) * 0.08, 1)
  const domainLo = rawLo - padding
  const domainHi = rawHi + padding
  const domainSpan = domainHi - domainLo

  /** Axis inset, so a mark at either extreme still has room for its label. */
  const AXIS_LO = 4
  const AXIS_HI = 96

  /**
   * The 52-week range arrives LATE, and the domain includes it.
   *
   * ── The hitch, and where it comes from ───────────────────────────────────
   *
   * `useSymbolHistory` resolves after first paint, so the ladder draws once
   * over {cases, price} and again over {cases, price, 52w low, 52w high}. The
   * second domain is usually wider, so every mark's `left` recomputes and the
   * whole axis snaps sideways in one frame. That is a direct consequence of
   * putting everything on one shared scale — the right call, with this cost
   * attached.
   *
   * Three things it is NOT, so nothing else is changed to chase it:
   *   - not a HEIGHT change. The axis box is `min-h-[140px] max-h-[220px]
   *     flex-1` and does not depend on the range, so the card never resizes
   *     and nothing below it moves.
   *   - not a reason to wait. Blocking the ladder on history would delay a
   *     finding that does not need it, and `range52w` is already null-safe.
   *   - not a reason to gate the CANDIDATE. A card exists without a 52-week
   *     range; only the two context ticks do.
   *
   * So the geometry is allowed to change and the change is made continuous.
   * Transitioning `left` turns the snap into a short slide the eye reads as
   * the axis accommodating new information, at a duration slower than a frame
   * and shorter than a glance. Everything positioned on the axis carries it,
   * so the marks, their labels and the price move together rather than
   * shearing apart.
   */
  const SETTLE = 'transition-[left,width] duration-300 ease-out motion-reduce:transition-none'

  const pos = (v: number) => {
    if (!(domainSpan > 0)) return (AXIS_LO + AXIS_HI) / 2
    const t = (v - domainLo) / domainSpan
    // Clamped rather than unbounded: a value outside the domain cannot exist
    // by construction — the domain is its union — but a NaN price must not
    // paint a mark off the card.
    const clamped = Math.min(Math.max(t, 0), 1)
    return AXIS_LO + clamped * (AXIS_HI - AXIS_LO)
  }

  /**
   * Which row each label sits on, decided by collision rather than by parity.
   *
   * ── Why parity was not enough ────────────────────────────────────────────
   *
   * Rows alternated by index, so three tightly-clustered cases put Bear and
   * Bull on the top row with Base alone underneath — and the eye reads a row
   * before it reads a column. On CEG (355 / 370 / 390) that scans as
   * "Bear, Bull … Base", which is not the order of the ladder.
   *
   * Greedy assignment instead: walk left to right and put each label on the
   * FIRST row where it clears everything already placed there. A cluster that
   * fits stays on one row and reads in order; only what genuinely collides
   * steps down, and it steps down directly under its own marker.
   *
   * Widths are estimated from the text rather than measured. Measuring means a
   * layout pass per render on a surface that windows five cards, and the
   * estimate only has to be good enough to decide "do these two touch" — it is
   * deliberately generous, so the failure mode is an unnecessary second row
   * rather than an overlap.
   */
  const AXIS_PX = 340
  const CHAR_PX = 6.6
  const LABEL_GAP_PX = 8
  /**
   * The end-clamp, applied BEFORE rows are decided.
   *
   * A label near either extreme slides inward so it does not hang off the
   * axis, and the first version applied that AFTER assignment — so two labels
   * judged clear of each other were then pushed together, and the tightest
   * fixture came back with one overlap on a single row. The shift is part of
   * where a label ends up, so it belongs in the geometry the test reads.
   */
  const shiftPxOf = (v: number) => (pos(v) > 82 ? -32 : pos(v) < 18 ? 32 : 0)
  /**
   * Labels alternate ABOVE and BELOW the axis, and stack only on collision.
   *
   * ── Why every label used to sit underneath ──────────────────────────────
   *
   * Rows were `0, 1, 2 …` and every row was drawn downward, so a three-case
   * ladder put Bear, Base and Bull in a column under the line. That wastes the
   * whole upper half of the chart and, worse, makes a tight cluster stack three
   * deep when the two sides of the axis would have held them in one band each.
   *
   * Alternating by ladder RANK — not by array order, which is not sorted —
   * gives adjacent cases opposite sides, so two labels whose prices are a few
   * pixels apart never touch at all. Only when two labels on the SAME side
   * still overlap does either step further out, which on a real ladder is rare.
   */
  /** Same geometry as `HALF_OF` below, needed before it is declared. */
  const HALF_OF_EV = (chars: number) =>
    ((chars * CHAR_PX) / 2 + LABEL_GAP_PX) / AXIS_PX * 100

  const placed: { centre: number; half: number; side: 1 | -1; row: number }[] = []
  const rowOf = new Map<string, number>()
  const sideOf = new Map<string, 1 | -1>()
  // Sorted by price so "next case up" and "next label side" are the same idea.
  const byPrice = [...groups].sort((a, b) => a.price - b.price)
  byPrice.forEach((g, rank) => {
    const text = Math.max(g.label.length, `${Math.round(g.price)}`.length + 1)
    const half = ((text * CHAR_PX) / 2 + LABEL_GAP_PX) / AXIS_PX * 100
    const centre = pos(g.price) + (shiftPxOf(g.price) / AXIS_PX) * 100
    /**
     * Bear below, Base above, Bull below — as a DEFAULT, then flip, then stack.
     *
     * Rank parity gives that default for the common three-case ladder and
     * keeps the alternation for longer ones, so the eye can follow the rungs
     * without reading a row twice.
     *
     * ── Why flipping beats stacking ─────────────────────────────────────────
     *
     * The resolver used to go straight to `row++` on a collision, pushing the
     * loser to a second row 26px further out. On the DASH ladder — Base $250,
     * 52W high $282 and Bull $300 inside the top third of the axis — that
     * builds a stack away from the axis, and a label two rows out is no longer
     * obviously attached to its own dot.
     *
     * The opposite lane is almost always empty at that x, because the default
     * alternates. So: try the default side, and if something is already there,
     * try the SAME row on the other side before moving outward. Only when both
     * lanes are occupied does it stack, on the default side, which keeps the
     * fallback predictable.
     *
     * The DOT never moves. This decides which side of the axis the text reads
     * on and nothing else — `pos(g.price)` is untouched, so equal dollars stay
     * equal pixels.
     */
    const preferred: 1 | -1 = rank % 2 === 0 ? 1 : -1
    const clashes = (sd: 1 | -1, rw: number) =>
      placed.some(o => o.side === sd && o.row === rw
        && Math.abs(o.centre - centre) < o.half + half)

    let side: 1 | -1 = preferred
    let row = 0
    if (clashes(preferred, 0)) {
      const other = (preferred === 1 ? -1 : 1) as 1 | -1
      if (!clashes(other, 0)) {
        side = other
      } else {
        while (clashes(preferred, row)) row++
      }
    }
    placed.push({ centre, half, side, row })
    rowOf.set(g.key, row)
    sideOf.set(g.key, side)
  })

  /**
   * The expected value gets a label only when one fits.
   *
   * The ring is always drawn at its true x — that is the quantitative claim
   * and it does not depend on there being room for text. The LABEL is
   * optional, because on the ladder this marker most often appears on, the
   * expectation sits between Base and the price and has neither lane free.
   *
   * DASH is the case in point: EV $244 falls between NOW $237 and Base $250,
   * about 2% of the axis from each. A label there would overlap both, and the
   * number is already the hero — `$244 PROBABILITY-WEIGHTED, 3 CASES` in 32px
   * at the top of the card. Repeating it in 8px type over another label buys
   * nothing and costs legibility, so it is simply not drawn.
   */
  const evLabel = (() => {
    if (expected == null || !Number.isFinite(expected)) return null
    const centre = pos(expected)
    const half = HALF_OF_EV(Math.max(2, `${Math.round(expected)}`.length + 1))
    for (const side of [1, -1] as const) {
      const free = !placed.some(o => o.side === side && o.row === 0
        && Math.abs(o.centre - centre) < o.half + half)
      if (free) {
        placed.push({ centre, half, side, row: 0 })
        return { centre, side }
      }
    }
    return null
  })()

  /**
   * The market range, placed AFTER the cases and around them.
   *
   * ── Why it is a second pass rather than two more entries in the first ────
   *
   * The first pass alternates sides by ladder RANK, so feeding the 52-week
   * marks into it would shift every case onto the opposite side of the axis and
   * move labels the phone suite already measures. The cases are the subject;
   * their placement is not up for renegotiation to make room for context.
   *
   * So the cases are placed exactly as before, and these two look for whatever
   * space is left — the same collision test against the same `placed` array,
   * trying the below side first and stepping out only where something is
   * genuinely in the way. Worst case they sit a row further out, which is a
   * quiet mark moving rather than a loud one.
   */
  /**
   * The two ends, or one caption — decided by whether they fit.
   *
   * ── The collision the six-case fixture caught ────────────────────────────
   *
   * AAPL's ladder runs 205-500, so a 52-week range of 142-260 puts the low in
   * the compressed left margin at ~14% and the high INSIDE the modelled band at
   * ~32%. After the end-clamp slides the low inward they are about 9% apart on
   * a 340px axis, and two labels reading "52W LOW" and "52W HIGH" need about
   * 17%. They rendered as "52W LOV52W HIGH".
   *
   * Placing them around the case labels was never going to fix that, because
   * the collision is between the two of THEM. So when the ends cannot both be
   * named they stop being named separately: one caption on the span states the
   * range, which is the same two numbers and one object rather than two.
   *
   * That is the rule the case labels already follow — every coordinate is named
   * while there is room, and above three the axis carries marks with the label
   * belonging to whatever is selected. Same principle, one level down.
   */
  const HALF_OF = (text: number, charPx: number) =>
    ((text * charPx) / 2 + LABEL_GAP_PX) / AXIS_PX * 100
  /**
   * 6.4px a character at 8px, not 5.6.
   *
   * These labels render `uppercase` with `tracking-wide`, so "52W LOW" is
   * meaningfully wider than seven characters of 8px type. The estimate only has
   * to be good enough to decide "do these two touch", and it is deliberately
   * generous in the direction where being wrong is cheap: an unnecessary
   * fallback to the combined caption, rather than an overlap.
   */
  const RANGE_CHAR_PX = 6.4

  /**
   * A label carries its own POSITION, not a price to re-derive one from.
   *
   * The combined caption sits at the middle of the span and is clamped inside
   * the axis, so there is no single price it corresponds to. Storing the
   * resolved centre keeps both modes on one render path instead of branching
   * the JSX on which one is active.
   */
  type RangeLabel = { key: string; text: string; centre: number; side: 1 | -1; row: number }
  const rangeMarks: { key: 'low' | 'high'; price: number }[] = []
  const rangeLabels: RangeLabel[] = []

  const rangeUsable = rangeUsableFor(range52w)

  if (rangeUsable) {
    const low = range52w!.low
    const high = range52w!.high
    rangeMarks.push({ key: 'low', price: low }, { key: 'high', price: high })

    /** Place one label into whatever space the CASES have left. */
    const place = (centre: number, half: number): { side: 1 | -1; row: number } => {
      const clashes = (sd: 1 | -1, r: number) => placed.some(
        o => o.side === sd && o.row === r && Math.abs(o.centre - centre) < o.half + half,
      )
      let side: 1 | -1 = 1
      let row = 0
      if (clashes(1, 0)) {
        if (!clashes(-1, 0)) side = -1
        else if (!clashes(1, 1)) row = 1
        else { side = -1; row = 1 }
      }
      placed.push({ centre, half, side, row })
      return { side, row }
    }

    /**
     * The endpoint labels are ANCHORED, and they stack.
     *
     * ── What the single line was costing ─────────────────────────────────
     *
     * "52W HIGH $282" is thirteen characters of horizontal width hanging off
     * one tick, and `shiftPxOf` then slid it up to 32px toward the middle to
     * keep it on the card. Between the width and the drift, the label stopped
     * looking attached to the end of the shaded range — which is the one thing
     * it is for.
     *
     * Stacked, the box is as wide as its widest LINE — `$282`, four
     * characters — rather than as wide as the sentence. That is roughly a
     * third of the footprint, which both fixes the detachment and removes most
     * of the collisions that caused the drift in the first place.
     *
     * ── The anchoring rule ───────────────────────────────────────────────
     *
     * `centre` is `pos(price)` exactly: no `shiftPxOf`, no drift. The rendered
     * box is edge-aligned — the low label's LEFT edge on the low tick, the
     * high label's RIGHT edge on the high tick — so both read inward and both
     * sit on the end they name.
     *
     * `boxCentre` below exists only for COLLISION bookkeeping. `placed` models
     * every label as centre ± half, and an edge-aligned box is not centred on
     * its anchor, so its notional centre is half a width inward. The anchor
     * itself is untouched.
     *
     * Collisions are resolved vertically — alternate lane, then a further row
     * — never by moving the label along the axis. The only horizontal
     * adjustment is the card-edge safety clamp in the render, which is a
     * couple of pixels and only where a box would otherwise hang off.
     */
    const STACK_CHARS = 5
    const ends = [
      { key: 'low', text: '52W low', price: low, dir: 1 },
      { key: 'high', text: '52W high', price: high, dir: -1 },
    ].map(e => {
      const half = HALF_OF(Math.max(STACK_CHARS, `${Math.round(e.price)}`.length + 1), RANGE_CHAR_PX)
      return {
        ...e,
        // The anchor. Never moved.
        centre: pos(e.price),
        // Where the box actually sits, for overlap tests only.
        boxCentre: pos(e.price) + e.dir * half,
        half,
      }
    })

    const endsCollide =
      Math.abs(ends[0].boxCentre - ends[1].boxCentre) < ends[0].half + ends[1].half
    if (endsCollide) {
      // One object, one label. Centred on the span rather than on either end,
      // because it names the whole range and not a boundary.
      const text = `52W $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()}`
      const mid = (pos(low) + pos(high)) / 2
      const half = HALF_OF(text.length, RANGE_CHAR_PX)
      // Clamped inside the axis so a range hugging one end does not hang off it.
      const centre = Math.min(Math.max(mid, half), 100 - half)
      const { side, row } = place(centre, half)
      rangeLabels.push({ key: 'range', text, centre, side, row })
    } else {
      for (const e of ends) {
        // Placed by its BOX, rendered at its ANCHOR.
        const { side, row } = place(e.boxCentre, e.half)
        rangeLabels.push({ key: e.key, text: e.text, centre: e.centre, side, row })
      }
    }
  }

  /**
   * Diameter no longer encodes probability.
   *
   * It did, and on this corpus that was a lie by omission: 11 of 30 target rows
   * have no probability at all, and the sums that do exist are 125 and 25. A
   * dot sized by a missing or inconsistent weight looks exactly like a dot
   * sized by a real one, and the reader has no way to tell which they are
   * looking at. Every dot is the same size until conviction is trustworthy;
   * the conviction pane is where weight is shown, and it says when it cannot.
   */
  const DOT = 11

  const below = price < lo
  const above = price > hi
  const tapeTone = below ? 'bg-rose-500' : above ? 'bg-emerald-500' : 'bg-gray-900 dark:bg-white'
  /** The leader shares the mark's colour, so the pill reads as its label. */
  const leaderTone = tapeTone
  const pillTone = below
    ? 'bg-rose-500 text-white'
    : above
      ? 'bg-emerald-600 text-white'
      : 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'

  /**
   * The expected-value detail, as a function, because it is rendered TWICE.
   *
   * Once for real, and once invisibly to RESERVE its height — see the readout
   * below. Building it in one place keeps the reserve exactly the size of the
   * thing it reserves for, at any case count and any font size, without anybody
   * maintaining a pixel constant that silently drifts out of step.
   */
  /**
   * How many cases the expected-value strip shows, and how many it does not.
   *
   * Two rows of three. A ladder can carry six cases — AAPL does — and six
   * full-width rows under the chart is the tall table this treatment exists to
   * avoid. Six fit in two rows exactly; anything beyond that is counted rather
   * than drawn, because the Cases pane lists them all with their horizons and
   * is one swipe away.
   *
   * Ladder order is preserved, so the strip reads left to right as the axis
   * does.
   */
  const EV_ROW_CAP = 6
  const evCases = sorted.slice(0, EV_ROW_CAP)
  const evOverflow = Math.max(0, sorted.length - EV_ROW_CAP)

  const expectedDetail = (reserve: boolean) => expected == null ? null : (
    <div
      data-testid={reserve ? 'ladder-detail-reserve' : 'ladder-expected-detail'}
      aria-hidden={reserve || undefined}
    >
      {/* The value, on the line that names it. */}
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          Expected value
        </span>
        <span className="text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">
          ${Math.round(expected).toLocaleString()}
        </span>
      </div>

      {/*
        The distribution as a strip, not a table.

        ── What this replaces ────────────────────────────────────────────────
        A sentence — "Probability-weighted across 3 cases" — over one
        full-width row per case. Three rows plus a caption is about 78px under
        a chart, and on the phone it read as a second section rather than a
        readout. The caption was also redundant: the hero already says `$244`
        over `PROBABILITY-WEIGHTED, 3 CASES` in the metric band above.

        Three columns put the same numbers in two lines. `$180 · 30%` on one
        line is legible at 10px because the middot separates two short
        tabular figures, and the name above it is doing the labelling.

        ── Why the alignment fans outward ────────────────────────────────────
        Left, centre, right — so the strip reads as a span with two ends, the
        same shape as the axis above it. Each column then sits under roughly
        the part of the ladder it belongs to without anybody positioning it
        quantitatively, which would be a second scale to keep in step.

        `grid-cols-3` for three cases; above that it wraps to a second row of
        three rather than growing a column per case, because four narrow
        columns on a 320px card is four truncated names. Two rows is the
        ceiling — see `EV_ROW_CAP`.
      */}
      <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5">
        {evCases.map((c, i) => (
          <div
            key={`${c.name}:${c.price}`}
            className={clsx(
              'min-w-0 leading-tight',
              i % 3 === 0 ? 'text-left' : i % 3 === 1 ? 'text-center' : 'text-right',
            )}
          >
            <span className="block truncate text-[8px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {c.name}
            </span>
            <span className="block truncate text-[10px] tabular-nums text-gray-700 dark:text-gray-200">
              ${Math.round(c.price).toLocaleString()}
              <span className="text-gray-400 dark:text-gray-500">
                {' · '}
                {typeof c.probability === 'number' ? `${Math.round(c.probability)}%` : '—'}
              </span>
            </span>
          </div>
        ))}
        {evOverflow > 0 && (
          /* Said once, quietly, rather than growing a third row. */
          <div className="col-span-3 text-[8px] text-gray-400 dark:text-gray-500">
            +{evOverflow} more in Cases
          </div>
        )}
      </div>
    </div>
  )

  return (
    // The axis is a fixed band, and the block centres inside whatever it is
    // given. It used to be `flex-1`, so on a 236px evidence band the axis
    // absorbed every spare pixel and drew one horizontal line through the
    // middle of ~180px of nothing — the same "the emptiness moved inside the
    // chart" failure the card's own evidence band was rewritten to avoid.
    // 96px is what the markers, the price pill and the end labels actually
    // need; the slack belongs around the block, not inside the axis.
    <div className="flex h-full min-h-0 flex-col justify-center overflow-hidden" data-testid="scenario-ladder">
      {/*
        The axis fills the band; it does not sit in the middle of it.

        ── What the fixed height was costing ────────────────────────────────

        It was `h-[140px] shrink-0` — the height the markers, the labels and the
        price pill actually need — inside a block that centres. Measured at
        390x844 the carousel band is 345px, so the ladder drew 170px of picture
        with 73px of nothing above it and 73px below.

        That slack was not free. The price pill is pinned to the TOP of this box
        and the above-axis labels hang off the axis at its middle, so the
        distance between them is exactly half the box height minus the label
        offset. At 140px that is about 30px of clearance, which is where "the
        current price label crowds the 52-week high" comes from: two small
        stacked labels and a filled pill with barely a line between them.

        Filling the band spends the same pixels on separation instead. The
        centre moves down with the box, the pill stays at the top, and the gap
        grows with the room available — about 120px at this size. `min-h`
        keeps the old height as the floor, so a short band still draws exactly
        what it drew before.
      */}
      <div className="relative min-h-[140px] max-h-[220px] flex-1 overflow-hidden">
        {/* The tape's own price, in its own band above the axis. Coloured by
            which side of the modelled range it sits on, so the claim is
            legible before any number is read. */}
        <div
          className={clsx(
            'absolute top-0 z-20 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums whitespace-nowrap',
            SETTLE, pillTone,
          )}
          style={{
            left: `${pos(price)}%`,
            transform: `translateX(${pos(price) > 68 ? '-100%' : pos(price) < 32 ? '0' : '-50%'})`,
          }}
        >
          {/* NOW, because the reader should not have to infer which mark is
              the tape. It is context rather than a scenario, so it is a pill
              above the axis and a plain mark on it — never a dot that looks
              like something to select. */}
          <span className="mr-1 text-[9px] font-bold uppercase tracking-wide opacity-80">now</span>
          ${price.toFixed(2)}
        </div>

        {/*
          The leader that makes the pill BELONG to the mark.

          ── The detachment, measured ─────────────────────────────────────────
          The pill is pinned to the top of this box and the tape mark sits on
          the axis at the middle, so they are 70-110px apart vertically with
          nothing between them. Horizontally they come apart too: the pill is
          clamped inward near the edges — right-aligned above 68%, left-aligned
          below 32% — so its centre can end up most of a pill-width away from
          the price it names. On AMZN at 390px that was about 42px of offset,
          and the phone read it as "the label is floating near the top right",
          not as "this is where the price is".

          The clamping is not the problem and must stay: unclamped, a price at
          the top of the range puts half the pill off the card. What was
          missing was the statement that the two marks are one thing.

          A 1px rule at EXACTLY `pos(price)` does that, and it is drawn from
          the pill's own position rather than from the clamped label box, so it
          lands on the mark whichever way the pill was pushed. Tinted to the
          pill's tone, faint enough to sit under the case dots, and `z-0` so
          every dot, the expected-value ring and the tape itself paint over it.

          Ends at the axis, not through it: below the line is the labels' side,
          and a rule crossing into it would read as a fifth coordinate.
        */}
        <div
          data-testid="ladder-now-leader"
          aria-hidden
          className={clsx('absolute z-0 w-px -translate-x-1/2 opacity-40', SETTLE, leaderTone)}
          style={{
            left: `${pos(price)}%`,
            // Below the pill (20px at this type size), down to the axis.
            top: '20px',
            height: 'calc(50% - 20px)',
          }}
        />

        {/* Where the market has actually been, as a field rather than as marks.
            Drawn FIRST so everything else paints over it: this is the ground
            the framework sits on, and it must never read as a fifth level on
            the ladder. Wide, faint and unlabelled here — the two ends carry the
            numbers, further down. */}
        {rangeMarks.length === 2 && (
          <div
            data-testid="ladder-52w-span"
            aria-hidden
            className={clsx('absolute top-1/2 -translate-y-1/2 rounded-sm bg-gray-100 dark:bg-gray-800', SETTLE)}
            style={{
              left: `${Math.min(pos(range52w!.low), pos(range52w!.high))}%`,
              width: `${Math.abs(pos(range52w!.high) - pos(range52w!.low))}%`,
              height: '20px',
            }}
          />
        )}

        {/* Axis. The heavier segment is the range the analyst actually
            modelled; outside it is territory their own work does not describe,
            which is what makes the two outside claims worth a card at all. */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-gray-200 dark:bg-gray-700" />

        {/* The distance the price has travelled OUTSIDE the modelled range.
            ── Why it is drawn at all ──────────────────────────────────────────
            The axis was one undifferentiated line with a heavier segment on it,
            so "the market is outside everything I modelled" — the entire reason
            this card exists — had to be reconstructed by comparing a red tick's
            position against where the grey thickened. Drawing the gap makes it
            the first thing the eye resolves.
            Dashed and thin against the solid modelled span: the gap is the part
            nobody wrote down, and it should not look like more ladder. */}
        {(below || above) && (
          <div
            data-testid="ladder-gap"
            className={clsx('absolute top-1/2 -mt-px h-[2px] rounded-full', SETTLE)}
            style={{
              left: `${Math.min(pos(price), below ? pos(lo) : pos(hi))}%`,
              width: `${Math.abs((below ? pos(lo) : pos(hi)) - pos(price))}%`,
              backgroundImage:
                'repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 6px)',
              color: below ? 'rgb(244 63 94 / 0.55)' : 'rgb(16 185 129 / 0.55)',
            }}
          />
        )}

        {/* The range the analyst actually modelled. Solid and heavier, because
            it is the only part of this axis anybody wrote down. */}
        <div
          data-testid="ladder-modelled"
          className={clsx('absolute top-1/2 -mt-[2px] h-[5px] rounded-full bg-gray-400 dark:bg-gray-500', SETTLE)}
          style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }}
        />

        {/* The tape, on the axis. Not a button: the current price is the thing
            the scenarios are measured against, and making it selectable would
            offer a comparison of the price with itself. */}
        <div
          data-testid="ladder-tape"
          aria-hidden
          className={clsx(
            'absolute top-1/2 z-10 h-[16px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full',
            SETTLE, tapeTone,
          )}
          style={{ left: `${pos(price)}%` }}
        />

        {/* Expected value, when there is one. Hollow, so it reads as derived
            rather than as another case the analyst wrote down. */}
        {expected != null && (
          /*
            A BUTTON, with the hit area a thumb needs and a ring that stays 13px.

            The same split the case dots already use: the target is padded and
            transparent, the mark is not. Growing the visible ring to 44px would
            put a disc a third of the axis wide over the very cases the
            expectation is derived from.

            It stays visually distinct from a case at every state. Unselected, a
            hollow ring — derived, not written down. Selected, the ring thickens
            and takes a soft halo rather than filling in, because a filled dot is
            what a SCENARIO looks like and the expectation is not one.
            `pos(expected)` is untouched in both states.
          */
          <button
            type="button"
            data-testid="ladder-expected-hit"
            aria-pressed={evSelected}
            aria-label={`Expected value $${expected.toFixed(2)}`}
            onClick={toggleExpected}
            className={clsx(
              'absolute top-1/2 z-10 flex h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2',
              'items-center justify-center bg-transparent no-touch-target',
              SETTLE,
            )}
            style={{ left: `${pos(expected)}%` }}
          >
            <span
              aria-hidden
              data-testid="ladder-expected"
              data-selected={evSelected ? 'true' : 'false'}
              className={clsx(
                'block h-[13px] w-[13px] rounded-full bg-white transition-all dark:bg-gray-900',
                evSelected
                  ? 'border-[3px] border-gray-900 ring-4 ring-gray-900/15 dark:border-white dark:ring-white/25'
                  : 'border-2 border-gray-500 dark:border-gray-300',
              )}
            />
          </button>
        )}

        {/* Its label, only where the lane resolver found room. See `evLabel`. */}
        {expected != null && evLabel && (
          <div
            aria-hidden
            data-testid="ladder-expected-label"
            className={clsx('absolute flex flex-col items-center whitespace-nowrap leading-tight', SETTLE)}
            style={{
              left: `${evLabel.centre}%`,
              top: '50%',
              width: 'max-content',
              transform: `translate(-50%, ${evLabel.side === 1 ? 14 : -40}px)`,
            }}
          >
            <span className="text-[8px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              EV
            </span>
            <span className="text-[10px] font-medium tabular-nums text-gray-400 dark:text-gray-500">
              ${Math.round(expected).toLocaleString()}
            </span>
          </div>
        )}

        {/* One dot per case. Diameter scales with probability where the analyst
            set one; a 7% tail must still be visible, so there is a floor. No
            labels means no collision is possible at any density. */}
        {/* The hit area is 32px; the dot stays 11px.
            An 11×11 target is roughly a quarter of a fingertip, and these were
            the only way to select a case from the axis. Growing the dot would
            wreck the chart — six of them at 32px on a 390px axis would overlap
            into a smear — so the BUTTON is padded and transparent, and the dot
            is drawn inside it. Same picture, a target three times the size.
            32 rather than 44 because adjacent cases can sit ~40px apart and a
            full-size target would make neighbours ambiguous; the legend below
            carries the same selection at full width for anyone who misses. */}
        {/* Two elements per coordinate: the mark, and its label.
            They were one button wrapping both, and a shrink-to-fit box that
            has to hold a 71px label while sitting at 100% of the axis cannot
            be sized without either clipping the label or reporting a
            scrollWidth wider than its box — which the card's
            nothing-scrolls-sideways rule catches, correctly.
            Split, each sizes itself: the mark is a fixed 32px target on its
            true position, and the label is its own max-content box that slides
            inward at the ends. Both carry the same `g.key`, so there is still
            one selection and no second mapping. */}
        {groups.map(g => {
          const on = selected?.key === g.key
          const shift = shiftPxOf(g.price)
          return (
          <span key={g.key}>
            <button
              type='button'
              data-testid='ladder-dot'
              data-group-key={g.key}
              data-group-price={g.price}
              aria-label={`${g.label} $${g.price.toFixed(2)}`}
              aria-pressed={on}
              onClick={() => toggle(g)}
              className='absolute z-10 flex items-center justify-center'
              style={{ left: `${pos(g.price)}%`, top: '50%', width: '32px', height: '32px', transform: 'translate(-50%, -50%)' }}
            >
              <span
                aria-hidden
                className={clsx('rounded-full transition-colors', on
                  ? 'bg-gray-900 ring-4 ring-gray-900/20 dark:bg-white dark:ring-white/25'
                  : 'bg-gray-500 ring-2 ring-white dark:bg-gray-300 dark:ring-gray-900')}
                style={{ width: `${DOT}px`, height: `${DOT}px` }}
              />
            </button>
            {/* Rendered, or not at all.
                The HTML `hidden` attribute sets `display: none` from the UA
                stylesheet, and the class list on this button sets
                `display: flex` — which wins. The label stayed on screen and
                the measurement still showed a 1px gap. */}
            {(labelAll || on) && (
            <button
              type='button'
              data-testid='ladder-dot-label'
              data-group-key={g.key}
              tabIndex={-1}
              aria-hidden
              onClick={() => toggle(g)}
              className='absolute z-10 flex flex-col items-center whitespace-nowrap leading-tight no-touch-target'
              /* Above or below its own rule, per `sideOf`. The label box is ~26px tall,
                 so the above-side offset carries its full height plus the gap. */
              style={{ left: `${pos(g.price)}%`, top: '50%', width: 'max-content', transform: `translate(calc(-50% + ${shift}px), ${
                (sideOf.get(g.key) ?? 1) === 1
                  ? 14 + (rowOf.get(g.key) ?? 0) * 26
                  : -40 - (rowOf.get(g.key) ?? 0) * 26
              }px)` }}
            >
              <span className={clsx('text-[9px] font-bold uppercase tracking-wide', on ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400')}>{g.label}</span>
              <span className={clsx('text-[11px] font-bold tabular-nums', on ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300')}>${Math.round(g.price).toLocaleString()}</span>
            </button>
            )}
          </span>
          )
        })}

        {/* The ends of the market range: a hairline tick and a quiet number.
            ── Why a tick and not a dot ────────────────────────────────────────
            A dot is what a CASE is on this axis, and it is a button. These are
            neither. A 1px rule is the thinnest mark that still reads as a
            position, it cannot be confused with an 11px filled circle, and it
            carries no hit area at all — so there is nothing for a thumb aiming
            at a case to land on by mistake.
            The type follows the same rule: 8px medium against the case's 9px
            bold, and the price at 10px against 11px, both in the muted grey the
            card uses for supporting figures. Read at a glance the difference is
            weight, which is exactly the hierarchy being asserted. */}
        {/* The ticks: one per end, always both, never a label of their own. */}
        {rangeMarks.map(m => (
          <div
            key={m.key}
            aria-hidden
            data-testid="ladder-52w"
            data-bound={m.key}
            /*
              20px, the height of the span itself.

              At 12px against a 20px band the ticks sat INSIDE the grey and the
              range read as a floating rectangle with two scratches in it —
              which is what "the 52W range feels like a floating annotation"
              is describing. Matching the band's height makes the two ticks its
              END CAPS: one object, bounded, with the two labels naming the two
              bounds. Still a hairline, still no hit area, still unmistakably
              not the 11px filled circle that means a case.
            */
            className={clsx('absolute top-1/2 h-[20px] w-px -translate-x-1/2 -translate-y-1/2 bg-gray-300 dark:bg-gray-500', SETTLE)}
            style={{ left: `${pos(m.price)}%` }}
          />
        ))}

        {/* The names: two where they fit, one caption where they do not.
            Either way this is a `<div>` and not a `<button>` — a case is a
            tappable dot on this axis and these are not cases. There is nothing
            here for a thumb aiming at a case to land on by mistake. */}
        {rangeLabels.map(l => (
          <div
            key={l.key}
            aria-hidden
            data-testid="ladder-52w-label"
            data-bound={l.key}
            /*
              Edge-aligned to its own tick, so the pair reads as the two BOUNDS
              of the range rather than as two more floating markers.

              The low label's LEFT edge sits on the low tick and its text is
              left-aligned; the high label's RIGHT edge sits on the high tick,
              right-aligned. A case dot is centre-aligned, so the difference in
              alignment is itself the signal that these are not cases — before
              any type weight is read.

              It also removes the collision this had with Bear and Bull. Centred
              on its tick, a 52W label spread half its width in BOTH directions
              and the nearest case label was the thing it landed on. Spreading
              inward only halves the footprint and puts it over the middle of
              the axis, which is empty, instead of over a rung.

              The TICK does not move — `l.centre` is still the quantitative
              position, and the combined `range` caption keeps its centred
              treatment because it names a span rather than an end.
            */
            className={clsx(
              'absolute flex flex-col whitespace-nowrap leading-tight', SETTLE,
              l.key === 'low' ? 'items-start text-left'
                : l.key === 'high' ? 'items-end text-right'
                  : 'items-center',
            )}
            style={{
              // The ANCHOR, never adjusted for collisions. The only horizontal
              // give is `min/max` — a card-edge safety clamp of a few percent,
              // so a box cannot hang off the frame. Endpoints sit at 4% and
              // 96% at the extremes, so it almost never engages.
              left: `${Math.min(Math.max(l.centre, 1), 99)}%`,
              top: '50%',
              width: 'max-content',
              transform: `translate(${
                l.key === 'low' ? '0' : l.key === 'high' ? '-100%' : '-50%'
              }, ${l.side === 1 ? 14 + l.row * 26 : -40 - l.row * 26}px)`,
            }}
          >
            {l.key === 'range' ? (
              /* The combined caption is one line: it already carries both
                 numbers, and splitting "52W" onto a line of its own would make
                 a two-line block out of a label that exists because there was
                 no room for two. */
              <span className="text-[9px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {l.text}
              </span>
            ) : (
              /*
                Three tight lines instead of one wide one.

                `52W` is the quietest — it says which range, and it is the same
                word on both ends. `LOW`/`HIGH` names the bound. The price is a
                step stronger because it is the fact being read, and still
                below a case label's 9px bold, which keeps the market context
                secondary to the analyst's own work.

                `leading-none` with a hair of tracking: the stack has to read as
                one object attached to one tick, and three loosely-spaced lines
                would read as three marks.
              */
              <>
                <span className="text-[7px] font-medium uppercase tracking-[0.08em] leading-none text-gray-400 dark:text-gray-500">
                  52W
                </span>
                <span className="text-[8px] font-semibold uppercase tracking-wide leading-none text-gray-400 dark:text-gray-500">
                  {l.key === 'low' ? 'Low' : 'High'}
                </span>
                <span className="text-[10px] font-medium tabular-nums leading-tight text-gray-500 dark:text-gray-400">
                  ${Math.round(l.key === 'low' ? range52w!.low : range52w!.high).toLocaleString()}
                </span>
              </>
            )}
          </div>
        ))}

        {/* The bare axis ticks are gone.
            They read "$349" at one end and "$1605" at the other — numbers with
            no name attached, which look like axis furniture and were in fact
            the price and the bull case. Every plotted coordinate now carries
            its own name and number, so a tick is either a duplicate of one or
            a number belonging to nothing. */}
      </div>

      {/* What the tap actually said.
          The dots and the legend were both tappable and both only changed
          colour, so the control was interactive in the sense that it responded
          and inert in the sense that it told you nothing. The comparison a
          reader wants off this chart is "how far is the tape from THAT case",
          which is arithmetic between two marks the axis draws but never states.
          Selecting a case states it. */}
      {/* A FIXED two lines, whatever is selected.
          The resting state is one line and a selected group is two — the label
          and then its horizons — so the block grew on selection, and the axis
          above it is centred in what is left. Tapping a case therefore moved
          the line the reader had just aimed at. Reserving both lines costs
          14px of a pane that has them and makes selection change nothing but
          the text. */}
      {/*
        The readout's height NEVER depends on what is selected.

        ── The shift this removes ─────────────────────────────────────────────
        This grew for the expected-value detail and kept a fixed 30px otherwise.
        The axis above is `flex-1` between 140px and 220px, so it gave the
        height back — and the whole ladder rose the moment EV was tapped. The
        reader aims at a mark and the chart moves out from under the tap, which
        is the exact failure the fixed 30px was introduced to prevent,
        reintroduced by the one state that was allowed to opt out of it.

        ── How the space is reserved ─────────────────────────────────────────
        By rendering the tallest state INVISIBLY and laying the real content
        over it. The reserve is the EV detail itself, so it is exactly the right
        size at three cases or at six, at any font size, and there is no pixel
        constant for anybody to get wrong later. A ladder with no expected value
        has no EV state to reach, so it reserves the two lines the selected-case
        readout needs and nothing more.

        `relative` + `absolute inset-0` means the content is out of flow and
        cannot push anything. Only opacity transitions — never height, margin,
        padding or translation — so the visualization is pinned and the words
        underneath it change.
      */}
      <div
        className="relative mt-1 shrink-0 overflow-hidden text-[11px] leading-snug text-gray-500 dark:text-gray-400"
        data-testid="ladder-readout"
      >
        {/* The reserve. Never visible, never announced, never interactive. */}
        <div aria-hidden className="invisible" data-testid="ladder-readout-reserve">
          {expected != null ? expectedDetail(true) : <div className="h-[30px]" />}
        </div>

        <div className="absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none">
        {evSelected && expected != null ? (
          expectedDetail(false)
        ) : selected ? (
          <span className="text-gray-700 dark:text-gray-200">
            <span className="font-bold uppercase tracking-wide">{selected.label}</span>
            {' '}${selected.price.toFixed(2)} is{' '}
            <span className={clsx(
              'font-bold tabular-nums',
              selected.price >= price
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}>
              {selected.price >= price ? '+' : ''}
              {(((selected.price - price) / price) * 100).toFixed(0)}%
            </span>
            {' '}from ${price.toFixed(2)}
            {/* The horizons, which is what a shared target hides.
                "2 cases at this price" said there was a distinction and not
                what it was; "Bear 6m · Base 12m" is the distinction. A single
                case states its horizon in full. */}
            <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-gray-400">
              {selected.cases.length === 1
                ? [horizonPhrase(selected.cases[0].timeframe),
                   typeof selected.cases[0].probability === 'number'
                     ? `weighted ${Math.round(selected.cases[0].probability)}%` : null]
                    .filter(Boolean).join(' · ')
                : memberSummary(selected)}
            </span>
          </span>
        ) : (
          /* One line, not two.
             It was "Tap a case to compare it with the price." above "Ladder
             last updated 23 Aug 2026." — two sentences of housekeeping under a
             chart, in a block that reserves exactly two lines for the SELECTED
             state's readout. On the phone it read as a paragraph.
             The instruction loses four words it did not need ("it with the
             price" is what the axis already shows) and the provenance loses
             its verb. A middot joins them because they are two labels, not a
             sentence. `whitespace-nowrap` is the assertion: this must never
             wrap, and at 320px it does not. */
          <span className="block whitespace-nowrap" data-testid="ladder-hint">
            Tap a case to compare
            {statedOn && (
              <>
                <span className="mx-1.5 text-gray-300 dark:text-gray-600" aria-hidden>·</span>
                <span data-testid="ladder-stated-on">Updated {statedOn}</span>
              </>
            )}
          </span>
        )}
        </div>
      </div>
      {/* The chip row is gone.
          It existed because the dots were unlabelled: it carried the case
          names at full width so the reader could map them back onto the axis.
          Now every coordinate names itself, and a second list of the same two
          entries is the mapping problem restated rather than a second way to
          tap. Its one real advantage — a wide target — moved into the dot,
          whose hit area is 92x28 around an 11px mark. */}
    </div>
  )
}
