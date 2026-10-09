/**
 * What is happening in this universe, before the reader starts scanning rows.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * The header's only summary was the status progress strip, which on a list
 * where nobody uses list statuses rendered exactly one chip: "7 No status".
 * That is a fact about an unused feature, occupying the one place a reader
 * looks first.
 *
 * This says what the universe is doing instead — a count, then the work that
 * needs a person, in the same priority the Work column uses. Every number is
 * folded from signals already in memory for the rows; nothing here reads.
 *
 * It is a sentence, not a dashboard: one line of text, no cards, no tiles, and
 * a segment disappears entirely when its count is zero.
 */
import { clsx } from 'clsx'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'

export type ListLens = 'all' | 'attention'

export interface ListPulse {
  total: number
  /** Ideas at the final stage — somebody owes an answer. */
  decisions: number
  /** Live ideas short of a decision. */
  active: number
  /** Names carrying research the written case has not answered. */
  newResearch: number
  /** Names past the review clock, or whose price moved away from the case. */
  reviewDue: number
  /** Names with no case, or not enough of one, to review against. */
  gaps: number
  /** Everything a lens of "needs attention" should keep. */
  needsAttention: number
}

export function pulseFrom(signals: ListRowSignal[]): ListPulse {
  let decisions = 0, active = 0, newResearch = 0, reviewDue = 0, gaps = 0
  for (const s of signals) {
    switch (s.work.tier) {
      case 'decision': decisions += 1; break
      case 'idea': active += 1; break
      case 'evidence': newResearch += 1; break
      case 'review': reviewDue += 1; break
      case 'gap': gaps += 1; break
      default: break
    }
  }
  return {
    total: signals.length,
    decisions, active, newResearch, reviewDue, gaps,
    // A gap is a coverage hole rather than something that changed, so it is
    // counted but does not pull a name into the attention lens — the same line
    // the Lists home fold draws.
    needsAttention: decisions + active + newResearch + reviewDue,
  }
}

/** Does this row survive the lens? */
export function matchesLens(signal: ListRowSignal, lens: ListLens): boolean {
  if (lens === 'all') return true
  return signal.work.tier !== 'clear' && signal.work.tier !== 'gap'
}

export function ListPulseStrip({
  pulse, lens, onLensChange,
}: {
  pulse: ListPulse
  lens: ListLens
  onLensChange?: (lens: ListLens) => void
}) {
  if (pulse.total === 0) return null

  const parts: Array<{ key: string; label: string; strong?: boolean }> = []
  if (pulse.decisions > 0) {
    parts.push({ key: 'dec', label: `${pulse.decisions} awaiting decision`, strong: true })
  }
  if (pulse.newResearch > 0) {
    parts.push({ key: 'new', label: `${pulse.newResearch} new research`, strong: true })
  }
  if (pulse.reviewDue > 0) parts.push({ key: 'rev', label: `${pulse.reviewDue} review due` })
  if (pulse.active > 0) parts.push({ key: 'act', label: `${pulse.active} active` })
  if (pulse.gaps > 0) parts.push({ key: 'gap', label: `${pulse.gaps} no case` })

  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0">
      <span className="text-[12px] tabular-nums text-gray-700 dark:text-gray-200 font-medium flex-shrink-0">
        {pulse.total} {pulse.total === 1 ? 'security' : 'securities'}
      </span>

      {parts.length > 0 && (
        <span className="flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0 text-[12px]">
          {parts.map(part => (
            <span key={part.key} className="inline-flex items-center gap-1.5 flex-shrink-0">
              <span className="text-gray-300 dark:text-gray-700" aria-hidden>·</span>
              <span className={clsx(
                'tabular-nums',
                part.strong
                  ? 'font-semibold text-gray-900 dark:text-gray-50'
                  : 'text-gray-500 dark:text-gray-400',
              )}>
                {part.label}
              </span>
            </span>
          ))}
        </span>
      )}

      {/*
        * The lens, offered only when it would do something.
        *
        * On a universe where nothing needs attention, a "Needs attention" tab
        * that yields an empty table is a worse answer than no tab.
        */}
      {onLensChange && pulse.needsAttention > 0 && (
        <span className="inline-flex items-center gap-0.5 ml-auto flex-shrink-0" role="tablist">
          {([
            ['all', 'All'],
            ['attention', 'Needs attention'],
          ] as Array<[ListLens, string]>).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={lens === value}
              onClick={() => onLensChange(value)}
              className={clsx(
                'px-2 py-0.5 rounded text-[11.5px] font-medium transition-colors',
                lens === value
                  ? 'text-gray-900 dark:text-gray-50 bg-gray-900/[0.07] dark:bg-gray-100/10'
                  : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200',
              )}
            >
              {label}
              {value === 'attention' && (
                <span className="ml-1 tabular-nums text-gray-400 dark:text-gray-500">
                  {pulse.needsAttention}
                </span>
              )}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
