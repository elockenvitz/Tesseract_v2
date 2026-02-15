/**
 * A4: Overdue Deliverable / Project Needs Attention — ORANGE or RED.
 *
 * Condition: project deliverable assigned to user, not completed,
 * due_date in the past. RED if >= 3 days overdue, ORANGE otherwise.
 */

import type { DecisionItem, DecisionSeverity } from '../types'

const RED_OVERDUE_DAYS = 3

export function evaluateOverdueDeliverable(data: {
  projects?: any[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.projects) return items

  for (const project of data.projects) {
    const deliverables = project.deliverables || []
    for (const d of deliverables) {
      if (d.completed || d.status === 'completed') continue
      if (!d.due_date) continue

      const dueDate = new Date(d.due_date)
      if (dueDate >= data.now) continue // not overdue

      const overdueDays = Math.floor((data.now.getTime() - dueDate.getTime()) / 86400000)
      const severity: DecisionSeverity = overdueDays >= RED_OVERDUE_DAYS ? 'red' : 'orange'

      items.push({
        id: `a4-deliverable-${d.id}`,
        surface: 'action',
        severity,
        category: 'project',
        title: d.title || 'Overdue Deliverable',
      titleKey: 'OVERDUE_DELIVERABLE',
        description: `Due ${overdueDays}d ago in ${project.name || 'project'}.`,
        chips: [
          { label: 'Project', value: project.name || 'Unknown' },
          { label: 'Overdue', value: `${overdueDays}d` },
          ...(project.priority ? [{ label: 'Priority', value: project.priority }] : []),
        ],
        context: {
          projectId: project.id,
          projectName: project.name || undefined,
          overdueDays,
        },
        ctas: [
          { label: 'Open', actionKey: 'OPEN_PROJECT', kind: 'primary', payload: { projectId: project.id, projectName: project.name } },
        ],
        dismissible: false,
        decisionTier: 'capital',
        sortScore: 0,
        createdAt: d.created_at,
      })
    }
  }

  // Limit to top 4 most overdue to avoid flooding
  items.sort((a, b) => {
    const aOverdue = parseInt(a.chips?.find(c => c.label === 'Overdue')?.value || '0')
    const bOverdue = parseInt(b.chips?.find(c => c.label === 'Overdue')?.value || '0')
    return bOverdue - aOverdue
  })

  return items.slice(0, 4)
}
