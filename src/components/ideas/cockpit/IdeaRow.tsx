/**
 * One decision, one row.
 *
 * ── What this replaces, and why a row rather than a card ──────────────────
 *
 * The desktop feed rendered five different card designs — chart post, compact
 * thought, trade idea, rich content, grouped thesis — several with a 140px
 * embedded chart, in a 1060px column centred on a 1440px screen. Measured from
 * the source, the average card runs about 280px tall, so a PM opening Ideas met
 * between two and three items above the fold and scrolled for the rest. That is
 * a reading surface. A desk needs a scanning surface.
 *
 * A row is the format that answers "what needs my attention" in one pass: the
 * eye runs down a fixed left rail of tickers and a fixed right rail of actions,
 * and only the middle varies. Cards cannot do that, because every card is a
 * different shape and the eye has to re-find the ticker each time.
 *
 * ── What earns a place on the row ─────────────────────────────────────────
 *
 * Five things, and the discipline is in what is absent: no score, no chart, no
 * reaction counts, no author avatar, no body paragraph. Everything here is
 * something a reader decides on.
 *
 *   ticker + type    what this is about
 *   headline         what changed, in one line
 *   why this         the reason it is in front of them — see `why-this`
 *   age              how fresh, as a glance not a timestamp
 *   actions          what they can do without opening it
 *
 * ── Gallery-pure by construction ──────────────────────────────────────────
 *
 * Props only: no hooks, no queries, no Supabase anywhere in the import graph.
 * That is what lets the layout be screenshotted and asserted at real viewport
 * sizes without an authenticated workspace — the same rule `guard:gallery`
 * enforces for the mobile cards, and the reason those have layout tests at all.
 */

import { clsx } from 'clsx'
import type { RankReason } from '../../../lib/signals/feed-priority'
import { whyThis, type WhyLabel } from './why-this'

export interface IdeaRowModel {
  id: string
  /** Ticker where there is one; rows without an asset are legitimate. */
  symbol: string | null
  /** User-facing content type: "Trade idea", "Note", "Thesis update"… */
  kindLabel: string
  /** One line. What changed — not the body of the post. */
  headline: string
  /** Compact age: "2h", "3d", "6w". Never a full timestamp on the row. */
  age: string
  reasons: readonly RankReason[]
  /** Canonical tier. Drives emphasis, never section membership. */
  tier: number
  /** True when somebody is waiting on an answer. */
  actionable?: boolean
}

export interface IdeaRowProps {
  model: IdeaRowModel
  onOpen?: (id: string) => void
  onSnooze?: (id: string) => void
  onDismiss?: (id: string) => void
  selected?: boolean
}

/**
 * Reason chips, restrained on purpose.
 *
 * One primary, at most one secondary. The tones are the only colour on the row
 * apart from urgency, so that colour still means something when it appears —
 * a surface where everything is emphasised has no emphasis.
 */
function ReasonChip({ label, subtle }: { label: WhyLabel; subtle?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-[1px] text-[10.5px] font-medium leading-[15px]',
        subtle
          ? 'text-gray-500 dark:text-gray-400'
          : label.tone === 'scope'
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
            : label.tone === 'urgent'
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
              : label.tone === 'action'
                ? 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300'
                : 'text-gray-500 dark:text-gray-400',
      )}
      title={label.detail}
    >
      {label.label}
    </span>
  )
}

export function IdeaRow({ model, onOpen, onSnooze, onDismiss, selected }: IdeaRowProps) {
  const why = whyThis(model.reasons)
  // Tier 0–1 are the two that describe a position: the price has left the
  // framework, or the framework is missing. Everything else is a look or a
  // story, and the rail is how that reads at a glance rather than as a label.
  const lead = model.tier <= 1

  return (
    <div
      data-testid="idea-row"
      data-tier={model.tier}
      onClick={() => onOpen?.(model.id)}
      className={clsx(
        'group relative grid cursor-pointer items-center gap-x-3 border-b px-3 py-2',
        'grid-cols-[86px_minmax(0,1fr)_auto] border-gray-100 dark:border-gray-800',
        selected
          ? 'bg-primary-50/60 dark:bg-primary-500/10'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
      )}
    >
      {/* The urgency rail. Absent, not grey, when there is nothing to say. */}
      {lead && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-amber-500 dark:bg-amber-400"
        />
      )}

      {/* Left rail: the thing the eye scans down. Fixed width so it lines up. */}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold tracking-tight text-gray-900 tabular-nums dark:text-white">
          {model.symbol ?? '—'}
        </div>
        <div className="truncate text-[10.5px] text-gray-400 dark:text-gray-500">
          {model.kindLabel}
        </div>
      </div>

      {/* Middle: what changed, then why it is here. */}
      <div className="min-w-0">
        <div className="truncate text-[13px] leading-tight text-gray-900 dark:text-gray-100">
          {model.headline}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <ReasonChip label={why.primary} />
          {why.secondary && <ReasonChip label={why.secondary} subtle />}
          {/* The readthrough sentence, where one exists. It names a different
              asset than the row, so it cannot live in the chip alone. */}
          {why.primary.detail && (
            <span className="truncate text-[10.5px] text-gray-400 dark:text-gray-500">
              {why.primary.detail}
            </span>
          )}
        </div>
      </div>

      {/* Right rail: age, then actions in the same place on every row. */}
      <div className="flex items-center gap-1 justify-self-end">
        <span className="w-8 text-right text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
          {model.age}
        </span>
        {/**
          * Actions are visible on hover rather than buried in a menu.
          *
          * Snooze and Dismiss are the two things a reader does most and neither
          * is destructive — both are recorded as judgments with their own quiet
          * windows, and both come back. Putting them behind a three-dot menu is
          * what made them a no-op on mobile for months.
          *
          * They keep their slot when hidden, so rows do not reflow on hover.
          */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <RowAction label="Snooze" testid="row-snooze" onClick={() => onSnooze?.(model.id)} disabled={!onSnooze} />
          <RowAction label="Dismiss" testid="row-dismiss" onClick={() => onDismiss?.(model.id)} disabled={!onDismiss} />
        </div>
      </div>
    </div>
  )
}

function RowAction({
  label, testid, onClick, disabled,
}: { label: string; testid: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={clsx(
        'rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
        disabled
          ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
          : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
      )}
    >
      {label}
    </button>
  )
}
