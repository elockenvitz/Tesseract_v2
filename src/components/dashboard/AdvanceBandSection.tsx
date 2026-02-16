/**
 * AdvanceBandSection — Summary-first ADVANCE band.
 *
 * Default view: compact cards per stack kind (thesis, deliverables,
 * simulation, projects) showing count + oldest age + CTA.
 *
 * Click a card to expand its item list inline (only one at a time).
 * Replaces BandSection for the ADVANCE band to reduce vertical density.
 */

import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  FlaskConical,
  ListTodo,
  HelpCircle,
} from 'lucide-react'
import { StackItemRow } from './StackItemRow'
import type { CockpitBandData, CockpitStack } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Card config per stack kind
// ---------------------------------------------------------------------------

const CARD_CONFIG: Record<
  string,
  {
    icon: React.FC<{ className?: string }>
    title: string
    ctaLabel: string
    statLabel: (stack: CockpitStack, allStacks?: CockpitStack[]) => string
  }
> = {
  thesis: {
    icon: FileText,
    title: 'Stale Thesis',
    ctaLabel: 'Review Assets',
    statLabel: (s) => {
      const red = s.itemsAll.filter(i => i.severity === 'HIGH').length
      const orange = s.itemsAll.filter(i => i.severity === 'MED').length
      const parts: string[] = []
      if (red > 0) parts.push(`${red} >180d`)
      if (orange > 0) parts.push(`${orange} >135d`)
      const yellow = s.count - red - orange
      if (yellow > 0) parts.push(`${yellow} >90d`)
      return parts.length > 0 ? parts.join(' · ') : ''
    },
  },
  deliverable: {
    icon: ListTodo,
    title: 'Overdue Deliverables',
    ctaLabel: 'Open',
    statLabel: (s) => {
      const overdue = s.itemsAll.filter(
        (i) => i.meta?.overdueDays != null && i.meta.overdueDays > 0,
      ).length
      return overdue > 0
        ? `${overdue} overdue`
        : s.count > 0
          ? `${s.count} pending`
          : ''
    },
  },
  project: {
    icon: FolderKanban,
    title: 'Projects',
    ctaLabel: 'Open Projects',
    statLabel: (s, allStacks) => {
      // Count overdue items across both project and deliverable stacks
      const deliverableStack = allStacks?.find(st => st.kind === 'deliverable')
      const allItems = [
        ...s.itemsAll,
        ...(deliverableStack?.itemsAll ?? []),
      ]
      const overdue = allItems.filter(i =>
        (i.meta?.overdueDays != null && i.meta.overdueDays > 0) ||
        i.contextChips?.some(c => c.toLowerCase().includes('overdue'))
      ).length
      return overdue > 0 ? `${overdue} overdue` : s.count > 0 ? `${s.count} active` : ''
    },
  },
  simulation: {
    icon: FlaskConical,
    title: 'Ideas Being Worked On',
    ctaLabel: 'Simulate',
    statLabel: (s) => s.count > 0 ? `${s.count} being modeled` : '',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AdvanceBandSectionProps {
  id?: string
  bandData: CockpitBandData
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
}

export function AdvanceBandSection({
  id,
  bandData,
  onItemClick,
}: AdvanceBandSectionProps) {
  const [expandedKind, setExpandedKind] = useState<string | null>(null)
  const [bandExpanded, setBandExpanded] = useState(true)

  const toggleKind = useCallback((kind: string) => {
    setExpandedKind((prev) => (prev === kind ? null : kind))
  }, [])

  // Check for deliverables-only scenario (no project stack)
  const hasProjectStack = bandData.stacks.some(s => s.kind === 'project')
  const deliverableStack = bandData.stacks.find(s => s.kind === 'deliverable')

  // ---- Empty state ----
  if (bandData.stacks.length === 0) {
    return (
      <div
        id={id}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <h2 className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
            {bandData.title}
          </h2>
          <div className="flex-1" />
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            No follow-ups needed.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      id={id}
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden"
    >
      {/* Band header (collapsible) */}
      <button
        onClick={() => setBandExpanded((e) => !e)}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left',
          'hover:bg-gray-50/30 dark:hover:bg-gray-700/20 transition-colors',
        )}
      >
        {bandExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
        )}
        <h2 className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
          {bandData.title}
        </h2>
        <span
          className={clsx(
            'text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center',
            'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          )}
        >
          {bandData.totalItems}
        </span>
      </button>

      {/* Summary cards + expanded items */}
      {bandExpanded && (
        <div className="px-2 pb-2 space-y-2">
          {/* Card grid — deliverables nested under projects card */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {bandData.stacks
              .filter((stack) => stack.kind !== 'deliverable')
              .map((stack) => (
                <SummaryCard
                  key={stack.stackKey}
                  stack={stack}
                  allStacks={bandData.stacks}
                  isExpanded={expandedKind === stack.kind}
                  onToggle={() => toggleKind(stack.kind)}
                />
              ))}
            {/* Synthetic projects card when only deliverables exist */}
            {deliverableStack && !hasProjectStack && (
              <SummaryCard
                key="project-synthetic"
                stack={{
                  ...deliverableStack,
                  kind: 'project',
                  stackKey: 'project',
                  title: 'Projects',
                  count: 0,
                  itemsAll: [],
                  itemsPreview: [],
                } as CockpitStack}
                allStacks={bandData.stacks}
                isExpanded={expandedKind === 'project'}
                onToggle={() => toggleKind('project')}
              />
            )}
          </div>

          {/* Expanded item list for the selected card */}
          {expandedKind && expandedKind !== 'project' && (
            <ExpandedList bandData={bandData} kind={expandedKind} onItemClick={onItemClick} />
          )}
          {/* Projects expanded: project items + deliverables collapsed below */}
          {expandedKind === 'project' && (
            <ProjectExpandedList bandData={bandData} onItemClick={onItemClick} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryCard — compact card for one stack kind
// ---------------------------------------------------------------------------

function SummaryCard({
  stack,
  allStacks,
  isExpanded,
  onToggle,
}: {
  stack: CockpitStack
  allStacks?: CockpitStack[]
  isExpanded: boolean
  onToggle: () => void
}) {
  const config = CARD_CONFIG[stack.kind]
  const Icon = config?.icon ?? HelpCircle
  const title = config?.title ?? stack.title
  // For projects card, include deliverable count in the badge
  const deliverableCount = stack.kind === 'project'
    ? (allStacks?.find(s => s.kind === 'deliverable')?.count ?? 0)
    : 0
  const displayCount = stack.count + deliverableCount
  const stat = config?.statLabel(stack, allStacks) ?? (stack.count > 0 ? `${stack.count} item${stack.count !== 1 ? 's' : ''}` : '')

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'text-left rounded-md border px-3 py-2.5 transition-all',
        isExpanded
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10 ring-1 ring-amber-200/50 dark:ring-amber-800/30'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 flex-1 truncate">
          {title}
        </span>
        <span className="text-[15px] font-bold text-gray-700 dark:text-gray-200 tabular-nums">
          {displayCount}
        </span>
      </div>
      {stat && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500">{stat}</div>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ExpandedList — shows items for the selected stack kind
// ---------------------------------------------------------------------------

function ExpandedList({
  bandData,
  kind,
  onItemClick,
}: {
  bandData: CockpitBandData
  kind: string
  onItemClick?: (item: DashboardItem) => void
}) {
  const stack = bandData.stacks.find((s) => s.kind === kind)
  if (!stack) return null

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
        {stack.itemsAll.map((item) => (
          <StackItemRow key={item.id} item={item} onItemClick={onItemClick} hideAction />
        ))}
      </div>
      {/* Stack CTA */}
      <div className="flex justify-end px-3 py-1.5 border-t border-gray-100 dark:border-gray-700/50">
        <button
          onClick={(e) => {
            e.stopPropagation()
            stack.primaryCTA.onClick()
          }}
          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {stack.primaryCTA.label}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectExpandedList — overdue projects + deliverables
//
// Merges items from both the 'project' and 'deliverable' stacks (attention-
// system deliverables land in the project stack since their type is PROJECT).
// Items WITH meta.projectName are deliverables; items WITHOUT are projects.
//
// Shows: overdue project names (covers their deliverables implicitly),
// plus individual deliverables grouped by project name when the parent
// project is NOT itself overdue.
// ---------------------------------------------------------------------------

function ProjectExpandedList({
  bandData,
  onItemClick,
}: {
  bandData: CockpitBandData
  onItemClick?: (item: DashboardItem) => void
}) {
  const projectStack = bandData.stacks.find((s) => s.kind === 'project')
  const delivStack = bandData.stacks.find((s) => s.kind === 'deliverable')

  // Merge all items from both stacks
  const allItems = [
    ...(projectStack?.itemsAll ?? []),
    ...(delivStack?.itemsAll ?? []),
  ]

  // Detect parent project name: meta.projectName (set by both engine and
  // attention mappers for deliverables), or contextChips[0] for engine items.
  function getParentProjectName(item: DashboardItem): string | null {
    if (item.meta?.projectName) return item.meta.projectName
    if (item.id.startsWith('a4-deliverable')) {
      return item.contextChips?.[0] ?? null
    }
    return null
  }

  // Separate: items with a parent project name are deliverables, others are projects
  const projectItems: DashboardItem[] = []
  const deliverableItems: { item: DashboardItem; projectName: string }[] = []

  for (const item of allItems) {
    const parentProject = getParentProjectName(item)
    if (parentProject) {
      deliverableItems.push({ item, projectName: parentProject })
    } else {
      projectItems.push(item)
    }
  }

  // Group deliverables by project: count + max overdue days (only meta.overdueDays, not ageDays)
  const delivCountByProject = new Map<string, number>()
  const maxOverdueByProject = new Map<string, number>()
  for (const d of deliverableItems) {
    delivCountByProject.set(d.projectName, (delivCountByProject.get(d.projectName) ?? 0) + 1)
    const days = d.item.meta?.overdueDays ?? 0
    if (days > 0) {
      maxOverdueByProject.set(d.projectName, Math.max(maxOverdueByProject.get(d.projectName) ?? 0, days))
    }
  }

  // Build unique project list: from project items + deliverable project names
  const projectRows: { name: string; delivCount: number; overdueDays: number; onClick?: () => void }[] = []
  const seen = new Set<string>()

  for (const item of projectItems) {
    if (!seen.has(item.title)) {
      seen.add(item.title)
      const days = item.meta?.overdueDays ?? 0
      projectRows.push({
        name: item.title,
        delivCount: delivCountByProject.get(item.title) ?? 0,
        overdueDays: Math.max(days, maxOverdueByProject.get(item.title) ?? 0),
        onClick: () => onItemClick?.(item),
      })
    }
  }
  for (const d of deliverableItems) {
    if (!seen.has(d.projectName)) {
      seen.add(d.projectName)
      projectRows.push({
        name: d.projectName,
        delivCount: delivCountByProject.get(d.projectName) ?? 0,
        overdueDays: maxOverdueByProject.get(d.projectName) ?? 0,
        onClick: () => onItemClick?.(d.item),
      })
    }
  }

  if (projectRows.length === 0) return null

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
        {projectRows.map(({ name, delivCount, overdueDays, onClick }) => (
          <div
            key={name}
            onClick={onClick}
            className={clsx(
              'flex items-start gap-2 px-3 py-[6px] group',
              onClick && 'cursor-pointer',
              'hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors',
            )}
          >
            <span className={clsx(
              'shrink-0 text-[11px] font-bold tabular-nums mt-[1px] whitespace-nowrap',
              overdueDays >= 10 ? 'text-red-600 dark:text-red-400'
                : overdueDays >= 5 ? 'text-amber-600 dark:text-amber-400'
                : 'text-gray-400 dark:text-gray-500',
            )}>
              {overdueDays > 0 ? `${overdueDays}d` : '0d'}
            </span>
            <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate mt-[1px]">
              {name}
            </span>
            {delivCount > 0 && (
              <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap mt-[1px]">
                {delivCount} deliverable{delivCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        ))}
      </div>
      {/* CTA */}
      <div className="flex justify-end px-3 py-1.5 border-t border-gray-100 dark:border-gray-700/50">
        <button
          onClick={(e) => {
            e.stopPropagation()
            const cta = projectStack?.primaryCTA ?? delivStack?.primaryCTA
            cta?.onClick()
          }}
          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Open Projects
        </button>
      </div>
    </div>
  )
}
