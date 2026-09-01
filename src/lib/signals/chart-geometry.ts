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
 * The standard plot height.
 *
 * 280px, taken from the Case vs Price pane at a real phone card height —
 * measured at 285px, which is the geometry that was reviewed and accepted.
 * Substantial enough to read a year of closes off, short enough that the card
 * is still a card.
 *
 * `min(...)` with a viewport term is the responsive half, and it is ONE rule
 * for every family rather than each card shrinking to its own header: on a
 * tall phone the fixed number wins, and on a short one the viewport term
 * lowers every chart on that device by the same amount. `svh` rather than
 * `vh` because mobile browser chrome collapses on scroll, and a chart that
 * changed height when the address bar retracted would be the jitter this
 * codebase has already paid for twice.
 *
 * `shrink` and `min-h-0` are the floor of last resort: on a card genuinely too
 * short for the standard, the plot gives height back rather than pushing the
 * x-axis and the pager out through the bottom of the pane.
 */
export const FEED_CHART_PLOT = 'h-[min(280px,34svh)] shrink min-h-0'

/**
 * The fullscreen chart, which is deliberately exempt.
 *
 * Expanding a chart is a request for more of it, so the overlay uses the
 * screen. The standard is about the FEED, where a chart shares a card with a
 * headline, a metric, a judgment and a footer.
 */
export const FULLSCREEN_CHART_PLOT = 'flex-1 min-h-0'

/**
 * The numbers behind the class, for tests and for anybody reading the rule
 * without a browser. Kept beside the class so the two cannot drift.
 */
export const FEED_CHART_PLOT_PX = 280
export const FEED_CHART_PLOT_VH = 34
