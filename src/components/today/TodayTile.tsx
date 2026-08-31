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
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { supportsSharedDefer, SNOOZE_PRESETS } from '../../lib/attention-state'
import { TodayVisual } from './TodayVisual'
import type { TodayItem } from '../../lib/today'

const SEVERITY_PILL: Record<string, string> = {
  red: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-900/50',
  orange: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/50',
  yellow: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/50',
  blue: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900/50',
  gray: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-gray-400 dark:bg-white/[0.06] dark:border-white/10',
}

interface TodayTileProps {
  item: TodayItem
  rank: number
  featured?: boolean
  onPrimary: (item: TodayItem) => void
  onDismiss: (item: TodayItem) => void
  onSnooze: (item: TodayItem, hours: number) => void
}

export function TodayTile({
  item, rank, featured, onPrimary, onDismiss, onSnooze,
}: TodayTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const discussable = !!item.target && canDiscuss(item.target)
  const sharedDefer = item.target ? supportsSharedDefer(item.target) : false

  return (
    <article
      data-testid="today-tile"
      data-rank={rank}
      data-tier={item.tier}
      className={clsx(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm',
        'transition-shadow hover:shadow-md dark:bg-[#141a25]',
        item.severity === 'red'
          ? 'border-rose-200/80 dark:border-rose-900/40'
          : 'border-gray-200 dark:border-white/[0.08]',
      )}
    >
      {/* chrome band — identity and state, tinted away from the body */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <span
          className={clsx(
            'rounded-full border px-2 py-[2px] font-mono text-[10px] font-bold',
            rank === 1
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300'
              : 'border-gray-200 bg-gray-100 text-gray-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-400',
          )}
        >
          #{rank}
        </span>
        {item.ticker && (
          <span className="font-mono text-[15px] font-semibold tracking-tight">{item.ticker}</span>
        )}
        <span
          className={clsx(
            'rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.05em]',
            SEVERITY_PILL[item.severity] ?? SEVERITY_PILL.gray,
          )}
        >
          {item.state}
        </span>
        <span className="ml-auto text-right text-[10px] leading-tight text-gray-500 dark:text-gray-500">
          Tier {item.tier}
        </span>
      </div>

      {/* body */}
      <div
        className={clsx(
          'flex-1 px-3.5 pt-3',
          featured ? 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]' : 'flex flex-col gap-2.5',
        )}
      >
        <div className="flex min-w-0 flex-col gap-2.5">
          <p className={clsx('font-medium leading-snug text-gray-900 dark:text-gray-100', featured ? 'text-[15px]' : 'text-[13px]')}>
            {item.claim}
          </p>

          {item.metrics.length > 0 && (
            <div className="flex overflow-hidden rounded-lg bg-gray-100/80 dark:bg-white/[0.05]">
              {item.metrics.map((m, i) => (
                <div
                  key={m.label}
                  className={clsx(
                    'min-w-0 flex-1 px-2.5 py-1.5',
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
                  <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500 dark:text-gray-500">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* why now — a sentence, not a restatement of the metrics */}
          <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            {item.whyNow}
          </p>
        </div>

        <div className="min-w-0">
          <TodayVisual visual={item.visual} compact={!featured} />
        </div>
      </div>

      {/* action row — one dominant verb, two quiet affordances */}
      <div className="mt-3 px-3.5">
        <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-gray-500 dark:text-gray-500">
          Next
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-3 pt-1.5">
        {item.primary ? (
          <button
            type="button"
            onClick={() => onPrimary(item)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 font-semibold text-white',
              'hover:bg-blue-800 hover:border-blue-800',
              featured ? 'px-4 py-2.5 text-[13.5px]' : 'px-3.5 py-2 text-[12.5px]',
            )}
          >
            {item.primary.label}
            <ArrowRight className="h-3.5 w-3.5 opacity-70" />
          </button>
        ) : (
          <span className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[11.5px] text-gray-500 dark:border-white/15 dark:text-gray-500">
            No structured action yet
          </span>
        )}

        {item.target && (
          <button
            type="button"
            onClick={() => askAI(item.target!)}
            className="inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
            <span className="font-mono text-[10.5px] opacity-75">
              {item.target.contextChips?.length ?? 0}
            </span>
          </button>
        )}

        {discussable && (
          <>
            <span className="text-[11px] text-gray-300 dark:text-gray-700">·</span>
            <button
              type="button"
              onClick={() => discuss(item.target!)}
              className="rounded-md px-2.5 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Discuss
            </button>
          </>
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
              {sharedDefer ? (
                <MenuItem
                  label="Defer the item"
                  hint="Moves the shared revisit date. Your team sees this."
                  shared
                  onClick={() => setMenuOpen(false)}
                />
              ) : (
                <div className="px-3 pb-2.5 pt-1 text-[10.5px] leading-snug text-gray-500 dark:text-gray-500">
                  This object has no shared revisit date to move, so there is no
                  shared Defer for it. Snooze is the personal equivalent.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function MenuGroup({ label }: { label: string }) {
  return (
    <div className="border-t border-gray-200 px-3 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500 first:border-t-0 dark:border-white/10 dark:text-gray-500">
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
      <span className="block text-[12.5px] text-gray-900 dark:text-gray-100">{label}</span>
      <span className={clsx('mt-0.5 block text-[10.5px]', shared ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500')}>
        {hint}
      </span>
    </button>
  )
}
