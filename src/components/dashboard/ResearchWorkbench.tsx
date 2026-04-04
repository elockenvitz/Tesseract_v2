/**
 * ResearchWorkbench — Accordion-style research operating surface.
 *
 * Sections:
 *   1. Stale Thesis — coverage that needs updating
 *   2. Projects & Deliverables — grouped by project, deliverables nested
 *   3. Pipeline — ideas stuck pre-decision
 *   4. Investigate — system-generated insights from cross-band analysis
 *   5. Monitoring — rating changes, signals, coverage freshness
 *
 * Click an item → right-hand detail pane shows context + actions.
 * Sections auto-expand if they have items.
 */

import { useState, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  FlaskConical,
  Compass,
  Eye,
  ArrowRight,
  Clock,
  AlertTriangle,
  TrendingDown,
  Activity,
} from 'lucide-react'
import type { CockpitViewModel, CockpitStack } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Section config
// ---------------------------------------------------------------------------

interface SectionConfig {
  id: string
  title: string
  icon: React.FC<{ className?: string }>
  emptyLabel: string
  accentBorder: string
  accentText: string
  accentBg: string
}

const SECTIONS: SectionConfig[] = [
  {
    id: 'thesis', title: 'Stale Thesis', icon: FileText,
    emptyLabel: 'All thesis coverage current',
    accentBorder: 'border-l-amber-400', accentText: 'text-amber-700 dark:text-amber-400',
    accentBg: 'bg-amber-50 dark:bg-amber-950/20',
  },
  {
    id: 'projects', title: 'Projects & Deliverables', icon: FolderKanban,
    emptyLabel: 'No projects needing attention',
    accentBorder: 'border-l-red-400', accentText: 'text-red-700 dark:text-red-400',
    accentBg: 'bg-red-50 dark:bg-red-950/20',
  },
  {
    id: 'simulation', title: 'Pipeline', icon: FlaskConical,
    emptyLabel: 'Pipeline clear',
    accentBorder: 'border-l-blue-400', accentText: 'text-blue-700 dark:text-blue-400',
    accentBg: 'bg-blue-50 dark:bg-blue-950/20',
  },
  {
    id: 'investigate', title: 'Investigate', icon: Compass,
    emptyLabel: 'No anomalies surfaced',
    accentBorder: 'border-l-violet-400', accentText: 'text-violet-700 dark:text-violet-400',
    accentBg: 'bg-violet-50 dark:bg-violet-950/20',
  },
  {
    id: 'monitoring', title: 'Monitoring', icon: Eye,
    emptyLabel: 'Coverage within normal bounds',
    accentBorder: 'border-l-gray-400 dark:border-l-gray-500', accentText: 'text-gray-600 dark:text-gray-400',
    accentBg: 'bg-gray-100 dark:bg-gray-800/40',
  },
]

// ---------------------------------------------------------------------------
// Synthetic insight generation (for Investigate + Monitoring when empty)
// ---------------------------------------------------------------------------

interface SyntheticItem {
  id: string
  title: string
  detail: string
  severity: 'HIGH' | 'MED' | 'LOW'
  icon: React.FC<{ className?: string }>
}

function buildSyntheticInvestigateItems(viewModel: CockpitViewModel): SyntheticItem[] {
  const items: SyntheticItem[] = []

  // 1. Decisions approaching aging threshold (5-9d, not yet HIGH)
  const allDecideItems = viewModel.decide.stacks.flatMap(s => s.itemsAll)
  const nearThreshold = allDecideItems.filter(i => {
    const age = i.ageDays ?? 0
    return age >= 5 && age < 10 && i.severity !== 'HIGH'
  })
  if (nearThreshold.length > 0) {
    const tickers = nearThreshold.slice(0, 3).map(i => i.asset?.ticker || i.title).filter(Boolean).join(', ')
    items.push({
      id: 'syn-aging-watch',
      title: `${nearThreshold.length} decision${nearThreshold.length !== 1 ? 's' : ''} approaching aging threshold`,
      detail: tickers,
      severity: 'MED',
      icon: Clock,
    })
  }

  // 2. Ideas idle in pipeline
  const simStack = viewModel.advance.stacks.find(s => s.kind === 'simulation')
  if (simStack && simStack.count > 0 && simStack.oldestAgeDays > 5) {
    items.push({
      id: 'syn-pipeline-idle',
      title: `${simStack.count} idea${simStack.count !== 1 ? 's' : ''} idle in pipeline`,
      detail: `Oldest: ${simStack.oldestAgeDays}d \u2014 advance or discard`,
      severity: simStack.oldestAgeDays > 14 ? 'HIGH' : 'MED',
      icon: Activity,
    })
  }

  // 3. Overdue deliverables degrading research quality
  const allStacks = [...viewModel.advance.stacks, ...viewModel.decide.stacks]
  const delivStack = allStacks.find(s => s.kind === 'deliverable')
  const overdueDelivs = delivStack?.itemsAll.filter(i => i.meta?.overdueDays != null && i.meta.overdueDays > 7) ?? []
  if (overdueDelivs.length > 0) {
    items.push({
      id: 'syn-research-lag',
      title: `${overdueDelivs.length} deliverable${overdueDelivs.length !== 1 ? 's' : ''} significantly overdue`,
      detail: 'Research process may be degrading decision quality',
      severity: 'MED',
      icon: TrendingDown,
    })
  }

  // 4. Decision concentration in one portfolio
  const portfolioCounts = new Map<string, number>()
  for (const item of allDecideItems) {
    if (item.portfolio?.name) {
      portfolioCounts.set(item.portfolio.name, (portfolioCounts.get(item.portfolio.name) ?? 0) + 1)
    }
  }
  const topPortfolio = [...portfolioCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topPortfolio && topPortfolio[1] >= 3 && allDecideItems.length >= 4) {
    items.push({
      id: 'syn-concentration',
      title: `${topPortfolio[1]} of ${allDecideItems.length} decisions concentrated in ${topPortfolio[0]}`,
      detail: 'Decision bottleneck may be portfolio-specific',
      severity: 'LOW',
      icon: TrendingDown,
    })
  }

  // 5. Stale thesis as blind spot risk
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  if (thesisStack && thesisStack.count > 0) {
    const critical = thesisStack.itemsAll.filter(i => i.severity === 'HIGH')
    if (critical.length > 0) {
      const tickers = critical.slice(0, 3).map(i => i.asset?.ticker).filter(Boolean).join(', ')
      items.push({
        id: 'syn-blind-spot',
        title: `${critical.length} thesis${critical.length !== 1 ? 'es' : ''} creating blind spots`,
        detail: tickers ? `Positions without current research: ${tickers}` : `Oldest: ${thesisStack.oldestAgeDays}d without review`,
        severity: 'HIGH',
        icon: AlertTriangle,
      })
    }
  }

  return items
}

function buildSyntheticMonitoringItems(viewModel: CockpitViewModel): SyntheticItem[] {
  const items: SyntheticItem[] = []

  // 1. Total pipeline health summary
  const decideCount = viewModel.decide.totalItems
  const advanceCount = viewModel.advance.totalItems
  if (decideCount > 0 || advanceCount > 0) {
    items.push({
      id: 'syn-pipeline-health',
      title: `Pipeline: ${decideCount} awaiting decision, ${advanceCount} in progress`,
      detail: decideCount > 5 ? 'Decision backlog building' : 'Normal flow',
      severity: decideCount > 5 ? 'MED' : 'LOW',
      icon: Activity,
    })
  }

  // 2. Coverage age summary
  const thesisStack = viewModel.advance.stacks.find(s => s.kind === 'thesis')
  if (thesisStack && thesisStack.count > 0) {
    items.push({
      id: 'syn-coverage-age',
      title: `${thesisStack.count} thesis${thesisStack.count !== 1 ? 'es' : ''} beyond review window`,
      detail: `Median age: ${thesisStack.medianAgeDays}d \u00B7 Oldest: ${thesisStack.oldestAgeDays}d`,
      severity: 'LOW',
      icon: FileText,
    })
  }

  // 3. Aware band signals
  const awareTotal = viewModel.aware.totalItems
  if (awareTotal > 0) {
    const ratingStack = viewModel.aware.stacks.find(s => s.kind === 'rating')
    const signalStack = viewModel.aware.stacks.find(s => s.kind === 'signal')
    const parts: string[] = []
    if (ratingStack && ratingStack.count > 0) parts.push(`${ratingStack.count} rating change${ratingStack.count !== 1 ? 's' : ''}`)
    if (signalStack && signalStack.count > 0) parts.push(`${signalStack.count} signal${signalStack.count !== 1 ? 's' : ''}`)
    items.push({
      id: 'syn-aware-signals',
      title: parts.join(' \u00B7 ') || `${awareTotal} monitoring signal${awareTotal !== 1 ? 's' : ''}`,
      detail: 'Coverage and intelligence signals',
      severity: 'LOW',
      icon: Eye,
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Project grouping — deliverables nested under their project
// ---------------------------------------------------------------------------

interface ProjectGroup {
  projectName: string
  /** The project-level DashboardItem (if one exists) — used for click/navigation */
  projectItem: DashboardItem | null
  deliverableItems: DashboardItem[]
}

function groupProjectsAndDeliverables(
  projectItems: DashboardItem[],
  deliverableItems: DashboardItem[],
): ProjectGroup[] {
  const groupMap = new Map<string, ProjectGroup>()

  // Seed groups from project items (title = project name)
  for (const item of projectItems) {
    const name = item.title || 'Unnamed Project'
    if (!groupMap.has(name)) {
      groupMap.set(name, { projectName: name, projectItem: item, deliverableItems: [] })
    } else {
      // If group already exists (created by a deliverable), attach the project item
      groupMap.get(name)!.projectItem = item
    }
  }

  // Nest deliverables under their project (meta.projectName)
  for (const item of deliverableItems) {
    const name = item.meta?.projectName || 'Ungrouped'
    if (!groupMap.has(name)) {
      groupMap.set(name, { projectName: name, projectItem: null, deliverableItems: [] })
    }
    groupMap.get(name)!.deliverableItems.push(item)
  }

  // Sort: groups with overdue deliverables first, then by total item count
  return Array.from(groupMap.values()).sort((a, b) => {
    const aOverdue = a.deliverableItems.filter(d => d.meta?.overdueDays != null && d.meta.overdueDays > 0).length
    const bOverdue = b.deliverableItems.filter(d => d.meta?.overdueDays != null && d.meta.overdueDays > 0).length
    if (aOverdue !== bOverdue) return bOverdue - aOverdue
    const aTotal = (a.projectItem ? 1 : 0) + a.deliverableItems.length
    const bTotal = (b.projectItem ? 1 : 0) + b.deliverableItems.length
    return bTotal - aTotal
  })
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function getSectionStatus(items: DashboardItem[], sectionId: string): { label: string; cls: string } | null {
  if (items.length === 0) return null
  const highCount = items.filter(i => i.severity === 'HIGH').length
  const medCount = items.filter(i => i.severity === 'MED').length

  if (sectionId === 'thesis') {
    if (highCount > 0) return { label: `${highCount} stale`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (medCount > 0) return { label: `${medCount} aging`, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  }
  if (sectionId === 'projects') {
    const overdue = items.filter(i => i.meta?.overdueDays != null && i.meta.overdueDays > 0).length
    if (overdue > 0) return { label: `${overdue} overdue`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (highCount > 0) return { label: `${highCount} at risk`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  }
  if (sectionId === 'simulation') {
    const oldest = Math.max(0, ...items.map(i => i.ageDays ?? 0))
    if (oldest > 14) return { label: 'stalled', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (oldest > 7) return { label: 'aging', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  }
  return null
}

function getItemSubline(item: DashboardItem, sectionId: string): string {
  if (sectionId === 'projects' && item.meta?.overdueDays != null && item.meta.overdueDays > 0) {
    return `${item.meta.overdueDays}d overdue`
  }
  if (sectionId === 'thesis') {
    const age = item.ageDays ?? 0
    return age >= 180 ? `${age}d without review \u2014 blind spot risk` : `${age}d since last update`
  }
  if (sectionId === 'monitoring' && item.meta?.ratingFrom && item.meta?.ratingTo) {
    return `${item.meta.ratingFrom} \u2192 ${item.meta.ratingTo}`
  }
  return item.reason || ''
}

function ageColor(d: number) {
  return d >= 10 ? 'text-red-600 dark:text-red-400' : d >= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResearchWorkbenchProps {
  viewModel: CockpitViewModel
  onItemClick?: (item: DashboardItem) => void
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ResearchWorkbench({ viewModel, onItemClick }: ResearchWorkbenchProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set())

  // Gather items per section from ALL bands (including DECIDE for promoted deliverables)
  const sectionData = useMemo(() => {
    const allStacks = [
      ...viewModel.decide.stacks,
      ...viewModel.advance.stacks,
      ...viewModel.aware.stacks,
      ...viewModel.investigate.stacks,
    ]

    // Thesis
    const thesisItems = allStacks.filter(s => s.kind === 'thesis').flatMap(s => s.itemsAll)

    // Projects + Deliverables — separated by data, not stack kind.
    // Items with meta.projectName are deliverables (they belong to a project).
    // Items from project/deliverable stacks WITHOUT meta.projectName are project-level items.
    // Engine deliverables (kind=deliverable) always have projectName via context.
    // Attention deliverables (source_type=project_deliverable) have projectName via subtitle.
    const projectAndDelivStacks = allStacks.filter(s => s.kind === 'project' || s.kind === 'deliverable')
    const allPDItems = projectAndDelivStacks.flatMap(s => s.itemsAll)
    const projectItems = allPDItems.filter(i => !i.meta?.projectName)
    const deliverableItems = allPDItems.filter(i => !!i.meta?.projectName)
    const projectGroups = groupProjectsAndDeliverables(projectItems, deliverableItems)
    const allProjectItems = allPDItems

    // Pipeline (simulation)
    const simulationItems = allStacks.filter(s => s.kind === 'simulation').flatMap(s => s.itemsAll)

    // Investigate: real items + synthetics
    const realInvestigateItems = viewModel.investigate.stacks.flatMap(s => s.itemsAll)
    const syntheticInvestigate = realInvestigateItems.length === 0 ? buildSyntheticInvestigateItems(viewModel) : []

    // Monitoring: real items (rating + signal) + synthetics
    const realMonitoringItems = allStacks
      .filter(s => s.kind === 'rating' || s.kind === 'signal')
      .flatMap(s => s.itemsAll)
    const syntheticMonitoring = realMonitoringItems.length === 0 ? buildSyntheticMonitoringItems(viewModel) : []

    return {
      thesis: thesisItems,
      projects: allProjectItems,
      projectGroups,
      simulation: simulationItems,
      investigate: realInvestigateItems,
      syntheticInvestigate,
      monitoring: realMonitoringItems,
      syntheticMonitoring,
    }
  }, [viewModel])

  // Count items per section (including synthetics)
  const sectionCounts = useMemo(() => ({
    thesis: sectionData.thesis.length,
    projects: sectionData.projects.length,
    simulation: sectionData.simulation.length,
    investigate: sectionData.investigate.length + sectionData.syntheticInvestigate.length,
    monitoring: sectionData.monitoring.length + sectionData.syntheticMonitoring.length,
  }), [sectionData])

  // Auto-expand sections that have content
  const initialExpanded = useMemo(() => {
    const set = new Set<string>()
    for (const sec of SECTIONS) {
      if ((sectionCounts[sec.id as keyof typeof sectionCounts] ?? 0) > 0) set.add(sec.id)
    }
    return set
  }, [])

  const effectiveExpanded = expandedSections.size > 0 ? expandedSections : initialExpanded

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const base = prev.size > 0 ? prev : initialExpanded
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [initialExpanded])

  // Find selected item
  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    const allItems = [
      ...sectionData.thesis,
      ...sectionData.projects,
      ...sectionData.simulation,
      ...sectionData.investigate,
      ...sectionData.monitoring,
    ]
    return allItems.find(i => i.id === selectedItemId) ?? null
  }, [selectedItemId, sectionData])

  const handleSelectItem = useCallback((item: DashboardItem) => {
    setSelectedItemId(item.id)
  }, [])

  const totalItems = useMemo(() =>
    Object.values(sectionCounts).reduce((s, c) => s + c, 0),
  [sectionCounts])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-2 items-start transition-all duration-300 ease-in-out">
      {/* Left: Accordion */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-3.5 py-2 border-b border-gray-100 dark:border-gray-700/40">
          <span className="text-[12px] font-bold text-gray-800 dark:text-gray-100 tabular-nums">
            {totalItems}
          </span>
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Research Items
          </span>
        </div>

        {/* Thesis */}
        <AccordionSection
          config={SECTIONS[0]}
          items={sectionData.thesis}
          count={sectionCounts.thesis}
          status={getSectionStatus(sectionData.thesis, 'thesis')}
          isExpanded={effectiveExpanded.has('thesis')}
          isFirst
          selectedItemId={selectedItemId}
          onToggle={() => toggleSection('thesis')}
          onSelectItem={handleSelectItem}
        />

        {/* Projects & Deliverables — grouped */}
        <ProjectsSection
          config={SECTIONS[1]}
          groups={sectionData.projectGroups}
          count={sectionCounts.projects}
          status={getSectionStatus(sectionData.projects, 'projects')}
          isExpanded={effectiveExpanded.has('projects')}
          selectedItemId={selectedItemId}
          onToggle={() => toggleSection('projects')}
          onSelectItem={handleSelectItem}
        />

        {/* Pipeline */}
        <AccordionSection
          config={SECTIONS[2]}
          items={sectionData.simulation}
          count={sectionCounts.simulation}
          status={getSectionStatus(sectionData.simulation, 'simulation')}
          isExpanded={effectiveExpanded.has('simulation')}
          selectedItemId={selectedItemId}
          onToggle={() => toggleSection('simulation')}
          onSelectItem={handleSelectItem}
        />

        {/* Investigate */}
        <AccordionSection
          config={SECTIONS[3]}
          items={sectionData.investigate}
          syntheticItems={sectionData.syntheticInvestigate}
          count={sectionCounts.investigate}
          isExpanded={effectiveExpanded.has('investigate')}
          selectedItemId={selectedItemId}
          onToggle={() => toggleSection('investigate')}
          onSelectItem={handleSelectItem}
        />

        {/* Monitoring */}
        <AccordionSection
          config={SECTIONS[4]}
          items={sectionData.monitoring}
          syntheticItems={sectionData.syntheticMonitoring}
          count={sectionCounts.monitoring}
          isExpanded={effectiveExpanded.has('monitoring')}
          selectedItemId={selectedItemId}
          onToggle={() => toggleSection('monitoring')}
          onSelectItem={handleSelectItem}
        />
      </div>

      {/* Right: Detail pane */}
      {selectedItem && (
        <ResearchDetailPane item={selectedItem} onItemClick={onItemClick} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AccordionSection — Generic section with flat item list + optional synthetics
// ---------------------------------------------------------------------------

function AccordionSection({
  config,
  items,
  syntheticItems,
  count,
  status,
  isExpanded,
  isFirst,
  selectedItemId,
  onToggle,
  onSelectItem,
}: {
  config: SectionConfig
  items: DashboardItem[]
  syntheticItems?: SyntheticItem[]
  count: number
  status?: { label: string; cls: string } | null
  isExpanded: boolean
  isFirst?: boolean
  selectedItemId: string | null
  onToggle: () => void
  onSelectItem: (item: DashboardItem) => void
}) {
  const Icon = config.icon
  const isEmpty = count === 0
  const hasSynthetics = (syntheticItems?.length ?? 0) > 0

  return (
    <div className={clsx(!isFirst && 'border-t border-gray-100 dark:border-gray-700/40')}>
      <button
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-2 px-3.5 py-2.5 text-left transition-colors',
          isEmpty
            ? 'bg-gray-50/30 dark:bg-gray-800/20'
            : clsx(config.accentBg, 'hover:brightness-95 dark:hover:brightness-110'),
        )}
      >
        {isExpanded && !isEmpty
          ? <ChevronDown className={clsx('w-3 h-3 shrink-0', config.accentText)} />
          : <ChevronRight className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
        }
        <Icon className={clsx('w-3.5 h-3.5 shrink-0', isEmpty ? 'text-gray-300 dark:text-gray-600' : config.accentText)} />
        <span className={clsx(
          'text-[12px] font-semibold',
          isEmpty ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200',
        )}>
          {config.title}
        </span>
        {!isEmpty && (
          <span className={clsx(
            'text-[11px] font-bold tabular-nums px-1.5 py-px rounded-full min-w-[20px] text-center',
            config.accentBg, config.accentText,
          )}>
            {count}
          </span>
        )}
        {status && (
          <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded', status.cls)}>
            {status.label}
          </span>
        )}
        {isEmpty && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic ml-auto">
            {config.emptyLabel}
          </span>
        )}
      </button>

      {isExpanded && !isEmpty && (
        <div>
          {/* Real items */}
          {items.map(item => (
            <ResearchItemRow
              key={item.id}
              item={item}
              sectionId={config.id}
              isSelected={item.id === selectedItemId}
              onSelect={onSelectItem}
            />
          ))}

          {/* Synthetic items (when no real items) */}
          {items.length === 0 && hasSynthetics && syntheticItems!.map(syn => (
            <SyntheticItemRow key={syn.id} item={syn} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectsSection — Projects with deliverables grouped underneath
// ---------------------------------------------------------------------------

function ProjectsSection({
  config,
  groups,
  count,
  status,
  isExpanded,
  selectedItemId,
  onToggle,
  onSelectItem,
}: {
  config: SectionConfig
  groups: ProjectGroup[]
  count: number
  status: { label: string; cls: string } | null
  isExpanded: boolean
  selectedItemId: string | null
  onToggle: () => void
  onSelectItem: (item: DashboardItem) => void
}) {
  const Icon = config.icon
  const isEmpty = count === 0

  return (
    <div className="border-t border-gray-100 dark:border-gray-700/40">
      <button
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-2 px-3.5 py-2.5 text-left transition-colors',
          isEmpty
            ? 'bg-gray-50/30 dark:bg-gray-800/20'
            : clsx(config.accentBg, 'hover:brightness-95 dark:hover:brightness-110'),
        )}
      >
        {isExpanded && !isEmpty
          ? <ChevronDown className={clsx('w-3 h-3 shrink-0', config.accentText)} />
          : <ChevronRight className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
        }
        <Icon className={clsx('w-3.5 h-3.5 shrink-0', isEmpty ? 'text-gray-300 dark:text-gray-600' : config.accentText)} />
        <span className={clsx(
          'text-[12px] font-semibold',
          isEmpty ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200',
        )}>
          {config.title}
        </span>
        {!isEmpty && (
          <span className={clsx(
            'text-[11px] font-bold tabular-nums px-1.5 py-px rounded-full min-w-[20px] text-center',
            config.accentBg, config.accentText,
          )}>
            {count}
          </span>
        )}
        {status && (
          <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded', status.cls)}>
            {status.label}
          </span>
        )}
        {isEmpty && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic ml-auto">
            {config.emptyLabel}
          </span>
        )}
      </button>

      {isExpanded && !isEmpty && (
        <div>
          {groups.map(group => {
            const overdueCount = group.deliverableItems.filter(d => d.meta?.overdueDays != null && d.meta.overdueDays > 0).length

            return (
              <div key={group.projectName}>
                {/* Project group header — clickable if project item exists */}
                <div
                  onClick={() => { if (group.projectItem) onSelectItem(group.projectItem) }}
                  className={clsx(
                    'flex items-center gap-2 pl-8 pr-3.5 py-1.5',
                    'bg-gray-50/40 dark:bg-gray-800/20',
                    'border-t border-t-gray-100 dark:border-t-gray-700/30',
                    group.projectItem && 'cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-700/30',
                    group.projectItem?.id === selectedItemId && 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800/40',
                  )}
                >
                  <FolderKanban className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0" />
                  <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {group.projectName}
                  </span>
                  {group.deliverableItems.length > 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                      {group.deliverableItems.length} deliverable{group.deliverableItems.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {overdueCount > 0 && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      {overdueCount} overdue
                    </span>
                  )}
                </div>

                {/* Deliverable items under project */}
                {group.deliverableItems.map(item => (
                  <ResearchItemRow
                    key={item.id}
                    item={item}
                    sectionId="projects"
                    isSelected={item.id === selectedItemId}
                    onSelect={onSelectItem}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResearchItemRow
// ---------------------------------------------------------------------------

function ResearchItemRow({
  item,
  sectionId,
  isSelected,
  onSelect,
}: {
  item: DashboardItem
  sectionId: string
  isSelected: boolean
  onSelect: (item: DashboardItem) => void
}) {
  const age = item.ageDays ?? 0
  const overdue = item.meta?.overdueDays ?? 0
  const displayAge = overdue > 0 ? overdue : age
  const subline = getItemSubline(item, sectionId)

  return (
    <div
      onClick={() => onSelect(item)}
      className={clsx(
        'flex items-center gap-2 py-[6px] cursor-pointer transition-colors',
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20 border-l-[3px] border-l-blue-500 !pl-[29px]'
          : 'hover:bg-gray-50/40 dark:hover:bg-gray-700/20',
        'border-t border-t-gray-50 dark:border-t-gray-700/20',
        'pl-8 pr-3.5',
      )}
    >
      {/* Age / Overdue */}
      <span className={clsx(
        'w-[26px] shrink-0 text-[11px] font-bold tabular-nums text-right',
        overdue > 0
          ? overdue >= 7 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
          : ageColor(age),
      )}>
        {displayAge}d
      </span>

      {/* Ticker */}
      {item.asset?.ticker && (
        <span className={clsx(
          'shrink-0 text-[12px] font-bold',
          isSelected ? 'text-gray-900 dark:text-gray-50' : 'text-blue-600 dark:text-blue-400',
        )}>
          {item.asset.ticker}
        </span>
      )}

      {/* Title or subline */}
      <span className={clsx(
        'flex-1 min-w-0 text-[12px] truncate',
        isSelected ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-500 dark:text-gray-400',
      )}>
        {item.asset?.ticker ? subline : item.title}
      </span>

      {/* Portfolio */}
      {item.portfolio?.name && (
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
          {item.portfolio.name}
        </span>
      )}

      {/* Severity dot */}
      {item.severity === 'HIGH' && (
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SyntheticItemRow — Same visual treatment as real items (single-line)
// ---------------------------------------------------------------------------

function SyntheticItemRow({
  item,
}: {
  item: SyntheticItem
}) {
  return (
    <div className={clsx(
      'flex items-center gap-2 pl-8 pr-3.5 py-[6px]',
      'border-t border-t-gray-50 dark:border-t-gray-700/20',
    )}>
      {/* Severity indicator — same width as age column */}
      <span className={clsx(
        'w-[26px] shrink-0 text-center',
      )}>
        <span className={clsx(
          'inline-block w-1.5 h-1.5 rounded-full',
          item.severity === 'HIGH' ? 'bg-red-500'
            : item.severity === 'MED' ? 'bg-amber-500'
              : 'bg-gray-300 dark:bg-gray-600',
        )} />
      </span>

      {/* Title — same position as ticker/title in real rows */}
      <span className={clsx(
        'flex-1 min-w-0 text-[12px] truncate',
        item.severity === 'HIGH' ? 'text-gray-700 dark:text-gray-200 font-medium'
          : 'text-gray-500 dark:text-gray-400',
      )}>
        {item.title}
      </span>

      {/* Detail — right-aligned, same as portfolio position */}
      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[180px]">
        {item.detail}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResearchDetailPane — Right-hand detail for selected research item
// ---------------------------------------------------------------------------

function ResearchDetailPane({
  item,
  onItemClick,
}: {
  item: DashboardItem
  onItemClick?: (item: DashboardItem) => void
}) {
  const age = item.ageDays ?? 0
  const overdue = item.meta?.overdueDays ?? 0
  const ticker = item.asset?.ticker

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden lg:sticky lg:top-3 transition-all duration-300 ease-in-out">
      <div className="px-4 py-3">
        {/* Header badges */}
        <div className="flex items-center gap-2 mb-2.5">
          {item.severity === 'HIGH' && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded bg-red-600 text-white">
              Critical
            </span>
          )}
          {item.severity === 'MED' && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded bg-amber-500 text-white">
              Warning
            </span>
          )}
          <div className="flex items-center gap-1">
            <Clock className={clsx('w-3 h-3', ageColor(age))} />
            <span className={clsx('text-[11px] font-bold tabular-nums', ageColor(age))}>
              {overdue > 0 ? `${overdue}d overdue` : `${age}d`}
            </span>
          </div>
          {item.portfolio?.name && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.portfolio.name}</span>
          )}
        </div>

        {/* Title */}
        {ticker && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[20px] font-bold text-gray-900 dark:text-gray-50 leading-tight">
              {ticker}
            </span>
            {item.asset?.name && (
              <span className="text-[12px] text-gray-400 dark:text-gray-500 truncate">
                {item.asset.name}
              </span>
            )}
          </div>
        )}
        {!ticker && (
          <p className="text-[16px] font-bold text-gray-900 dark:text-gray-50 leading-tight mb-1">
            {item.title}
          </p>
        )}

        {/* Reason */}
        {item.reason && (
          <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-snug mt-1">
            {item.reason.length > 200 ? item.reason.slice(0, 197) + '...' : item.reason}
          </p>
        )}

        {/* Meta details */}
        <div className="mt-3 space-y-1.5">
          {item.meta?.projectName && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-[60px] shrink-0">Project</span>
              <span className="text-[11px] text-gray-600 dark:text-gray-300">{item.meta.projectName}</span>
            </div>
          )}
          {item.meta?.ratingFrom && item.meta?.ratingTo && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-[60px] shrink-0">Rating</span>
              <span className="text-[11px] text-gray-600 dark:text-gray-300">{item.meta.ratingFrom} \u2192 {item.meta.ratingTo}</span>
            </div>
          )}
          {item.contextChips && item.contextChips.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider w-[60px] shrink-0">Tags</span>
              <div className="flex items-center gap-1 flex-wrap">
                {item.contextChips.map((chip, i) => (
                  <span key={i} className="text-[9px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 px-1.5 py-px rounded">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/40">
        <button
          onClick={() => item.primaryAction.onClick()}
          className="w-full flex items-center justify-center gap-2 text-[13px] font-bold text-white bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 px-4 py-2.5 rounded-lg transition-colors shadow-sm mb-2"
        >
          {item.primaryAction.label}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        {item.asset?.id && onItemClick && (
          <button
            onClick={() => onItemClick(item)}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Open Asset
          </button>
        )}
      </div>
    </div>
  )
}
