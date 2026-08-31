/**
 * The expanded work deck.
 *
 * ── What replaced the right-hand list ────────────────────────────────────
 *
 * Stage 3B put an "Up next" column on the right: four text rows of ticker,
 * state and a percentage. It read as a table of contents appended to a detail
 * page, and it made a reader want to click nothing. It has been removed
 * outright rather than restyled -- the abstraction was wrong, not the paint.
 *
 * ── Why left ─────────────────────────────────────────────────────────────
 *
 * The reader pulls one card out of the deck and it expands to the right. What
 * remains is the rest of the deck, and a deck sits where you left it. Putting
 * the peers on the right made them feel like an afterthought bolted to the
 * work; on the left they are the stack the work came out of, and the return
 * control sits at the top of that stack where it belongs.
 *
 * ── Rail cards are cards ─────────────────────────────────────────────────
 *
 * Each carries an object, the reason it deserves attention, one figure that
 * matters and a semantic state, in the lens's own visual language. The
 * acceptance test is whether looking at the rail makes you want to open
 * something -- a bordered list row does not.
 *
 * ── One scroll ───────────────────────────────────────────────────────────
 *
 * The page scrolls; the rail is sticky and rides along. No nested scroller,
 * because a reader should never have to work out which pane their wheel is
 * over. If the rail is taller than the viewport it scrolls with the page.
 */

import { clsx } from 'clsx'
import { ArrowLeft } from 'lucide-react'
import { TONE_PILL } from '../../lib/semantic-tone'
import type { RailCard } from '../../lib/dashboard/focus'

export function WorkDeck({
  backLabel, onBack, rail, activeId, onRotate, children,
}: {
  backLabel: string
  onBack: () => void
  rail: RailCard[]
  activeId: string | null
  onRotate: (card: RailCard) => void
  children: React.ReactNode
}) {
  // The expanded card is the workspace. Showing it again as a peer would
  // duplicate its identity, its issue and its metric three inches apart.
  const peers = rail.filter(c => c.id !== activeId)

  return (
    <div className="flex h-full min-h-0" data-testid="work-deck">
      {/*
        The rail keeps its column at every desktop width. It is core to the
        interaction, not decoration: hiding it below 2xl -- as the right-hand
        list did -- would remove the deck the reader is working out of, on the
        viewport most of them actually use. It narrows instead.
      */}
      <aside
        data-testid="work-rail"
        aria-label={`Other work in ${backLabel}`}
        className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-gray-200 bg-white/60 lg:block xl:w-[268px] 2xl:w-[300px] dark:border-white/10 dark:bg-white/[0.02]"
      >
        <div className="px-3 pb-6 pt-3">
          <button
            type="button"
            onClick={onBack}
            data-testid="workspace-back"
            className="mb-3 inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>

          {peers.length > 0 && (
            <div className="flex flex-col gap-2">
              {peers.map(c => <RailTile key={c.id} card={c} onOpen={() => onRotate(c)} />)}
            </div>
          )}
        </div>
      </aside>

      {/* Below lg the rail cannot hold a card, so the return control moves
          inline rather than disappearing with it. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid="work-surface">
        <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-2 lg:hidden dark:border-white/10 dark:bg-[#141a25]">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-blue-700 dark:text-blue-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * One card in the rail.
 *
 * Roughly: state, object, the figure that matters, one line of substance. Four
 * things, because a preview with six metadata rows is a table row wearing a
 * border. Colour follows the shared severity palette and nothing else -- never
 * direction, never buy versus sell.
 *
 * The heights differ only as much as the content does. Wildly uneven cards in
 * a 268px column read as disorder, not as hierarchy; importance is carried by
 * ORDER here, because the deck already ranked these.
 */
function RailTile({ card, onOpen }: { card: RailCard; onOpen: () => void }) {
  const tone = card.tone ?? 'neutral'
  return (
    <button
      type="button"
      data-testid="rail-card"
      data-tone={tone}
      onClick={onOpen}
      className={clsx(
        'flex w-full flex-col gap-1.5 overflow-hidden rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm',
        'transition-shadow hover:shadow-md',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        tone === 'critical'
          ? 'border-rose-300 dark:border-rose-900/60'
          : 'border-gray-200 hover:border-gray-300 dark:border-white/[0.08]',
      )}
    >
      <span className={clsx(
        'self-start rounded-full border px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-[0.06em]',
        TONE_PILL[tone],
      )}>
        {card.reason}
      </span>

      <span className="font-black text-[17px] leading-none tracking-[-0.03em]">
        {card.symbol ?? '—'}
      </span>

      {card.figure && (
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[20px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
            {card.figure}
          </span>
          {card.figureLabel && (
            <span className="min-w-0 text-[10px] leading-tight text-gray-500">{card.figureLabel}</span>
          )}
        </div>
      )}

      {card.detail && (
        <p className="line-clamp-2 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
          {card.detail}
        </p>
      )}
    </button>
  )
}
