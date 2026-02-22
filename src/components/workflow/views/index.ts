/**
 * Workflow View Components Index
 *
 * Components for different workflow views/tabs.
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

export { WorkflowMetricsGrid } from './WorkflowMetricsGrid'
export type { WorkflowMetricsGridProps } from './WorkflowMetricsGrid'

export { WorkflowPerformanceCard } from './WorkflowPerformanceCard'
export type { WorkflowPerformanceCardProps } from './WorkflowPerformanceCard'

export { WorkflowTimelineCard } from './WorkflowTimelineCard'
export type { WorkflowTimelineCardProps } from './WorkflowTimelineCard'

export { WorkflowTemplateVersionCard } from './WorkflowTemplateVersionCard'
export type { WorkflowTemplateVersionCardProps, TemplateVersion } from './WorkflowTemplateVersionCard'

export { OverviewView } from './OverviewView'
export type { OverviewViewProps } from './OverviewView'

export { StagesView } from './StagesView'
export type { StagesViewProps, TemplateChange } from './StagesView'

export { UniverseView } from './UniverseView'
export type { UniverseViewProps, FilterRule, DropdownOption } from './UniverseView'

export { ModelsView } from './ModelsView'
export type { ModelsViewProps, WorkflowTemplate } from './ModelsView'

export { AdminsView } from './AdminsView'
export type {
  AdminsViewProps,
  WorkflowCollaborator,
  WorkflowStakeholder,
  AccessRequest
} from './AdminsView'

export { CadenceView } from './CadenceView'
export type {
  CadenceViewProps,
  CadenceTimeframe,
  AutomationRule,
  RuleExecution,
  RuleStatus
} from './CadenceView'

export { BranchesView } from './BranchesView'
export type {
  BranchesViewProps,
  BranchStatus,
  WorkflowBranch,
  TemplateVersion
} from './BranchesView'

export { RecurringProcessesHomePanel } from './RecurringProcessesHomePanel'
export type { RecurringProcessesHomePanelProps } from './RecurringProcessesHomePanel'

export { ActiveRunsTable } from './ActiveRunsTable'
export type { ActiveRunsTableProps } from './ActiveRunsTable'

export { RunDetailPanel } from './RunDetailPanel'
export type { RunDetailPanelProps } from './RunDetailPanel'

export { AssetRunDetailPanel } from './AssetRunDetailPanel'
export type { AssetRunDetailPanelProps } from './AssetRunDetailPanel'

export { PortfolioRunDetailPanel } from './PortfolioRunDetailPanel'
export type { PortfolioRunDetailPanelProps } from './PortfolioRunDetailPanel'

export { GeneralRunDetailPanel } from './GeneralRunDetailPanel'
export type { GeneralRunDetailPanelProps } from './GeneralRunDetailPanel'

export { RunHistoryTable } from './RunHistoryTable'
export type { RunHistoryTableProps } from './RunHistoryTable'

export { RunStatusStrip } from './RunStatusStrip'
export type { RunStatusStripProps } from './RunStatusStrip'

export { RuleRow } from './RuleRow'
export type { RuleRowProps } from './RuleRow'

export { RuleSection } from './RuleSection'
export type { RuleSectionProps } from './RuleSection'
