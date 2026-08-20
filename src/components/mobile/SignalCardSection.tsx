import { SignalCardView } from '../signals/SignalCardView'
import type { SignalCard } from '../../lib/signals/contract'
import { resolveFeedAction, type FeedActionKey } from '../../lib/signals/feed-actions'
import type { FeedFeedbackOption } from '../../lib/signals/feed-feedback'

interface SignalCardSectionProps {
  card: SignalCard
  onOpenAsset: (assetId: string, symbol: string) => void
  onCapture: (ctx: { assetId: string | null; symbol: string | null; name: string | null }) => void
  onSnooze: (card: SignalCard) => void
  onDismiss: (card: SignalCard) => void
  onWhy: (card: SignalCard) => void
  /**
   * Everything the card's action grammar does not handle itself.
   *
   * Receives the ACTION ID as well as the card. Without it every unmatched
   * action collapsed into one indistinguishable callback, which was fine while
   * the only unmatched action was "primary" — and became wrong the moment
   * posts arrived carrying share / ask / promote / readthrough in the menu.
   */
  onPrimary: (card: SignalCard, actionId: string) => void
  /** Chart or ladder for the evidence band. Supplied here so the card
   *  component never imports a chart. */
  evidence?: React.ReactNode
  /** Revealed in place by the card's disclosure control. */
  detail?: React.ReactNode
  detailLabel?: string
  /** False when the detail is a single control rather than content worth
   *  hiding. See `SignalCardView`. */
  detailCollapsible?: boolean
  /** Narrow the feed to this kind. */
  onFilterKind?: (type: SignalCard['type']) => void
  /** A portfolio named in the context row was tapped. */
  onOpenPortfolio?: (portfolioId: string, name: string) => void
  /**
   * Navigate to a contextual destination — the case editor, the target editor,
   * the thesis field.
   *
   * Separate from `onPrimary` because these are NAVIGATIONS with a resolved
   * target, not card-specific callbacks. Routing them here means one resolver
   * decides where "Review cases" goes for every card that offers it, rather
   * than each call site inventing its own answer.
   */
  onFeedAction?: (target: { id: string; title: string; type: string; data: Record<string, unknown> }) => void
  /** Feedback about the feed, from the overflow menu. Separate loop, separate
   *  store — see lib/signals/feed-feedback.ts. */
  onFeedback?: (card: SignalCard, option: FeedFeedbackOption) => void
}

/**
 * A contract card inside the legacy feed scroller.
 *
 * The wrapper is the whole point. Every legacy tile sits in
 * `h-full w-full snap-start snap-always` — a full viewport per card, which is
 * the layout the contract cards exist to replace. Putting a content-height
 * card in that container would stretch it back to a screen and undo the
 * change, so these get their own section: still snap-start, so the scroller
 * behaves, but auto height.
 *
 * That is why the two paradigms are visibly different while the flag is on.
 * They are supposed to be. The mixed state is a step, not a destination — the
 * exit is the remaining four builders and the deletion of the legacy tiles.
 */
export function SignalCardSection({
  card, onOpenAsset, onCapture, onSnooze, onDismiss, onWhy, onPrimary, evidence, detail, detailLabel,
  detailCollapsible, onFilterKind, onOpenPortfolio, onFeedAction, onFeedback,
}: SignalCardSectionProps) {
  return (
    <section
      data-signal-card={card.type}
      // snap-start without snap-always: a short card should not trap the
      // scroller the way a full-screen tile does, and several in a row should
      // be scrollable past as a group.
      // One screen per card, matching the legacy tiles rather than sitting
      // short among them. The earlier short version made a card carrying a real
      // finding look like a table row beside a full-screen tile.
      // Content height with a one-screen ceiling.
      //
      // `snap-always` stays: it is what makes one swipe advance exactly one
      // tile, which is the feed's core gesture and is asserted by
      // e2e/feed-gesture.spec.ts. Only the HEIGHT changed — `h-full` forced
      // every card to a full screen whatever it contained.
      //
      // `dvh` rather than `vh` because Safari's toolbar makes `vh` taller than
      // the visible viewport, which would put the action bar under the browser
      // chrome on exactly the device this surface is for.
      // ── The outermost of the nested scrollers, and the worst of them ─────
      //
      // This was `max-h-[100dvh] overflow-y-auto`, which made every card its
      // own vertical scroll container sitting inside the feed's vertical snap
      // scroller. Any upward drag was then ambiguous — "scroll this card" or
      // "next card" — and the browser resolves that in favour of the inner
      // scroller, so the feed simply stopped advancing on the tall cards.
      //
      // The feed owns vertical. A card that cannot fit pages sideways.
      // ── h-full, NOT h-[100dvh] ───────────────────────────────────────────
      //
      // `100dvh` is the whole visible viewport. The feed is not the whole
      // viewport: it sits below the mode/filter header, and in a mobile browser
      // below the address bar and above whatever chrome the browser keeps at
      // the bottom. So every card was taller than the space it had by the
      // height of that header, and the overflow came off the BOTTOM — which is
      // where the action bar lives.
      //
      // That is one cause with four symptoms, all reported from a real phone:
      // Capture / Review cases / Open sitting below the fold, the target slider
      // cut off, content hidden behind browser chrome, and — least obviously —
      // snapping that would not settle, because the snap points were spaced one
      // viewport apart inside a scrollport that was shorter than one viewport,
      // so a short drag could come to rest between two of them.
      //
      // `h-full` resolves against the scroll container, which is the box the
      // card actually has to fit in.
      className="relative h-full w-full snap-start snap-always overflow-hidden border-b-8 border-gray-200 dark:border-gray-800"
    >
      <SignalCardView
        card={card}
        evidence={evidence}
        detail={detail}
        detailLabel={detailLabel}
        detailCollapsible={detailCollapsible}
        onFilterKind={onFilterKind}
        onFeedback={onFeedback ? o => onFeedback(card, o) : undefined}
        // From the disclosure row's explicit "Open →", never from the chip.
        onOpenPortfolio={onOpenPortfolio}
        onContext={chip => {
          // The only routable chip today is a portfolio. Parsing the href
          // rather than carrying a second field keeps the contract's chip shape
          // unchanged, and an unrecognised href is ignored rather than guessed.
          const m = /^\/portfolio\/(.+)$/.exec(chip.href ?? '')
          if (m) onOpenPortfolio?.(m[1], chip.label)
        }}
        onOpen={c => {
          if (c.entity.kind === 'asset') onOpenAsset(c.entity.id, c.entity.ticker ?? c.entity.name)
          else if (c.actions.open.href.startsWith('http')) window.open(c.actions.open.href, '_blank', 'noopener')
        }}
        onAction={(actionId, c) => {
          if (actionId === 'snooze') return onSnooze(c)
          if (actionId === 'dismiss') return onDismiss(c)
          if (actionId === 'why') return onWhy(c)
          // A contextual action resolves to a destination or it does not
          // exist. `resolveFeedAction` returning null is the guard that stops
          // a mislabelled button silently falling through to something else:
          // it drops to `onPrimary` below, which is where the card's own
          // handler lives.
          const target = resolveFeedAction(actionId as FeedActionKey, {
            assetId: c.entity.kind === 'asset' ? c.entity.id : null,
            symbol: c.entity.ticker ?? null,
            name: c.entity.name,
          })
          if (target && onFeedAction) return onFeedAction(target)
          if (actionId === 'capture') {
            return onCapture({
              assetId: c.entity.kind === 'asset' ? c.entity.id : null,
              symbol: c.entity.ticker ?? null,
              name: c.entity.name,
            })
          }
          onPrimary(c, actionId)
        }}
      />
    </section>
  )
}
