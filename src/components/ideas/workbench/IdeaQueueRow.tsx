import { clsx } from 'clsx'
import { AlertTriangle, User } from 'lucide-react'

import type { WorkbenchIdea } from '../../../lib/ideas/workbench'

/**
 * One idea in the left-hand queue.
 *
 * ── The height this is aiming at, and why ─────────────────────────────────
 *
 * Two rejected extremes bracket it. The card view put three ideas above the
 * fold at 194px each — a reading surface, when the reader is scanning. The
 * cockpit put fourteen at 52px — a notification list, where the only thing a
 * row could carry was a headline and a chip, so every question except "what
 * happened" had to be answered somewhere else.
 *
 * This sits at roughly 100px: enough for a ticker, a stance, the claim, the
 * numbers and one line of why-now, which is the set the brief asks the first
 * glance to answer. Seven or eight fit a normal desk screen.
 *
 * ── Why the numbers are guarded rather than laid out in a grid ────────────
 *
 * A trade-idea row carries an action, a rationale, an author and a current
 * price. It does not carry a target, a conviction rating or a catalyst — those
 * live on other objects and reach an idea only when a lens or a card about the
 * same name is attached as evidence. A fixed grid would print five empty
 * labelled slots on the common case. Everything here renders only if the idea
 * actually has it.
 */

const STANCE: Record<WorkbenchIdea['stance'], { label: string; className: string }> = {
  buy: { label: 'BUY', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  sell: { label: 'SELL', className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  watch: { label: 'WATCH', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
}

const money = (v: number | null) =>
  v == null || !Number.isFinite(v) ? null : `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`

interface IdeaQueueRowProps {
  idea: WorkbenchIdea
  selected: boolean
  onSelect: (id: string) => void
  /** A small price path, injected — this component never fetches. */
  sparkline?: React.ReactNode
}

export function IdeaQueueRow({ idea, selected, onSelect, sparkline }: IdeaQueueRowProps) {
  const stance = STANCE[idea.stance]
  const price = money(idea.currentPrice)

  return (
    <button
      type="button"
      data-workbench-row={idea.id}
      data-selected={selected || undefined}
      data-tier={idea.tier}
      onClick={() => onSelect(idea.id)}
      className={clsx(
        'relative block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors dark:border-gray-800',
        selected
          ? 'bg-primary-50/70 dark:bg-primary-900/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
      )}
    >
      {/* Selection is a rule on the leading edge, not a fill — a filled row in
          a ranked list reads as a state change to the row rather than to the
          reader's position in it. */}
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary-600" />}

      {/* ── Line 1: who, what stance, how old ───────────────────────────── */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[14px] font-bold tracking-tight text-gray-900 dark:text-white">
          {idea.symbol ?? '—'}
        </span>
        <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide', stance.className)}>
          {stance.label}
        </span>
        {idea.companyName && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400">{idea.companyName}</span>
        )}
        {price && (
          <span className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">
            {price}
          </span>
        )}
      </div>

      {/* ── Line 2: the claim ───────────────────────────────────────────── */}
      <p className={clsx(
        'mt-1 line-clamp-2 text-[13px] leading-[1.4]',
        idea.thesis ? 'text-gray-700 dark:text-gray-200' : 'italic text-gray-400',
      )}>
        {idea.thesis ?? 'No thesis recorded on this name yet.'}
      </p>

      {/* ── Line 3: why now, and the price path ─────────────────────────── */}
      <div className="mt-1.5 flex min-w-0 items-end gap-3">
        <div className="min-w-0 flex-1">
          {idea.whyNow && (
            <p
              data-workbench-why
              className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{idea.whyNow}</span>
            </p>
          )}
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-gray-400">
            {idea.author && (
              <span className="flex shrink-0 items-center gap-1"><User className="h-3 w-3" />{idea.author}</span>
            )}
            {idea.portfolioName && <span className="truncate">{idea.portfolioName}</span>}
            {idea.evidence.length > 1 && (
              <span className="shrink-0 font-semibold text-gray-500">
                +{idea.evidence.length - 1} more
              </span>
            )}
          </div>
        </div>
        {/* The line only where the caller had one to give. */}
        {sparkline && <span className="h-8 w-24 shrink-0">{sparkline}</span>}
      </div>
    </button>
  )
}
