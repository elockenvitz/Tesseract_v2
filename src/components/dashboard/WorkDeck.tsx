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
import { railAround, type FocusIntent, type RailCard } from '../../lib/dashboard/focus'

/** What each sub-object is called where a reader can see it. */
const INTENT_LABEL: Record<FocusIntent, string> = {
  overview: 'Overview',
  claim: 'The claim',
  framework: 'Framework',
  price: 'Price history',
  book: 'Position',
}

export function WorkDeck({
  backLabel, onBack, rail, activeId, onRotate, intent, children,
}: {
  backLabel: string
  onBack: () => void
  rail: RailCard[]
  activeId: string | null
  onRotate: (card: RailCard) => void
  /** Which part of the object the reader reached for, when they named one. */
  intent?: FocusIntent
  children: React.ReactNode
}) {
  /**
   * The card that is currently expanded.
   *
   * Found in the population the deck was handed, by id — not by symbol, which
   * is not identity: two findings can concern one ticker and would collapse to
   * the same card. No lookup cost and no query: this is the same object the
   * rail was built from.
   */
  const active = rail.find(c => c.id === activeId) ?? null
  /**
   * The neighbourhood around whatever is expanded right now.
   *
   * Derived from the WHOLE population on every render, not from a window
   * pruned once when the deck opened. That is what makes the card you just
   * left re-enter the rail: open JNJ, rotate to AAPL, and JNJ is available
   * again -- while AAPL, now the workspace, drops out. Showing the expanded
   * card as a peer would duplicate its identity, issue and metric three
   * inches apart.
   */
  const peers = railAround(rail, activeId)

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
            className="mb-3 inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
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
        {active && <FocusHeader card={active} intent={intent} />}
        {children}
      </div>
    </div>
  )
}

/**
 * What the reader selected, at the top of the surface answering it.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * Clicking TSM on the Dashboard mounted a research workspace whose header
 * knows about an ASSET. The finding — that capital was committed four days ago
 * and the fill was never confirmed — did not survive the click, and neither
 * did the object's own name until whatever the workspace loads arrives. The
 * measured result was a work surface that said nothing at all about the thing
 * just chosen, next to a rail listing the three things that were not.
 *
 * ── Not a second tile ────────────────────────────────────────────────────
 *
 * One line of identity and one line of substance, on the surface's own ground
 * with no card, no border and no actions. The Dashboard tile is not
 * reproduced here: repeating its metric strip and its buttons three inches
 * from the workspace's own would be two tiles arguing about which is the
 * subject. This says which object, in which book, why it surfaced, and what
 * was claimed — then gets out of the way.
 *
 * Everything comes from the rail card the deck was already handed, so this
 * costs no query and cannot disagree with what the Dashboard said.
 */
function FocusHeader({ card, intent }: { card: RailCard; intent?: FocusIntent }) {
  const tone = card.tone ?? 'neutral'
  return (
    <header
      data-testid="focus-header"
      data-symbol={card.symbol ?? undefined}
      className="shrink-0 border-b border-gray-200 bg-white px-6 pb-2.5 pt-3 dark:border-white/10 dark:bg-[#141a25]"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-black text-[22px] leading-none tracking-[-0.035em]">
          {card.symbol ?? '—'}
        </span>
        <span className={clsx(
          'text-[9px] font-bold uppercase tracking-widest',
          LABEL[tone],
        )}>
          {card.reason}
        </span>
        {/*
          What the reader reached for, when they reached for a part.
          
          A click on the card's own ground is a question about the object and
          says nothing extra here. Reaching for the claim, the framework or the
          price is a narrower request, and the surface acknowledges it rather
          than opening at the top as though the reader had not chosen.
        */}
        {intent && intent !== 'overview' && (
          <span
            data-testid="focus-intent"
            data-intent={intent}
            /*
              Names the part, without announcing it as a mode.
              
              This was a filled blue chip, which is a badge saying PERFORMANCE
              MODE next to a section that is already accented for exactly that
              reason -- the interface stating twice what it can simply do once.
              The word stays, because a reader arriving sideways should be able
              to see which question they asked; the fill goes.
            */
            className="border-l border-gray-300 pl-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700 dark:border-white/15 dark:text-blue-300"
          >
            {INTENT_LABEL[intent]}
          </span>
        )}
        {card.portfolioName && (
          <span className="ml-auto truncate text-[11px] text-gray-500 dark:text-gray-500">
            {card.portfolioName}
          </span>
        )}
      </div>
      {card.detail && (
        <p className="mt-1 max-w-[130ch] truncate text-[12px] text-gray-600 dark:text-gray-400">
          {card.detail}
        </p>
      )}
    </header>
  )
}

/**
 * One card in the rail.
 *
 * ── A work preview, not an alert ─────────────────────────────────────────
 *
 * The first version outlined every review-state card in rose, which turned a
 * column of ordinary unfinished work into a wall of warnings and made the one
 * genuine capital break indistinguishable from the rest. Condition now reads
 * through a narrow left accent and the state chip; the card keeps a neutral
 * border, and only a true framework break -- spot outside the case the desk
 * itself wrote -- earns the louder treatment.
 *
 * ── Four things ──────────────────────────────────────────────────────────
 *
 * State, object, the figure that matters (plus a second where one genuinely
 * adds), and one line of substance. Anything more is a table row wearing a
 * border. Colour follows the shared severity palette and nothing else: never
 * direction, never buy versus sell, never price sign.
 *
 * Heights vary only as much as the content does. Importance is carried by
 * ORDER here, because the deck already ranked these -- uneven cards in a 268px
 * column read as disorder, not hierarchy.
 */
function RailTile({ card, onOpen }: { card: RailCard; onOpen: () => void }) {
  const tone = card.tone ?? 'neutral'
  const critical = tone === 'critical'

  return (
    <button
      type="button"
      data-testid="rail-card"
      data-tone={tone}
      data-symbol={card.symbol ?? undefined}
      onClick={onOpen}
      className={clsx(
        'group relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border bg-white py-2.5 pl-4 pr-3 text-left',
        'transition-[box-shadow,border-color,transform] duration-150',
        'hover:-translate-y-px hover:border-gray-300 hover:shadow-md',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        critical
          ? 'border-rose-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-rose-900/50'
          : 'border-gray-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/[0.07]',
        'dark:bg-[#151b26] dark:hover:border-white/20',
      )}
    >
      {/* Condition as a 3px edge, not an outline around the whole card. */}
      <span aria-hidden className={clsx('absolute inset-y-0 left-0 w-[3px]', ACCENT[tone])} />

      <div className="flex items-baseline gap-2">
        <span className="font-black text-[16px] leading-none tracking-[-0.03em]">
          {card.symbol ?? '\u2014'}
        </span>
        <span className={clsx(
          'ml-auto shrink-0 text-[9px] font-bold uppercase tracking-widest',
          LABEL[tone],
        )}>
          {card.reason}
        </span>
      </div>

      {(card.figure || card.secondary) && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {card.figure && (
            <span className="flex items-baseline gap-1">
              <span className="font-mono text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                {card.figure}
              </span>
              {card.figureLabel && (
                <span className="text-[10px] uppercase tracking-wider text-gray-400">
                  {card.figureLabel}
                </span>
              )}
            </span>
          )}
          {card.secondary && (
            <span className="flex items-baseline gap-1">
              <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {card.secondary.value}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-gray-400">
                {card.secondary.label}
              </span>
            </span>
          )}
        </div>
      )}

      {card.detail && (
        <p className="line-clamp-2 text-[11px] leading-[1.4] text-gray-600 group-hover:text-gray-800 dark:text-gray-400 dark:group-hover:text-gray-200">
          {card.detail}
        </p>
      )}

      {card.spark && <RailSpark spark={card.spark} />}
    </button>
  )
}

/**
 * The neighbour's own price path, so the rail can be scanned rather than read.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * The rail is where a reader picks what to look at next, and it was doing
 * that with a ticker, a percentage and two lines of clamped prose. Ten of
 * those are ten paragraphs: nothing separates them at a glance, so comparing
 * the neighbours of the thing you are reading means reading all of them.
 *
 * ── And what it deliberately is not ──────────────────────────────────────
 *
 * No axis, no scale, no scrub, no readout. This is the one place in the
 * product where "sparkline" is the right answer rather than the complaint:
 * it is 22px tall in a list of ten, it is there to be compared with its
 * neighbours rather than interrogated, and the object it belongs to is one
 * click away in full. The direction it carries is the same fact, measured
 * from the same mark, that the field behind the deck draws at full size.
 */
function RailSpark({ spark }: { spark: NonNullable<RailCard['spark']> }) {
  const { closes, changePct } = spark
  if (closes.length < 2) return null
  const up = changePct >= 0

  // Down to about a point per pixel of the tile's width. A rail tile is
  // ~200px and a two-year daily series is 500 points; drawing all of them
  // spends the work to produce a solid smear.
  const step = Math.max(1, Math.ceil(closes.length / 60))
  const pts = closes.filter((_, i) => i % step === 0 || i === closes.length - 1)
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const span = hi - lo || 1
  const d = pts
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 100).toFixed(2)},${(20 - ((v - lo) / span) * 20).toFixed(2)}`)
    .join(' ')

  return (
    <div className={clsx(
      'flex items-center gap-2',
      up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-500',
    )}>
      <svg
        viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden
        className="h-[22px] flex-1"
      >
        <path
          d={d} fill="none" stroke="currentColor" strokeWidth="1.75"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
        />
      </svg>
      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums">
        {up ? '+' : ''}{changePct.toFixed(1)}%
      </span>
    </div>
  )
}

/** Condition, as an edge. The only place a rail card carries colour. */
const ACCENT: Record<string, string> = {
  critical: 'bg-rose-500',
  review: 'bg-amber-400',
  info: 'bg-blue-400',
  neutral: 'bg-gray-200 dark:bg-white/15',
}

const LABEL: Record<string, string> = {
  critical: 'text-rose-700 dark:text-rose-400',
  review: 'text-amber-700 dark:text-amber-500',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-gray-400',
}
