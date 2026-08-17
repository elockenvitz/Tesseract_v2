import { SignalCardView } from '../signals/SignalCardView'
import type { SignalCard } from '../../lib/signals/contract'

interface SignalCardSectionProps {
  card: SignalCard
  onOpenAsset: (assetId: string, symbol: string) => void
  onCapture: (ctx: { assetId: string | null; symbol: string | null; name: string | null }) => void
  onSnooze: (card: SignalCard) => void
  onDismiss: (card: SignalCard) => void
  onWhy: (card: SignalCard) => void
  onPrimary: (card: SignalCard) => void
  /** Chart or ladder for the evidence band. Supplied here so the card
   *  component never imports a chart. */
  evidence?: React.ReactNode
  /** Revealed in place by the card's disclosure control. */
  detail?: React.ReactNode
  detailLabel?: string
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
      className="relative h-full w-full snap-start snap-always overflow-y-auto border-b-8 border-gray-200 dark:border-gray-800"
    >
      <SignalCardView
        card={card}
        evidence={evidence}
        detail={detail}
        detailLabel={detailLabel}
        onOpen={c => {
          if (c.entity.kind === 'asset') onOpenAsset(c.entity.id, c.entity.ticker ?? c.entity.name)
          else if (c.actions.open.href.startsWith('http')) window.open(c.actions.open.href, '_blank', 'noopener')
        }}
        onAction={(actionId, c) => {
          if (actionId === 'snooze') return onSnooze(c)
          if (actionId === 'dismiss') return onDismiss(c)
          if (actionId === 'why') return onWhy(c)
          if (actionId === 'capture') {
            return onCapture({
              assetId: c.entity.kind === 'asset' ? c.entity.id : null,
              symbol: c.entity.ticker ?? null,
              name: c.entity.name,
            })
          }
          onPrimary(c)
        }}
      />
    </section>
  )
}
