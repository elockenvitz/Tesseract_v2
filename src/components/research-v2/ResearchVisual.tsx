/**
 * Desktop Research — the anchored price window.
 *
 * ── The window rule, again ────────────────────────────────────────────────
 *
 * The anchor is the date the investment case was last written. A chart may
 * only say SINCE LAST REVIEW if the series actually reaches that date. Where
 * it does not, the label states the window that WAS measured and the anchor
 * tick is not drawn — a marker at the left edge of a shorter series would
 * assert "this is where you last looked" about a date the data never saw.
 *
 * Same grammar as Today's review-window and Ideas' performance chart: area,
 * line, emphasised endpoint, dashed anchor, window named in the caption.
 */
/**
 * ── Price paths are evidence, not grades ─────────────────────────────────
 *
 * These lines were green when the price rose and red when it fell. That reads
 * as a verdict: a stale thesis on a name that fell looked like a failure, and
 * one on a name that rose looked like a success, when the only thing either
 * chart states is what the price did. Decisions settled this first and the
 * whole desktop now follows -- ONE ink regardless of sign.
 *
 * The number keeps its + / - because the sign is a fact. The hue goes because
 * "good" is not. This is deliberately not the severity palette either: rose
 * would say broken and emerald would say healthy, and a price path claims
 * neither. Genuine framework breaks -- spot outside its own case -- keep their
 * critical treatment, because there the framework really is broken.
 */


import { dateWords, type ResearchDateKind } from '../../lib/desktop-research'
import { AnchoredPriceChart } from '../desktop/AnchoredPriceChart'

/*
 * ── The slicer moved to `lib/market-data/anchored-window` ────────────────
 *
 * It lived here, and Decisions imported it from this lens -- one lens
 * reaching into another. When the shared tile shell needed it too, that would
 * have made `components/desktop` depend on `components/research-v2`, so a
 * sparkline re-derived the window inline instead and reproduced this
 * function's own bug within the hour: a series whose closes all post-date the
 * anchor is not a since-the-anchor window.
 *
 * Re-exported here so this lens's own importers are unchanged.
 */
export { anchoredWindow } from '../../lib/market-data/anchored-window'
import type { AnchoredWindow } from '../../lib/market-data/anchored-window'
export type { AnchoredWindow }

/**
 * `since` names the date the window starts from -- a review only where one was
 * recorded. It is required: the chart used to say "since last review" about
 * every anchor it was given.
 */
/**
 * ── The drawing moved to `desktop/AnchoredPriceChart` ────────────────────
 *
 * Everything this function's header used to argue -- the 1.61x horizontal
 * smear under `preserveAspectRatio="none"`, the ellipse where a dot should
 * be, 88px of plot against Today's 166, no scale and nothing to point at --
 * was fixed HERE and nowhere else, so the Decisions detail pane went on
 * drawing the identical defect from its own copy (measured at 1.87x). The
 * geometry is shared now, for the same reason `anchoredWindow` is: one
 * definition of how a price path looks, or the lenses drift apart one pass
 * at a time.
 *
 * What stayed in this lens is what belongs to it -- the WORDS. `dateWords`
 * knows whether the anchor is a review, a writing or an update, and the chart
 * does not: it was saying "since last review" about every anchor it was given
 * before this lens took that decision back.
 */
export function PriceSinceReview({ w, since, height = 166 }: { w: AnchoredWindow; since: ResearchDateKind; height?: number }) {
  const words = dateWords(since)
  return (
    <AnchoredPriceChart
      w={w}
      height={height}
      caption={w.reachesAnchor ? words.priceSince : 'Price over available history'}
      meta={w.reachesAnchor ? `${words.since} · ${w.days}d` : `${w.days}d of history`}
      anchorTick={words.tick.toLowerCase()}
      readoutTestId="research-chart-readout"
      note={!w.reachesAnchor
        ? `History does not reach ${words.the}, so this is not a ${words.since} move.`
        : undefined}
    />
  )
}
