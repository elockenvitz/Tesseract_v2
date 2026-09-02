/**
 * Today — one surfaced item.
 *
 * The approved grammar, in production: a tinted chrome band carrying identity
 * and state, the claim, a metric strip, the visual that explains why it
 * surfaced, why-now as a sentence, then one dominant primary action with
 * Ask AI and Discuss as quieter text affordances.
 *
 * Ask AI and Discuss go through the D1 seam, so the pane opens with the object
 * AND the triggering issue already bound. Discuss renders only when
 * `canDiscuss` says the object can actually hold a thread — never routed to AI.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, MoreHorizontal } from 'lucide-react'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import { supportsSharedDefer, SNOOZE_PRESETS } from '../../lib/attention-state'
import { TodayVisual } from './TodayVisual'

import type { TodayItem } from '../../lib/today'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'

/**
 * State colour by MEANING, not by engine severity alone.
 *
 * The real screenshot rendered four stale theses in red, which told the reader
 * that four routine reviews were four emergencies. Severity is the evaluator's
 * measure of how bad a finding is relative to others of its own kind -- a
 * 210-day thesis is "red" among theses -- and reading it as a global alarm
 * level is what flattened the surface.
 *
 * So the tone comes from what the finding IS. Red is reserved for capital
 * actually at risk; review and waiting are amber; informational is blue.
 *
 * The palette itself now lives in `lib/semantic-tone`, because Portfolio made
 * the same mistake independently while the vocabulary was still private to
 * this file. Which finding maps to which tone stays here -- that is Today's
 * knowledge, not the palette's.
 */
const TONE_BY_KEY: Record<string, SemanticTone> = {
  EXECUTION_NOT_CONFIRMED: 'critical',
  PROPOSAL_AWAITING_DECISION: 'review',
  THESIS_STALE: 'review',
  RATING_NO_FOLLOWUP: 'review',
  IDEA_NOT_SIMULATED: 'info',
  OVERDUE_DELIVERABLE: 'review',
  HIGH_EV_NO_IDEA: 'info',
}

export function toneFor(item: TodayItem): SemanticTone {
  const key = item.source.titleKey
  if (key && TONE_BY_KEY[key]) return TONE_BY_KEY[key]
  // Unmapped: fall back to severity, but only red truly means red.
  return item.severity === 'red' ? 'critical' : item.severity === 'blue' ? 'info' : 'neutral'
}

interface TodayTileProps {
  item: TodayItem
  rank: number
  featured?: boolean
  /**
   * Set when the page gives this tile half the field or more.
   *
   * Only the page knows how many columns a tile got, and the composition is
   * what decides whether a chart has 450px to live in or 900. Passing it is
   * what stops the tile from having to guess, or from measuring itself.
   */
  wide?: boolean
  onPrimary: (item: TodayItem) => void
  onDismiss: (item: TodayItem) => void
  onSnooze: (item: TodayItem, hours: number) => void
}

export function TodayTile({
  item, rank, featured, wide, onPrimary, onDismiss, onSnooze,
}: TodayTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sharedDefer = item.target ? supportsSharedDefer(item.target) : false

  /**
   * Whether this tile has a real explanatory graphic.
   *
   * Drives the featured layout, and only the layout: enrichment availability
   * must never influence WHICH item leads. #1 is the highest-priority object
   * whether or not its history happens to be cached; what adapts is how its
   * tile is composed, so a featured item with nothing to draw does not reserve
   * half its width for an empty column.
   */
  const hasVisual = item.visual.archetype !== 'metrics'
  /*
   * Two columns whenever the tile is wide enough for two, not only when it is
   * the lead.
   *
   * Splitting on `featured` alone was right while the lead was the only wide
   * tile on the page. Once the field gives a supporting tile six columns, a
   * single-column body stretches its chart across ~880px, and a sparkline that
   * wide flattens into a line: NVDA's +21.2% move became visually
   * indistinguishable from no move at all. The size of a drawing should follow
   * the measure it is drawn into, which is the rule the Ideas field already
   * uses for the same reason.
   */
  const split = !!(featured || wide) && hasVisual

  return (
    <article
      data-testid="today-tile"
      data-rank={rank}
      data-tier={item.tier}
      className={clsx(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm',
        'transition-shadow hover:shadow-md dark:bg-[#141a25]',
        toneFor(item) === 'critical'
          ? 'border-rose-200/80 dark:border-rose-900/40'
          : 'border-gray-200 dark:border-white/[0.08]',
      )}
    >
      {/* chrome band — tinted away from the body, as the mobile tile header is */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <span
          className={clsx(
            'rounded-full px-2 py-[3px] font-mono text-[10px] font-bold tracking-wider',
            rank === 1 && toneFor(item) === 'critical'
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
              : rank === 1
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'bg-gray-200/70 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400',
          )}
        >
          #{rank}
        </span>
        <span
          className={clsx(
            'rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider',
            TONE_PILL[toneFor(item)],
          )}
        >
          {item.state}
        </span>
        {/*
          The tier phrase is deliberately not on the tile.

          Every tile carried three layers of process labelling before a reader
          reached any investment content: a #rank pill, a STATE pill, and the
          tier phrase. On the real surface #3 and #4 both read "THESIS MAY BE
          STALE" and both read "framework gap" — two labels, four words, and
          nothing that tells apart the two tiles a reader most needs to tell
          apart. It is the engine's internal grouping, not a fact about the
          investment.

          Rank and state are the tile's own and stay. The tier still ranks the
          surface and is still reported under Also watching; it no longer
          spends a line of every card naming the evaluator's bucket.

          What takes the space is the book the object sits in, which is a fact
          about the position and the one piece of context a reader needs to
          know whether a finding is theirs.
        */}
        {item.source.context.portfolioName && (
          <span className="ml-auto truncate text-right text-[10px] leading-tight text-gray-500 dark:text-gray-500">
            {item.source.context.portfolioName}
          </span>
        )}
      </div>

      {/* identity — the object leads, at mobile's weight.
          Mobile sets its headline at 30px font-black with -0.035em tracking;
          a 15px semibold ticker was the single biggest reason this did not
          read as the same product. */}
      <div className="flex items-baseline gap-2.5 px-3.5 pt-2.5">
        <span
          className={clsx(
            'font-black leading-[1.05] tracking-[-0.035em]',
            featured ? 'text-[30px]' : 'text-[22px]',
          )}
        >
          {item.ticker ?? item.objectLabel}
        </span>
        {item.ticker && item.objectLabel !== item.ticker && (
          <span className="min-w-0 truncate text-[12px] font-medium text-gray-500 dark:text-gray-400">
            {item.objectLabel}
          </span>
        )}
      </div>

      {/* body */}
      <div
        className={clsx(
          'flex-1 px-3.5 pt-1.5',
          split
            ? 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]'
            : 'flex flex-col gap-2',
        )}
      >
        <div className={clsx('flex min-w-0 flex-col', split ? 'gap-2.5' : 'gap-2')}>
          <p
            className={clsx(
              'leading-snug text-gray-600 dark:text-gray-400',
              featured ? 'text-[13px]' : 'text-[12px]',
            )}
          >
            {item.claim}
          </p>

          {item.metrics.length > 0 && (
            /* A strip of one or two values stops at a readable measure rather
               than stretching to whatever width the tile happens to have --
               BABA's single "324d since review" was filling a 900px box. */
            <div className={clsx(
              'flex overflow-hidden rounded-lg bg-gray-100/80 dark:bg-white/[0.05]',
              !split && item.metrics.length <= 2 && 'lg:max-w-[520px]',
            )}>
              {item.metrics.map((m, i) => (
                <div
                  key={m.label}
                  className={clsx(
                    'min-w-0 flex-1 px-2.5 py-1',
                    i > 0 && 'border-l border-gray-200 dark:border-white/[0.07]',
                  )}
                >
                  <span
                    className={clsx(
                      'block truncate font-mono text-[14px] font-semibold leading-tight tabular-nums',
                      m.tone === 'down' && 'text-rose-600 dark:text-rose-400',
                      m.tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
                      m.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {m.value}
                  </span>
                  <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasVisual && (
          <div className="min-w-0">
            <TodayVisual visual={item.visual} compact={!featured} />
          </div>
        )}
      </div>

      {/* action row — one dominant verb, two quiet affordances */}
      <div className="mt-2 px-3.5">
        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-500">
          Next
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-1">
        {item.primary ? (
          <button
            type="button"
            onClick={() => onPrimary(item)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 font-semibold text-white',
              'hover:bg-blue-800 hover:border-blue-800',
              featured ? 'px-4 py-2.5 text-[13px]' : 'px-3.5 py-2 text-[12px]',
            )}
          >
            {item.primary.label}
            <ArrowRight className="h-3.5 w-3.5 opacity-70" />
          </button>
        ) : (
          <span className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[11px] text-gray-500 dark:border-white/15 dark:text-gray-500">
            No structured action yet
          </span>
        )}

        {item.target && (
          <button
            type="button"
            onClick={() => askAI(item.target!)}
            className="rounded-md px-2.5 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
          </button>
        )}

        {/*
          Discuss, on the same seam as Ask AI.

          It was withheld here on the reasoning that scattering Discuss
          affordances before the communication-pane review would lock that
          answer in by accident. That reasoning has been overtaken: the Ideas
          field carries Respond / Ask AI / Discuss, so the question of where
          contextual team discussion lives is already answered in the product,
          and Today withholding it is now the inconsistency rather than the
          caution. A finding could be raised with the team only by opening it
          first.

          No new architecture: `discuss()` raises an EngagementRequest with the
          object and its triggering issue already bound, and the existing
          CommunicationPane answers it. `canDiscuss` gates it, so an object the
          seam says cannot hold a thread shows no button rather than one that
          would fail.
        */}
        {item.target && canDiscuss(item.target) && (
          <button
            type="button"
            data-testid="today-discuss"
            onClick={() => discuss(item.target!)}
            className="rounded-md px-2.5 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            Discuss
          </button>
        )}

        <div className="relative ml-auto">
          <button
            type="button"
            aria-label="More actions"
            onClick={() => setMenuOpen(o => !o)}
            className="grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg dark:border-white/15 dark:bg-[#171e2b]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuGroup label="Personal — only affects your view" />
              <MenuItem
                label="Dismiss for me"
                hint="Hidden for you on every device. Changes no shared state."
                onClick={() => { onDismiss(item); setMenuOpen(false) }}
              />
              {SNOOZE_PRESETS.map(p => (
                <MenuItem
                  key={p.hours}
                  label={`Snooze ${p.label}`}
                  hint="Comes back on its own when the snooze expires."
                  onClick={() => { onSnooze(item, p.hours); setMenuOpen(false) }}
                />
              ))}

              <MenuGroup label="Shared — changes the workflow for everyone" />
              {/*
                No shared action is offered from Today yet, and none is rendered.

                A control that looks like a shared mutation and performs none is
                worse than no control: the user believes their team's revisit
                date moved. So the two cases are stated rather than drawn.

                The object-type case is permanent-ish: an asset simply has no
                revisit date. The trade-queue case is Today's own gap — the
                mutation exists (`deferTradeIdeaMutation`), but the id Today
                carries is not unambiguously a `trade_queue_items.id`: pair
                trades surface under a synthetic `pair-<id>`, and a proposal
                expanded across portfolios surfaces once per portfolio while
                sharing one underlying row. Deferring from either would either
                miss, or move the date for every portfolio's copy. Resolving
                that is a workflow question, not a UI one.
              */}
              <div className="px-3 pb-2.5 pt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-500">
                {sharedDefer
                  ? 'This item has a shared revisit date, but Today cannot move it yet — defer it from the trade queue, where the row it belongs to is unambiguous.'
                  : 'This object has no shared revisit date to move, so there is no shared Defer for it. Snooze is the personal equivalent.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function MenuGroup({ label }: { label: string }) {
  return (
    <div className="border-t border-gray-200 px-3 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-widest text-gray-500 first:border-t-0 dark:border-white/10 dark:text-gray-500">
      {label}
    </div>
  )
}

function MenuItem({
  label, hint, onClick, shared,
}: { label: string; hint: string; onClick: () => void; shared?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30"
    >
      <span className="block text-[12px] text-gray-900 dark:text-gray-100">{label}</span>
      <span className={clsx('mt-0.5 block text-[10px]', shared ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500')}>
        {hint}
      </span>
    </button>
  )
}
