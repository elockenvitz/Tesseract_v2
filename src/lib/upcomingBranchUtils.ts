import { addDays, addWeeks, addMonths, addQuarters, addYears, startOfMonth, startOfQuarter, startOfYear, isBefore, isAfter, parseISO } from 'date-fns'

interface WorkflowCadence {
  id: string
  name: string
  cadence_days: number
  cadence_timeframe?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'persistent'
  kickoff_cadence?: 'immediate' | 'month-start' | 'quarter-start' | 'year-start' | 'custom-date'
  kickoff_custom_date?: string
  auto_create_branch?: boolean
  auto_branch_name?: string
  template_version_number?: number | null
}

interface UpcomingBranch {
  workflowId: string
  workflowName: string
  estimatedStartDate: Date
  branchName: string
  versionNumber: number | null
}

/**
 * Calculate the next branch creation date based on workflow cadence settings
 */
export function calculateNextBranchDate(
  workflow: WorkflowCadence,
  lastBranchDate?: Date
): Date | null {
  if (!workflow.auto_create_branch) {
    return null
  }

  const now = new Date()
  const baseDate = lastBranchDate || now

  // Handle kickoff cadence for first branch
  if (!lastBranchDate) {
    switch (workflow.kickoff_cadence) {
      case 'immediate':
        return now
      case 'month-start':
        return startOfMonth(addMonths(now, 1))
      case 'quarter-start':
        return startOfQuarter(addQuarters(now, 1))
      case 'year-start':
        return startOfYear(addYears(now, 1))
      case 'custom-date':
        if (workflow.kickoff_custom_date) {
          const customDate = parseISO(workflow.kickoff_custom_date)
          return isAfter(customDate, now) ? customDate : null
        }
        return null
      default:
        return null
    }
  }

  // For subsequent branches, use cadence timeframe
  switch (workflow.cadence_timeframe) {
    case 'daily':
      return addDays(baseDate, workflow.cadence_days || 1)
    case 'weekly':
      return addWeeks(baseDate, workflow.cadence_days || 1)
    case 'monthly':
      return addMonths(baseDate, workflow.cadence_days || 1)
    case 'quarterly':
      return addQuarters(baseDate, workflow.cadence_days || 1)
    case 'semi-annually':
      return addMonths(baseDate, 6 * (workflow.cadence_days || 1))
    case 'annually':
      return addYears(baseDate, workflow.cadence_days || 1)
    case 'persistent':
      // Persistent workflows don't create new branches
      return null
    default:
      return null
  }
}

/**
 * Generate a branch name based on the workflow's auto_branch_name template
 */
export function generateBranchName(
  workflow: WorkflowCadence,
  branchDate: Date
): string {
  if (!workflow.auto_branch_name) {
    return workflow.name
  }

  const year = branchDate.getFullYear()
  const month = branchDate.getMonth() + 1
  const quarter = Math.ceil(month / 3)
  const monthName = branchDate.toLocaleString('default', { month: 'short' })

  let branchName = workflow.auto_branch_name
    .replace(/{year}/g, year.toString())
    .replace(/{quarter}/g, `Q${quarter}`)
    .replace(/{month}/g, monthName)
    .replace(/{month_num}/g, month.toString().padStart(2, '0'))

  return branchName
}

/**
 * Calculate upcoming branches for multiple workflows
 * Returns branches that will be created within the next N days
 */
export function calculateUpcomingBranches(
  workflows: WorkflowCadence[],
  lastBranchDates: Map<string, Date>,
  lookAheadDays: number = 30
): UpcomingBranch[] {
  const now = new Date()
  const cutoffDate = addDays(now, lookAheadDays)
  const upcomingBranches: UpcomingBranch[] = []

  for (const workflow of workflows) {
    if (!workflow.auto_create_branch) {
      continue
    }

    const lastBranchDate = lastBranchDates.get(workflow.id)
    const nextBranchDate = calculateNextBranchDate(workflow, lastBranchDate)

    if (nextBranchDate && isBefore(nextBranchDate, cutoffDate) && isAfter(nextBranchDate, now)) {
      upcomingBranches.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        estimatedStartDate: nextBranchDate,
        branchName: generateBranchName(workflow, nextBranchDate),
        versionNumber: workflow.template_version_number || null
      })
    }
  }

  // Sort by estimated start date
  upcomingBranches.sort((a, b) => a.estimatedStartDate.getTime() - b.estimatedStartDate.getTime())

  return upcomingBranches
}
