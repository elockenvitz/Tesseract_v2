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
import { useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, GitBranch, Lightbulb, MessageSquare, ExternalLink, Plus } from 'lucide-react'
import {
  GROUP_LABEL, GROUP_ORDER, itemsInGroup,
  type WorkItem, type WorkItemKind,
} from '../../../lib/asset-work/work-items'

const KIND_ICON: Record<WorkItemKind, typeof GitBranch> = {
  process: GitBranch,
  idea: Lightbulb,
  conversation: MessageSquare,
}

/**
 * How many rows a group shows before it offers the rest.
 *
 * Chosen so the whole navigator stays shorter than the surface beside it on
 * the measured 661px viewport. "Needs your action" is deliberately exempt —
 * see below.
 */
export const GROUP_PREVIEW = 4

export interface WorkNavigatorProps {
  items: readonly WorkItem[]
  /** The key of the item the surface is showing. */
  selectedKey: string | null
  onSelect: (item: WorkItem) => void
  /**
   * The idea stage filter, carried over from the Open Items section this
   * replaced. `null` is "all".
   */
  stageFilter?: string | null
  stageFilterOptions?: readonly { key: string; label: string }[]
  onStageFilter?: (key: string | null) => void
  /** Creates a trade idea, through the existing event. */
  onNewIdea?: () => void
  /**
   * Set when a saved selection could not be honoured, so the navigator can
   * say so instead of letting a different item pose as the reader's last one.
   */
  recoveredFrom?: boolean
  isLoading?: boolean
  className?: string
  /**
   * A control for the navigator's own first header row — the sidebar
   * collapse button.
   *
   * It is a slot rather than a prop pair because the navigator has no opinion
   * about what the control does; it only owns the one row already on screen
   * that can carry it. The alternative was the dedicated full-width row this
   * replaces, which spent 24px of every Work session announcing a button.
   */
  headerAction?: React.ReactNode
}

export function WorkNavigator({
  items, selectedKey, onSelect,
  stageFilter = null, stageFilterOptions = [], onStageFilter, onNewIdea,
  recoveredFrom = false, isLoading = false, className, headerAction,
}: WorkNavigatorProps) {
  /*
   * The collapse control rides the FIRST group header that renders, so it is
   * never on a row of its own and never disappears when a group is empty.
   * Tracked by a mutable flag rather than an index because which group comes
   * first depends on what work exists.
   */
  let headerActionPlaced = false
  /*
   * Which groups the reader has asked to see in full.
   *
   * Local, and deliberately not persisted: it is a glance, not a setting,
   * and restoring an expanded group days later would be restoring noise.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (isLoading) {
    return (
      <div className={clsx('space-y-1.5', className)} data-testid="work-nav-loading">
        {/* The control stays reachable while work loads; a sidebar that
            cannot be collapsed until its contents arrive is a sidebar that
            cannot be collapsed when it is most in the way. */}
        {headerAction && <div className="flex justify-end">{headerAction}</div>}
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
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">No active work on this asset.</p>
          {headerAction}
        </div>
      </div>
    )
  }

  return (
    /*
      Below `xl` the navigator sits ABOVE the surface rather than beside it,
      and a single column of groups cost 215px of a 559px viewport — enough
      to push the first checklist row below the fold at 1150×900, measured.
      The groups flow into columns there instead, which halves the height
      without turning the list into a toolbar. At `xl` it is one column in a
      248px rail again.
    */
    <nav
      className={clsx(
        'grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-1 xl:gap-x-0',
        className,
      )}
      aria-label="Work items"
      data-testid="work-navigator"
    >
      {recoveredFrom && (
        <p
          data-testid="work-nav-recovered"
          className="col-span-full rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/[0.08] dark:text-amber-300"
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

        /*
         * ── Keeping the sidebar finite ───────────────────────────────────
         *
         * "Needs your action" is never truncated: every row in it is work
         * the reader is empowered to resolve, and hiding some of it behind
         * a disclosure would be the surface deciding which of their
         * obligations matters — exactly the invented priority this model
         * refuses. The other groups show a few and offer the rest.
         *
         * The selected item is always shown even when it falls past the
         * preview, so the navigator can never highlight nothing while the
         * surface displays something.
         */
        const isOpen = !!expanded[group]
        const capped = group !== 'needs-you' && !isOpen && rows.length > GROUP_PREVIEW
        const shown = capped
          ? (() => {
              const head = rows.slice(0, GROUP_PREVIEW)
              const sel = rows.find(r => r.key === selectedKey)
              return sel && !head.includes(sel) ? [...head.slice(0, GROUP_PREVIEW - 1), sel] : head
            })()
          : rows

        return (
          <div key={group} data-testid={`work-nav-group-${group}`}>
            <div className="mb-1 flex items-center gap-1 px-1">
              <p className="flex flex-1 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {group === 'needs-you' && (
                  <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" />
                )}
                {GROUP_LABEL[group]}
              </p>
              {/* Idea creation, kept from the Open Items section this
                  replaced. On the group that holds ideas, not in the list
                  membership strip, which is about something else. */}
              {group === 'in-progress' && onNewIdea && (
                <button
                  type="button"
                  onClick={onNewIdea}
                  title="New trade idea"
                  aria-label="New trade idea"
                  data-testid="work-nav-new-idea"
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              {(() => {
                if (headerActionPlaced || !headerAction) return null
                headerActionPlaced = true
                return headerAction
              })()}
            </div>
            <ul className="space-y-0.5">
              {shown.map(item => {
                const Icon = KIND_ICON[item.kind]
                const current = !item.launchesPane && item.key === selectedKey
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      aria-current={current ? 'true' : undefined}
                      /*
                        A row whose label is an abbreviation carries the whole
                        name for the pointer and for a screen reader. Several
                        runs of one process can share a suffix, and this is
                        what still separates them when they do.
                      */
                      title={item.fullName ?? undefined}
                      aria-label={item.fullName ?? undefined}
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

            {rows.length > GROUP_PREVIEW && group !== 'needs-you' && (
              <button
                type="button"
                onClick={() => setExpanded(p => ({ ...p, [group]: !p[group] }))}
                data-testid={`work-nav-more-${group}`}
                className="mt-0.5 w-full rounded px-2 py-1 text-left text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
              >
                {isOpen ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
            )}
          </div>
        )
      })}

      {/*
        The idea stage filter, carried over from the Open Items section.

        It sits at the foot because it narrows the list above it, and because
        a filter at the top of a navigator reads as a page control. The
        options are the canonical stages the pills used; nothing here invents
        a stage.
      */}
      {onStageFilter && stageFilterOptions.length > 0 && (
        <div className="col-span-full flex flex-wrap gap-1 border-t border-gray-100 px-1 pt-2 dark:border-gray-800" data-testid="work-nav-stage-filter">
          {stageFilterOptions.map(opt => {
            const active = (stageFilter ?? 'all') === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onStageFilter(opt.key === 'all' ? null : opt.key)}
                aria-pressed={active}
                data-testid={`work-nav-filter-${opt.key}`}
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                  active
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800',
                )}
              >
                {opt.label}
              </button>
            )
          })}
          {/*
            "No ideas at this stage" is not the same statement as "no ideas",
            and the Open Items section this replaced was careful to tell them
            apart. A filter that silently reads as an empty asset is how a
            reader concludes there is no work when there is.
          */}
          {stageFilter && !items.some(i => i.kind === 'idea') && (
            <p className="w-full px-1 pt-0.5 text-[10px] text-gray-400" data-testid="work-nav-filter-empty">
              No ideas at this stage.
            </p>
          )}
        </div>
      )}
    </nav>
  )
}
