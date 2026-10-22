/**
 * The work-item navigator.
 *
 * ── What it is for ──────────────────────────────────────────────────────
 *
 * Orientation, and only orientation. Each row names one piece of work and
 * states ONE fact about it; everything else belongs to the surface the row
 * selects. The moment a row starts carrying progress bars and counts it has
 * become the summary panel this replaced — 286px of a 661px viewport spent
 * describing work rather than doing it.
 *
 * ── Why rows and not tabs ───────────────────────────────────────────────
 *
 * The rows are the reader's actual work: this earnings review, this BUY
 * awaiting a decision. A navigator listing "Process / Ideas / Lists /
 * CoAnalyst" would be the old vertical stack turned on its side, and would
 * also be a second mode bar competing with the page's own.
 */
import { clsx } from 'clsx'
import { AlertTriangle, GitBranch, Lightbulb, MessageSquare, ExternalLink } from 'lucide-react'
import {
  GROUP_LABEL, GROUP_ORDER, itemsInGroup,
  type WorkItem, type WorkItemKind,
} from '../../../lib/asset-work/work-items'

const KIND_ICON: Record<WorkItemKind, typeof GitBranch> = {
  process: GitBranch,
  idea: Lightbulb,
  conversation: MessageSquare,
}

export interface WorkNavigatorProps {
  items: readonly WorkItem[]
  /** The key of the item the surface is showing. */
  selectedKey: string | null
  onSelect: (item: WorkItem) => void
  /**
   * Set when a saved selection could not be honoured, so the navigator can
   * say so instead of letting a different item pose as the reader's last one.
   */
  recoveredFrom?: boolean
  isLoading?: boolean
  className?: string
}

export function WorkNavigator({
  items, selectedKey, onSelect, recoveredFrom = false, isLoading = false, className,
}: WorkNavigatorProps) {
  if (isLoading) {
    return (
      <div className={clsx('space-y-1.5', className)} data-testid="work-nav-loading">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div
        data-testid="work-nav-empty"
        className={clsx('rounded-md border border-dashed border-gray-300 px-3 py-4 dark:border-gray-700', className)}
      >
        <p className="text-[12px] text-gray-500 dark:text-gray-400">No active work on this asset.</p>
      </div>
    )
  }

  return (
    <nav className={clsx('space-y-3', className)} aria-label="Work items" data-testid="work-navigator">
      {recoveredFrom && (
        <p
          data-testid="work-nav-recovered"
          className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/[0.08] dark:text-amber-300"
        >
          The item you were on is no longer available.
        </p>
      )}

      {GROUP_ORDER.map(group => {
        const rows = itemsInGroup(items, group)
        /* An empty group renders nothing. "Needs your action (0)" is a line
           that teaches the reader to stop looking at the one place meant to
           interrupt them. */
        if (rows.length === 0) return null

        return (
          <div key={group} data-testid={`work-nav-group-${group}`}>
            <p className="mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {group === 'needs-you' && (
                <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" />
              )}
              {GROUP_LABEL[group]}
            </p>
            <ul className="space-y-0.5">
              {rows.map(item => {
                const Icon = KIND_ICON[item.kind]
                const current = !item.launchesPane && item.key === selectedKey
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      aria-current={current ? 'true' : undefined}
                      data-testid={`work-nav-${item.key}`}
                      className={clsx(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        current
                          ? 'bg-primary-50 ring-1 ring-primary-200 dark:bg-primary-500/10 dark:ring-primary-400/30'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800',
                      )}
                    >
                      <Icon
                        className={clsx(
                          'h-3.5 w-3.5 shrink-0 translate-y-0.5',
                          current ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400',
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={clsx(
                            'block truncate text-[12px] font-medium',
                            current
                              ? 'text-primary-900 dark:text-primary-100'
                              : 'text-gray-900 dark:text-gray-100',
                          )}
                        >
                          {item.label}
                        </span>
                        {item.detail && (
                          <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                            {item.detail}
                          </span>
                        )}
                      </span>
                      {/* A conversation opens the CoAnalyst pane rather than
                          taking the surface, so the row says so. */}
                      {item.launchesPane && (
                        <ExternalLink className="h-3 w-3 shrink-0 translate-y-0.5 text-gray-300" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
