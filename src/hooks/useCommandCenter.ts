import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, addDays, isBefore, isAfter, isToday, parseISO } from 'date-fns'

export type WorkItemType =
  | 'project'          // Active projects
  | 'deliverable'      // Project deliverables
  | 'workflow_task'    // Workflow checklist tasks
  | 'stage_deadline'   // Workflow stage deadlines
  | 'earnings'         // Earnings dates for covered assets
  | 'trade_idea'       // Trade queue items
  | 'pair_trade'       // Pair trades
  | 'personal_task'    // Personal tasks
  | 'message'          // Unread messages/mentions

export type TimeGroup = 'overdue' | 'today' | 'this_week' | 'upcoming' | 'no_date'

export interface WorkItem {
  id: string
  type: WorkItemType
  title: string
  subtitle?: string
  description?: string

  // Source context
  sourceId: string
  sourceType: string
  sourceName?: string
  sourceColor?: string

  // Dates
  dueDate?: Date
  dueTime?: string
  completedAt?: Date
  createdAt: Date

  // Priority & Status
  priority: 'critical' | 'high' | 'medium' | 'low'
  completed: boolean

  // Linked entities
  assetId?: string
  assetSymbol?: string
  projectId?: string
  projectName?: string
  workflowId?: string
  workflowName?: string

  // Assignment
  assignedTo?: string
  assignedBy?: string
  createdBy?: string

  // For UI
  timeGroup: TimeGroup
  isActionable: boolean
}

export interface CommandCenterStats {
  overdue: number
  today: number
  thisWeek: number
  upcoming: number
  total: number
  byType: Record<WorkItemType, number>
}

function getTimeGroup(dueDate?: Date): TimeGroup {
  if (!dueDate) return 'no_date'

  const now = new Date()
  const today = startOfDay(now)
  const endOfToday = endOfDay(now)
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })

  if (isBefore(dueDate, today)) return 'overdue'
  if (isBefore(dueDate, endOfToday) || isToday(dueDate)) return 'today'
  if (isBefore(dueDate, weekEnd)) return 'this_week'
  return 'upcoming'
}

function parseDateSafe(dateStr?: string | null): Date | undefined {
  if (!dateStr) return undefined
  try {
    return parseISO(dateStr)
  } catch {
    return undefined
  }
}

export function useCommandCenter() {
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['command-center'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { items: [], stats: null }

      const userId = user.id
      const items: WorkItem[] = []

      // 0. Fetch Active Projects user is involved in
      const { data: projects } = await supabase
        .from('projects')
        .select(`
          id, title, description, status, priority, due_date, created_by, created_at,
          project_assignments(assigned_to)
        `)
        .is('deleted_at', null)
        .in('status', ['planning', 'in_progress', 'review', 'blocked'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20)

      if (projects) {
        // Filter to projects user created or is assigned to
        const userProjects = projects.filter(p =>
          p.created_by === userId ||
          (p.project_assignments as any[])?.some(a => a.assigned_to === userId)
        )
        items.push(...userProjects.map(p => ({
          id: p.id,
          type: 'project' as WorkItemType,
          title: p.title,
          subtitle: p.status?.replace('_', ' '),
          description: p.description,
          sourceId: p.id,
          sourceType: 'project',
          sourceName: p.title,
          dueDate: parseDateSafe(p.due_date),
          createdAt: new Date(p.created_at),
          priority: (p.priority as WorkItem['priority']) || 'medium',
          completed: false,
          projectId: p.id,
          projectName: p.title,
          createdBy: p.created_by,
          timeGroup: getTimeGroup(parseDateSafe(p.due_date)),
          isActionable: true
        })))
      }

      // 1. Fetch Project Deliverables assigned to user or unassigned
      const { data: deliverables } = await supabase
        .from('project_deliverables')
        .select(`
          id, title, description, due_date, completed, completed_at, created_at,
          assigned_to,
          projects!inner(id, title, status, priority, created_by)
        `)
        .or(`assigned_to.eq.${userId},assigned_to.is.null`)
        .eq('completed', false)
        .order('due_date', { ascending: true, nullsFirst: false })

      if (deliverables) {
        items.push(...deliverables.map(d => ({
          id: d.id,
          type: 'deliverable' as WorkItemType,
          title: d.title,
          subtitle: (d.projects as any)?.title,
          description: d.description,
          sourceId: (d.projects as any)?.id,
          sourceType: 'project',
          sourceName: (d.projects as any)?.title,
          dueDate: parseDateSafe(d.due_date),
          createdAt: new Date(d.created_at),
          priority: (d.projects as any)?.priority || 'medium',
          completed: d.completed,
          projectId: (d.projects as any)?.id,
          projectName: (d.projects as any)?.title,
          assignedTo: d.assigned_to,
          timeGroup: getTimeGroup(parseDateSafe(d.due_date)),
          isActionable: true
        })))
      }

      // 2a. Get assets user is covering that are actively in workflows
      const { data: activeWorkflowAssets } = await supabase
        .from('asset_workflow_progress')
        .select(`
          asset_id, workflow_id,
          assets!inner(id, symbol, company_name),
          workflows!inner(id, name, color, deleted, archived)
        `)
        .eq('is_started', true)
        .eq('is_completed', false)
        .eq('workflows.deleted', false)
        .eq('workflows.archived', false)

      // Also get coverage to filter to user's assets
      const { data: userCoverage } = await supabase
        .from('coverage')
        .select('asset_id')
        .eq('user_id', userId)
        .eq('is_active', true)

      const coveredAssetIds = new Set(userCoverage?.map(c => c.asset_id) || [])

      // 2b. Fetch Workflow Checklist Tasks for covered assets in active workflows
      if (activeWorkflowAssets && activeWorkflowAssets.length > 0) {
        // Get asset/workflow combinations that are active AND covered by user
        const activeAssetWorkflows = activeWorkflowAssets.filter(
          awp => coveredAssetIds.has(awp.asset_id)
        )

        if (activeAssetWorkflows.length > 0) {
          // Get checklist items for these active asset/workflow combinations
          const { data: checklistItems } = await supabase
            .from('asset_checklist_items')
            .select(`
              id, item_text, stage_id, asset_id, workflow_id, completed, created_at
            `)
            .eq('completed', false)
            .in('asset_id', activeAssetWorkflows.map(a => a.asset_id))
            .limit(50)

          if (checklistItems) {
            // Only include items that match active asset+workflow combinations
            const activeWorkflowSet = new Set(
              activeAssetWorkflows.map(a => `${a.asset_id}|${a.workflow_id}`)
            )

            const filteredItems = checklistItems.filter(item =>
              activeWorkflowSet.has(`${item.asset_id}|${item.workflow_id}`)
            )

            // Get asset and workflow details
            const assetMap = new Map(activeAssetWorkflows.map(a => [a.asset_id, a.assets]))
            const workflowMap = new Map(activeAssetWorkflows.map(a => [a.workflow_id, a.workflows]))

            items.push(...filteredItems.map(item => {
              const asset = assetMap.get(item.asset_id) as any
              const workflow = workflowMap.get(item.workflow_id) as any
              return {
                id: item.id,
                type: 'workflow_task' as WorkItemType,
                title: item.item_text || 'Checklist Task',
                subtitle: `${asset?.symbol} - ${item.stage_id || 'Task'}`,
                sourceId: workflow?.id || asset?.id,
                sourceType: workflow ? 'workflow' : 'asset',
                sourceName: workflow?.name || asset?.symbol,
                sourceColor: workflow?.color,
                createdAt: new Date(item.created_at),
                priority: 'medium' as const,
                completed: false,
                assetId: asset?.id,
                assetSymbol: asset?.symbol,
                workflowId: workflow?.id,
                workflowName: workflow?.name,
                timeGroup: 'no_date' as TimeGroup,
                isActionable: true
              }
            }))
          }
        }
      }

      // 2c. Also fetch explicitly assigned tasks (with due dates)
      const { data: assignedTasks } = await supabase
        .from('checklist_task_assignments')
        .select(`
          id, due_date, notes, created_at,
          asset_checklist_items!inner(
            id, item_text, completed,
            assets!inner(id, symbol, company_name)
          )
        `)
        .eq('assigned_user_id', userId)
        .eq('asset_checklist_items.completed', false)

      if (assignedTasks) {
        // Add assigned tasks that aren't already in the list
        const existingTaskIds = new Set(items.filter(i => i.type === 'workflow_task').map(i => i.id))
        items.push(...assignedTasks
          .filter(t => !existingTaskIds.has((t.asset_checklist_items as any)?.id))
          .map(t => {
            const item = t.asset_checklist_items as any
            const asset = item?.assets
            return {
              id: t.id,
              type: 'workflow_task' as WorkItemType,
              title: item?.item_text || 'Checklist Task',
              subtitle: asset?.symbol,
              sourceId: asset?.id,
              sourceType: 'asset',
              sourceName: asset?.symbol,
              dueDate: parseDateSafe(t.due_date),
              createdAt: new Date(t.created_at),
              priority: 'medium' as const,
              completed: false,
              assetId: asset?.id,
              assetSymbol: asset?.symbol,
              assignedTo: userId,
              timeGroup: getTimeGroup(parseDateSafe(t.due_date)),
              isActionable: true
            }
          }))
      }

      // 3. Fetch Stage Deadlines for assets user is working on
      const { data: stageDeadlines } = await supabase
        .from('asset_stage_deadlines')
        .select(`
          id, deadline_date, notes, stage_id, created_at,
          assets!inner(id, symbol, company_name),
          workflows!inner(id, name, color)
        `)
        .gte('deadline_date', new Date().toISOString().split('T')[0])
        .order('deadline_date', { ascending: true })
        .limit(50)

      if (stageDeadlines) {
        items.push(...stageDeadlines.map(d => {
          const asset = d.assets as any
          const workflow = d.workflows as any
          return {
            id: d.id,
            type: 'stage_deadline' as WorkItemType,
            title: `${asset?.symbol} - ${d.stage_id}`,
            subtitle: workflow?.name,
            description: d.notes,
            sourceId: workflow?.id,
            sourceType: 'workflow',
            sourceName: workflow?.name,
            sourceColor: workflow?.color,
            dueDate: parseDateSafe(d.deadline_date),
            createdAt: new Date(d.created_at),
            priority: 'high' as const,
            completed: false,
            assetId: asset?.id,
            assetSymbol: asset?.symbol,
            workflowId: workflow?.id,
            workflowName: workflow?.name,
            timeGroup: getTimeGroup(parseDateSafe(d.deadline_date)),
            isActionable: true
          }
        }))
      }

      // 4. Fetch Upcoming Earnings for covered assets
      const { data: earnings } = await supabase
        .from('asset_earnings_dates')
        .select(`
          id, earnings_date, is_estimated, created_at,
          assets!inner(id, symbol, company_name)
        `)
        .gte('earnings_date', new Date().toISOString().split('T')[0])
        .order('earnings_date', { ascending: true })
        .limit(30)

      if (earnings) {
        items.push(...earnings.map(e => {
          const asset = e.assets as any
          return {
            id: e.id,
            type: 'earnings' as WorkItemType,
            title: `${asset?.symbol} Earnings`,
            subtitle: e.is_estimated ? 'Estimated' : 'Confirmed',
            sourceId: asset?.id,
            sourceType: 'asset',
            sourceName: asset?.symbol,
            dueDate: parseDateSafe(e.earnings_date),
            createdAt: new Date(e.created_at),
            priority: 'high' as const,
            completed: false,
            assetId: asset?.id,
            assetSymbol: asset?.symbol,
            timeGroup: getTimeGroup(parseDateSafe(e.earnings_date)),
            isActionable: false
          }
        }))
      }

      // 5. Fetch Trade Ideas created by user or needing review
      const { data: tradeIdeas } = await supabase
        .from('trade_queue_items')
        .select(`
          id, action, rationale, urgency, status, priority, created_at,
          expires_at, revisit_at, alert_at, created_by,
          assets!inner(id, symbol, company_name),
          portfolios(id, name)
        `)
        .in('status', ['idea', 'discussing', 'approved'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (tradeIdeas) {
        items.push(...tradeIdeas.map(t => {
          const asset = t.assets as any
          const portfolio = t.portfolios as any
          const alertDate = t.alert_at || t.revisit_at || t.expires_at
          return {
            id: t.id,
            type: 'trade_idea' as WorkItemType,
            title: `${t.action?.toUpperCase()} ${asset?.symbol}`,
            subtitle: portfolio?.name || 'Trade Idea',
            description: t.rationale,
            sourceId: portfolio?.id,
            sourceType: 'portfolio',
            sourceName: portfolio?.name,
            dueDate: parseDateSafe(alertDate),
            createdAt: new Date(t.created_at),
            priority: t.urgency === 'urgent' ? 'critical' : t.urgency === 'high' ? 'high' : 'medium',
            completed: t.status === 'executed',
            assetId: asset?.id,
            assetSymbol: asset?.symbol,
            createdBy: t.created_by,
            timeGroup: getTimeGroup(parseDateSafe(alertDate)),
            isActionable: t.status === 'idea' || t.status === 'discussing'
          }
        }))
      }

      // 6. Fetch Pair Trades
      const { data: pairTrades } = await supabase
        .from('pair_trades')
        .select(`
          id, name, description, urgency, status, created_at,
          expires_at, revisit_at, alert_at, created_by,
          portfolios(id, name)
        `)
        .in('status', ['idea', 'discussing', 'approved'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (pairTrades) {
        items.push(...pairTrades.map(t => {
          const portfolio = t.portfolios as any
          const alertDate = t.alert_at || t.revisit_at || t.expires_at
          return {
            id: t.id,
            type: 'pair_trade' as WorkItemType,
            title: t.name || 'Pair Trade',
            subtitle: portfolio?.name,
            description: t.description,
            sourceId: portfolio?.id,
            sourceType: 'portfolio',
            sourceName: portfolio?.name,
            dueDate: parseDateSafe(alertDate),
            createdAt: new Date(t.created_at),
            priority: t.urgency === 'urgent' ? 'critical' : t.urgency === 'high' ? 'high' : 'medium',
            completed: t.status === 'executed',
            createdBy: t.created_by,
            timeGroup: getTimeGroup(parseDateSafe(alertDate)),
            isActionable: t.status === 'idea' || t.status === 'discussing'
          }
        }))
      }

      // 7. Fetch Personal Tasks
      const { data: personalTasks } = await supabase
        .from('personal_tasks')
        .select(`
          id, title, description, category, priority, due_date, due_time,
          completed, created_at,
          linked_asset_id, linked_project_id, linked_workflow_id,
          assets(id, symbol),
          projects(id, title),
          workflows(id, name, color)
        `)
        .eq('user_id', userId)
        .eq('completed', false)
        .order('due_date', { ascending: true, nullsFirst: false })

      if (personalTasks) {
        items.push(...personalTasks.map(t => {
          const asset = t.assets as any
          const project = t.projects as any
          const workflow = t.workflows as any
          return {
            id: t.id,
            type: 'personal_task' as WorkItemType,
            title: t.title,
            subtitle: t.category,
            description: t.description,
            sourceId: t.id,
            sourceType: 'personal',
            sourceName: 'Personal Task',
            dueDate: parseDateSafe(t.due_date),
            dueTime: t.due_time,
            createdAt: new Date(t.created_at),
            priority: t.priority as WorkItem['priority'],
            completed: t.completed,
            assetId: asset?.id,
            assetSymbol: asset?.symbol,
            projectId: project?.id,
            projectName: project?.title,
            workflowId: workflow?.id,
            workflowName: workflow?.name,
            timeGroup: getTimeGroup(parseDateSafe(t.due_date)),
            isActionable: true
          }
        }))
      }

      // Calculate stats
      const stats: CommandCenterStats = {
        overdue: items.filter(i => i.timeGroup === 'overdue' && !i.completed).length,
        today: items.filter(i => i.timeGroup === 'today' && !i.completed).length,
        thisWeek: items.filter(i => i.timeGroup === 'this_week' && !i.completed).length,
        upcoming: items.filter(i => i.timeGroup === 'upcoming' && !i.completed).length,
        total: items.filter(i => !i.completed).length,
        byType: {
          project: items.filter(i => i.type === 'project').length,
          deliverable: items.filter(i => i.type === 'deliverable').length,
          workflow_task: items.filter(i => i.type === 'workflow_task').length,
          stage_deadline: items.filter(i => i.type === 'stage_deadline').length,
          earnings: items.filter(i => i.type === 'earnings').length,
          trade_idea: items.filter(i => i.type === 'trade_idea').length,
          pair_trade: items.filter(i => i.type === 'pair_trade').length,
          personal_task: items.filter(i => i.type === 'personal_task').length,
          message: items.filter(i => i.type === 'message').length,
        }
      }

      // Sort items: overdue first, then by due date
      items.sort((a, b) => {
        const groupOrder = { overdue: 0, today: 1, this_week: 2, upcoming: 3, no_date: 4 }
        const groupDiff = groupOrder[a.timeGroup] - groupOrder[b.timeGroup]
        if (groupDiff !== 0) return groupDiff

        // Within same group, sort by priority then date
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff

        if (a.dueDate && b.dueDate) {
          return a.dueDate.getTime() - b.dueDate.getTime()
        }
        return 0
      })

      // 8. Fetch Completed Items (last 30 days)
      const completedItems: WorkItem[] = []
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Completed deliverables
      const { data: completedDeliverables } = await supabase
        .from('project_deliverables')
        .select(`
          id, title, description, due_date, completed, completed_at, created_at,
          projects(id, title, priority)
        `)
        .eq('completed', true)
        .gte('completed_at', thirtyDaysAgo.toISOString())
        .order('completed_at', { ascending: false })
        .limit(50)

      if (completedDeliverables) {
        completedItems.push(...completedDeliverables.map(d => ({
          id: d.id,
          type: 'deliverable' as WorkItemType,
          title: d.title,
          subtitle: (d.projects as any)?.title,
          description: d.description,
          sourceId: (d.projects as any)?.id,
          sourceType: 'project',
          sourceName: (d.projects as any)?.title,
          dueDate: parseDateSafe(d.due_date),
          completedAt: parseDateSafe(d.completed_at),
          createdAt: new Date(d.created_at),
          priority: (d.projects as any)?.priority || 'medium',
          completed: true,
          projectId: (d.projects as any)?.id,
          projectName: (d.projects as any)?.title,
          timeGroup: 'no_date' as TimeGroup,
          isActionable: false
        })))
      }

      // Completed personal tasks
      const { data: completedPersonalTasks } = await supabase
        .from('personal_tasks')
        .select(`
          id, title, description, category, priority, due_date, completed_at, created_at
        `)
        .eq('user_id', userId)
        .eq('completed', true)
        .gte('completed_at', thirtyDaysAgo.toISOString())
        .order('completed_at', { ascending: false })
        .limit(50)

      if (completedPersonalTasks) {
        completedItems.push(...completedPersonalTasks.map(t => ({
          id: t.id,
          type: 'personal_task' as WorkItemType,
          title: t.title,
          subtitle: t.category,
          description: t.description,
          sourceId: t.id,
          sourceType: 'personal',
          sourceName: 'Personal Task',
          dueDate: parseDateSafe(t.due_date),
          completedAt: parseDateSafe(t.completed_at),
          createdAt: new Date(t.created_at),
          priority: t.priority as WorkItem['priority'],
          completed: true,
          timeGroup: 'no_date' as TimeGroup,
          isActionable: false
        })))
      }

      // Completed workflow tasks
      const { data: completedChecklistItems } = await supabase
        .from('asset_checklist_items')
        .select(`
          id, item_text, stage_id, completed_at, created_at,
          assets(id, symbol),
          workflows(id, name, color)
        `)
        .eq('completed', true)
        .in('asset_id', Array.from(coveredAssetIds))
        .gte('completed_at', thirtyDaysAgo.toISOString())
        .order('completed_at', { ascending: false })
        .limit(50)

      if (completedChecklistItems) {
        completedItems.push(...completedChecklistItems.map(item => {
          const asset = item.assets as any
          const workflow = item.workflows as any
          return {
            id: item.id,
            type: 'workflow_task' as WorkItemType,
            title: item.item_text || 'Checklist Task',
            subtitle: `${asset?.symbol} - ${item.stage_id || 'Task'}`,
            sourceId: workflow?.id || asset?.id,
            sourceType: workflow ? 'workflow' : 'asset',
            sourceName: workflow?.name || asset?.symbol,
            sourceColor: workflow?.color,
            completedAt: parseDateSafe(item.completed_at),
            createdAt: new Date(item.created_at),
            priority: 'medium' as const,
            completed: true,
            assetId: asset?.id,
            assetSymbol: asset?.symbol,
            workflowId: workflow?.id,
            workflowName: workflow?.name,
            timeGroup: 'no_date' as TimeGroup,
            isActionable: false
          }
        }))
      }

      // Sort completed items by completion date (most recent first)
      completedItems.sort((a, b) => {
        const aDate = (a as any).completedAt || a.createdAt
        const bDate = (b as any).completedAt || b.createdAt
        return bDate.getTime() - aDate.getTime()
      })

      return { items, completedItems, stats }
    },
    staleTime: 30000,
    refetchOnWindowFocus: true
  })

  // Mutation to complete a personal task
  const completePersonalTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-center'] })
    }
  })

  // Mutation to complete a deliverable
  const completeDeliverable = useMutation({
    mutationFn: async (deliverableId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('project_deliverables')
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: user?.id
        })
        .eq('id', deliverableId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-center'] })
    }
  })

  // Mutation to create personal task
  const createPersonalTask = useMutation({
    mutationFn: async (task: {
      title: string
      description?: string
      category?: string
      priority?: string
      due_date?: string
      linked_asset_id?: string
      linked_project_id?: string
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('personal_tasks')
        .insert({
          user_id: user.id,
          ...task
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-center'] })
    }
  })

  return {
    items: data?.items || [],
    completedItems: data?.completedItems || [],
    stats: data?.stats,
    isLoading,
    error,
    refetch,
    completePersonalTask,
    completeDeliverable,
    createPersonalTask
  }
}

// Helper to get type label
export function getWorkItemTypeLabel(type: WorkItemType): string {
  const labels: Record<WorkItemType, string> = {
    project: 'Project',
    deliverable: 'Deliverable',
    workflow_task: 'Workflow Task',
    stage_deadline: 'Stage Deadline',
    earnings: 'Earnings',
    trade_idea: 'Trade Idea',
    pair_trade: 'Pair Trade',
    personal_task: 'Task',
    message: 'Message'
  }
  return labels[type]
}

// Helper to get type color
export function getWorkItemTypeColor(type: WorkItemType): string {
  const colors: Record<WorkItemType, string> = {
    project: 'bg-violet-100 text-violet-700',
    deliverable: 'bg-purple-100 text-purple-700',
    workflow_task: 'bg-blue-100 text-blue-700',
    stage_deadline: 'bg-orange-100 text-orange-700',
    earnings: 'bg-green-100 text-green-700',
    trade_idea: 'bg-emerald-100 text-emerald-700',
    pair_trade: 'bg-teal-100 text-teal-700',
    personal_task: 'bg-gray-100 text-gray-700',
    message: 'bg-indigo-100 text-indigo-700'
  }
  return colors[type]
}

// Helper to get type icon name
export function getWorkItemTypeIcon(type: WorkItemType): string {
  const icons: Record<WorkItemType, string> = {
    project: 'FolderKanban',
    deliverable: 'FileCheck',
    workflow_task: 'CheckSquare',
    stage_deadline: 'Clock',
    earnings: 'DollarSign',
    trade_idea: 'TrendingUp',
    pair_trade: 'ArrowLeftRight',
    personal_task: 'Circle',
    message: 'MessageCircle'
  }
  return icons[type]
}
