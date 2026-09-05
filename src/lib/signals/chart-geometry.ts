/**
 * How tall a price chart is on the mobile feed.
 *
 * ── The inconsistency this exists to remove ───────────────────────────────
 *
 * The plot was `flex-1` inside a pane that is `h-full` inside a carousel
 * workspace that owns whatever the card's header, description and footer do
 * not need. So the chart's height was, transitively, a function of how much
 * chrome that card's family happened to carry: measured at 390x844 on one
 * viewport, plots came out at 117px and 384px on the same screen. A card with
 * a light header got a chart that took over the card; a Research or Trade Idea
 * header pushed the same component down to a strip.
 *
 * None of that is a decision anybody made. It is the workspace rule leaking
 * one level down, and it reads as several different chart components rather
 * than one appearing in several investment contexts.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * At a given viewport, every ordinary feed price chart gets the same plot
 * height. Not derived from the header, the description, the card family, or
 * how much room the carousel happens to have left.
 *
 * The workspace stays flexible — that is 947a97c and it is not being undone.
 * What changes is that the chart stops consuming it. A pane taller than its
 * chart is intentional: controls and plot as one block at the top, the pager
 * on the workspace's bottom edge, composed space between.
 */

/**
 * The standard plot height, per viewport band.
 *
 * ── The bug this shape exists to kill ─────────────────────────────────────
 *
 * The height used to be a ceiling — `min(280px, 34svh)` — over a box that
 * could still `shrink`. On a tall screen the ceiling bound and every family
 * agreed. On a short one it did not, and the box shrank to whatever the
 * carousel workspace had left, which is
 *
 *     card - HEADER - description - footer
 *
 * and the header is family-specific. Measured on the real card shells at 400px
 * wide: No Core Thesis 105px of header, Material Move and Trade Idea 179,
 * New Research 191, Case vs Price 213. So at a 400x700 phone the lightest
 * family sat on the ceiling and the heaviest lost 108px of chart, and the same
 * component read as five different components. The diagnostic put a number on
 * it: every pixel added to a header took exactly one pixel off the plot.
 *
 * A ceiling plus shrink is not one rule; it is a rule and an override. So the
 * height is chosen OUTRIGHT, before flex distributes anything, and it is
 * chosen from the viewport alone.
 *
 * ── Why bands rather than a formula ───────────────────────────────────────
 *
 * The constraint is not proportional. A header costs a fixed number of pixels
 * whatever the screen, so the room left for a chart is `card - constant`, and
 * expressing that as a `calc` against viewport units would bake in an estimate
 * of the app shell's own chrome — a number that is not in this file's control
 * and would silently rot. Three bands, each verified against the WORST family
 * rather than the lightest one, say the same thing and can be checked by
 * reading them.
 *
 * `min-height` media queries also resolve against the initial containing
 * block, not the dynamic viewport, so the band cannot flip while the address
 * bar collapses. That is deliberate: a chart that resized on scroll is the
 * jitter this codebase has already paid for twice.
 *
 * ── The bands ─────────────────────────────────────────────────────────────
 *
 *   >= 768px viewport  208px   iPhone 14/15 class
 *   720-767            160px
 *   688-719            128px   the 400x700 class, including the reader's own
 *   < 688              96px    the smallest supported phone
 *
 * Each is under the HEAVIEST family's budget at that band, not the lightest.
 * Measured on the real card shells, the room a Case vs Price card has for a
 * plot is `cardHeight - 450`: its 213px header, the 154px the description,
 * gap, column padding and footer cost between them, and the 83px the pager and
 * the price pane's own controls and axis cost inside the workspace. So these
 * values need a card of at least 546 / 578 / 610 / 658 px respectively.
 *
 * ── The 20px that was cutting the description off ────────────────────────
 *
 * The thresholds used to be 0 / 700 / 800, chosen to leave "roughly 90px of
 * app chrome above the feed at every band". The shell actually takes 110 — the
 * app header is 65 and the mode bar 45 — so at a 700px phone the card is 590,
 * not 610, and the 160px band was claiming a plot its card could not afford.
 * The overflow came off the bottom of the column: the description slid under
 * the sticky action tray and lost its second line. Reported on Target Reached,
 * which has the longest body of the lens family and so ran out first.
 *
 * The plot heights are unchanged and still correct. What was wrong was WHEN
 * each one applies, and it was wrong by exactly the 20px the chrome estimate
 * was short. Each threshold is now its band's own `needsCardPx` plus the real
 * chrome, so the rule is arithmetic rather than an estimate — and
 * `APP_CHROME_PX` is the one number to change if the shell ever does.
 *
 * The margin is spent on being safe rather than on being large, deliberately.
 * A chart 40px shorter than it could be is a worse chart; a chart that is 40px
 * taller on one family than another is a worse PRODUCT, because it stops
 * reading as one component. Consistency wins.
 *
 * `shrink` and `min-h-0` remain, and at every supported size they are inert —
 * they exist for a viewport nobody has tested, where clipping the pager would
 * be worse than a smaller chart.  `grow-0` is the other half: spare room in a
 * pane belongs to the composition around the chart, never to the chart.
 */
export const FEED_CHART_PLOT = [
  'h-[96px]',
  '[@media(min-height:688px)]:h-[128px]',
  '[@media(min-height:720px)]:h-[160px]',
  '[@media(min-height:768px)]:h-[208px]',
  'shrink grow-0 min-h-0',
].join(' ')


/**
 * The fullscreen chart, which is deliberately exempt.
 *
 * Expanding a chart is a request for more of it, so the overlay uses the
 * screen. The standard is about the FEED, where a chart shares a card with a
 * headline, a metric, a judgment and a footer.
 */
export const FULLSCREEN_CHART_PLOT = 'flex-1 min-h-0'

/**
 * The bands, as data.
 *
 * Beside the class so a test can check the rendered height against the rule
 * rather than against a number retyped somewhere else, and so anybody reading
 * this without a browser can see what resolves where.
 */
/**
 * What the app shell takes above the feed scroller.
 *
 * The header is 65 and the mode bar 45 — see `MODE_BAR`, which the back bar
 * that replaces it is also built from, precisely so this number stays true
 * whichever of the two is on screen.
 */
export const APP_CHROME_PX = 110

export const FEED_CHART_BANDS = [
  { minViewportHeight: 768, plotPx: 208, needsCardPx: 658 },
  { minViewportHeight: 720, plotPx: 160, needsCardPx: 610 },
  { minViewportHeight: 688, plotPx: 128, needsCardPx: 578 },
  { minViewportHeight: 0, plotPx: 96, needsCardPx: 546 },
] as const

/** The plot height this rule gives a viewport of `h` CSS pixels tall. */
export function feedChartPlotPx(viewportHeight: number): number {
  return (FEED_CHART_BANDS.find(b => viewportHeight >= b.minViewportHeight)
    ?? FEED_CHART_BANDS[FEED_CHART_BANDS.length - 1]).plotPx
}
