import { clsx } from 'clsx'
import { Check } from 'lucide-react'
import { BottomSheet } from '../mobile/BottomSheet'
import { PROJECT_STATUSES, PROJECT_PRIORITIES } from '../../lib/project-config'
import type { ProjectStatus, ProjectPriority } from '../../types/project'

/** The four statuses the list rail offers, in its order. `all` is the null state. */
export type QuickStatus = ProjectStatus | null
export type PriorityFilter = ProjectPriority | 'all'

export interface ProjectsFilterSheetProps {
  open: boolean
  onClose: () => void

  /**
   * Board view represents status spatially, as columns, so the status rail is
   * already hidden there on every viewport (`viewMode !== 'board'` in
   * ProjectsPage). This mirrors that rather than inventing a second rule:
   * pass false and the Status section is not rendered.
   */
  showStatus: boolean

  quickStatus: QuickStatus
  onQuickStatusChange: (status: QuickStatus) => void

  priority: PriorityFilter
  onPriorityChange: (priority: PriorityFilter) => void

  /** How many projects the current selection matches — shown on the commit button. */
  matchCount: number
  activeCount: number
  onClearAll: () => void

  /**
   * The collections navigation — All Projects, Teams, Org Groups, Tags and
   * saved collections.
   *
   * On a desktop this is a 256px rail. On a phone it was the same rail behind
   * a chevron, opening as a drawer over the page: a desktop paradigm moved
   * sideways rather than a mobile one. It is real navigation though, so it
   * is not dropped — it is rendered here, in the control a phone already
   * uses to narrow the list, with its own component and its own queries
   * unchanged.
   */
  collections?: React.ReactNode
}

/**
 * Status and priority filtering for the Projects list, in one sheet.
 *
 * On a desktop these are two horizontal rails: "Status:" followed by six
 * chips, then "Priority:" followed by five. Neither fits 390px — "Blocked"
 * was visibly clipped — and together they cost two full bands of the phone
 * before a single project appeared, on top of the header, the action row,
 * search and sort. Roughly half the screen was chrome.
 *
 * Collapsing both behind one `Filters (N)` trigger is what buys that space
 * back without cutting any option, which is the same trade `NotesFilterSheet`
 * makes for the notes filters. Semantics are unchanged: these write the exact
 * same `quickStatusFilter` and `priorityFilter` state the rails wrote, and no
 * filter is added or removed.
 */
export function ProjectsFilterSheet({
  open,
  onClose,
  showStatus,
  quickStatus,
  onQuickStatusChange,
  priority,
  onPriorityChange,
  matchCount,
  activeCount,
  onClearAll,
  collections,
}: ProjectsFilterSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filter projects"
      snapPoints={[0.85]}
      headerAccessory={
        activeCount > 0 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm font-semibold text-primary-600 dark:text-primary-400 no-touch-target"
          >
            Clear all
          </button>
        ) : null
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full h-12 rounded-xl bg-primary-600 text-white font-semibold"
        >
          Show {matchCount} {matchCount === 1 ? 'project' : 'projects'}
        </button>
      }
    >
      <div className="pb-2">
        {showStatus && (
          <Section title="Status">
            <Row selected={quickStatus === null} onClick={() => onQuickStatusChange(null)}>
              <span className="flex-1 min-w-0 truncate">All statuses</span>
            </Row>
            {PROJECT_STATUSES.filter(s => s.id !== 'cancelled').map(s => (
              <Row
                key={s.id}
                selected={quickStatus === s.id}
                onClick={() => onQuickStatusChange(s.id)}
              >
                <span className={clsx('h-2.5 w-2.5 rounded-full shrink-0', s.dotColor)} />
                <span className="flex-1 min-w-0 truncate">{s.label}</span>
              </Row>
            ))}
          </Section>
        )}

        <Section title="Priority">
          <Row selected={priority === 'all'} onClick={() => onPriorityChange('all')}>
            <span className="flex-1 min-w-0 truncate">All priorities</span>
          </Row>
          {PROJECT_PRIORITIES.map(p => (
            <Row key={p.id} selected={priority === p.id} onClick={() => onPriorityChange(p.id)}>
              <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium shrink-0', p.pillClasses)}>
                {p.label}
              </span>
              <span className="flex-1 min-w-0" />
            </Row>
          ))}
        </Section>

        {collections && (
          <div className="pt-3">
            <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Collections
            </div>
            {collections}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'w-full px-4 py-3 flex items-center gap-3 text-left text-sm',
        selected
          ? 'text-primary-700 dark:text-primary-300 font-semibold'
          : 'text-gray-700 dark:text-gray-200',
      )}
    >
      {children}
      {selected && <Check className="h-4 w-4 text-primary-600 shrink-0" />}
    </button>
  )
}
