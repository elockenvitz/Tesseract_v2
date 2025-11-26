import { AlertCircle, Clock, Zap, User, Users, CheckCircle2, FolderKanban } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { ProjectFilters } from './ProjectFilterPanel'

export interface QuickFilterPreset {
  id: string
  name: string
  icon: typeof AlertCircle
  color: string
  filters: Partial<ProjectFilters>
  count?: number
}

interface QuickFilterPresetsProps {
  onApplyPreset: (filters: Partial<ProjectFilters>) => void
  activePresetId?: string
  projectCounts?: {
    myProjects: number
    urgent: number
    dueThisWeek: number
    blocked: number
    inProgress: number
    completed: number
  }
}

export function QuickFilterPresets({
  onApplyPreset,
  activePresetId,
  projectCounts
}: QuickFilterPresetsProps) {
  const presets: QuickFilterPreset[] = [
    {
      id: 'my-projects',
      name: 'My Projects',
      icon: User,
      color: 'bg-primary-100 text-primary-700 hover:bg-primary-200',
      filters: { assignment: 'assigned' },
      count: projectCounts?.myProjects
    },
    {
      id: 'urgent',
      name: 'Urgent',
      icon: Zap,
      color: 'bg-error-100 text-error-700 hover:bg-error-200',
      filters: { priority: 'urgent', status: 'in_progress' },
      count: projectCounts?.urgent
    },
    {
      id: 'due-this-week',
      name: 'Due This Week',
      icon: Clock,
      color: 'bg-warning-100 text-warning-700 hover:bg-warning-200',
      filters: { dueDateRange: 'this_week' },
      count: projectCounts?.dueThisWeek
    },
    {
      id: 'blocked',
      name: 'Blocked',
      icon: AlertCircle,
      color: 'bg-error-100 text-error-700 hover:bg-error-200',
      filters: { status: 'blocked' },
      count: projectCounts?.blocked
    },
    {
      id: 'in-progress',
      name: 'In Progress',
      icon: FolderKanban,
      color: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
      filters: { status: 'in_progress' },
      count: projectCounts?.inProgress
    },
    {
      id: 'completed',
      name: 'Completed',
      icon: CheckCircle2,
      color: 'bg-success-100 text-success-700 hover:bg-success-200',
      filters: { status: 'completed' },
      count: projectCounts?.completed
    }
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {presets.map(preset => {
        const Icon = preset.icon
        const isActive = activePresetId === preset.id

        return (
          <button
            key={preset.id}
            onClick={() => onApplyPreset(preset.filters)}
            className={`
              flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all
              ${preset.color}
              ${isActive ? 'ring-2 ring-offset-2 ring-primary-500' : ''}
            `}
          >
            <Icon className="w-4 h-4" />
            <span>{preset.name}</span>
            {preset.count !== undefined && (
              <Badge variant="default" size="sm" className="ml-1">
                {preset.count}
              </Badge>
            )}
          </button>
        )
      })}
    </div>
  )
}
