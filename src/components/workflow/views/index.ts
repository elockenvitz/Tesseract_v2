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
export type { StagesViewProps } from './StagesView'

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
  AutomationRule
} from './CadenceView'
