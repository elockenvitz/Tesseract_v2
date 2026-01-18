import React, { useMemo, useState, useRef, useEffect } from 'react'
import { scaleTime, scaleLinear } from 'd3-scale'
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Lock,
  AlertTriangle
} from 'lucide-react'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  addDays,
  addWeeks,
  addMonths,
  differenceInDays,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isToday,
  isSameDay
} from 'date-fns'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'

interface ProjectTimelineViewProps {
  projects: ProjectWithAssignments[]
  onProjectSelect?: (project: any) => void
  blockingStatus?: Map<string, { isBlocked: boolean; blockedBy: string[]; blocking: string[] }>
}

type ZoomLevel = 'week' | 'month' | 'quarter'

const ZOOM_CONFIG: Record<ZoomLevel, { days: number; labelFormat: string }> = {
  week: { days: 14, labelFormat: 'EEE d' },
  month: { days: 60, labelFormat: 'd' },
  quarter: { days: 180, labelFormat: 'MMM d' }
}

const ROW_HEIGHT = 48
const HEADER_HEIGHT = 60
const LEFT_PANEL_WIDTH = 280

export function ProjectTimelineView({
  projects,
  onProjectSelect,
  blockingStatus
}: ProjectTimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomLevel>('month')
  const [viewStart, setViewStart] = useState(() => {
    const today = new Date()
    return addDays(today, -7) // Start a week before today
  })

  const config = ZOOM_CONFIG[zoom]
  const viewEnd = addDays(viewStart, config.days)

  // Filter projects with dates and sort
  const timelineProjects = useMemo(() => {
    return projects
      .filter(p => p.due_date || p.created_at)
      .sort((a, b) => {
        const aStart = a.created_at ? new Date(a.created_at) : new Date()
        const bStart = b.created_at ? new Date(b.created_at) : new Date()
        return aStart.getTime() - bStart.getTime()
      })
  }, [projects])

  // Generate timeline markers based on zoom level
  const timeMarkers = useMemo(() => {
    if (zoom === 'week') {
      return eachDayOfInterval({ start: viewStart, end: viewEnd })
    } else if (zoom === 'month') {
      return eachWeekOfInterval({ start: viewStart, end: viewEnd })
    } else {
      return eachMonthOfInterval({ start: viewStart, end: viewEnd })
    }
  }, [zoom, viewStart, viewEnd])

  // Create time scale
  const timeScale = useMemo(() => {
    const width = containerRef.current?.clientWidth
      ? containerRef.current.clientWidth - LEFT_PANEL_WIDTH
      : 800

    return scaleTime()
      .domain([viewStart, viewEnd])
      .range([0, width])
  }, [viewStart, viewEnd, containerRef.current?.clientWidth])

  const handleNavigate = (direction: 'prev' | 'next') => {
    const days = direction === 'prev' ? -config.days / 2 : config.days / 2
    setViewStart(current => addDays(current, days))
  }

  const handleZoomChange = (newZoom: ZoomLevel) => {
    setZoom(newZoom)
  }

  const handleGoToToday = () => {
    setViewStart(addDays(new Date(), -7))
  }

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'planning': return { bg: 'bg-gray-400', border: 'border-gray-500' }
      case 'in_progress': return { bg: 'bg-blue-500', border: 'border-blue-600' }
      case 'blocked': return { bg: 'bg-red-500', border: 'border-red-600' }
      case 'completed': return { bg: 'bg-green-500', border: 'border-green-600' }
      case 'cancelled': return { bg: 'bg-gray-300', border: 'border-gray-400' }
    }
  }

  const getPriorityBorder = (priority: ProjectPriority) => {
    switch (priority) {
      case 'urgent': return 'ring-2 ring-red-400'
      case 'high': return 'ring-2 ring-orange-400'
      case 'medium': return ''
      case 'low': return ''
    }
  }

  // Calculate today marker position
  const todayPosition = timeScale(new Date())

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleNavigate('prev')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGoToToday}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Today
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleNavigate('next')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          <span className="ml-4 text-sm text-gray-600 dark:text-gray-400">
            {format(viewStart, 'MMM d, yyyy')} - {format(viewEnd, 'MMM d, yyyy')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400 mr-2">Zoom:</span>
          {(['week', 'month', 'quarter'] as ZoomLevel[]).map(level => (
            <Button
              key={level}
              size="sm"
              variant={zoom === level ? 'primary' : 'outline'}
              onClick={() => handleZoomChange(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Timeline Content */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        <div className="flex min-h-full">
          {/* Left Panel - Project Names */}
          <div
            className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 sticky left-0 z-10"
            style={{ width: LEFT_PANEL_WIDTH }}
          >
            {/* Header */}
            <div
              className="border-b border-gray-200 dark:border-gray-700 px-4 flex items-center font-medium text-gray-700 dark:text-gray-300"
              style={{ height: HEADER_HEIGHT }}
            >
              Projects ({timelineProjects.length})
            </div>

            {/* Project Names */}
            {timelineProjects.map(project => {
              const status = blockingStatus?.get(project.id)
              const isBlocked = status?.isBlocked ?? false
              const isBlocking = (status?.blocking?.length ?? 0) > 0

              return (
                <div
                  key={project.id}
                  className={clsx(
                    'px-4 flex items-center border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
                    isBlocked && 'bg-red-50/50 dark:bg-red-900/10'
                  )}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onProjectSelect?.({
                    id: project.id,
                    title: project.title,
                    type: 'project',
                    data: project
                  })}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isBlocked && <Lock className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                    {isBlocking && !isBlocked && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
                    <span className="truncate text-sm text-gray-900 dark:text-white">
                      {project.title}
                    </span>
                  </div>
                </div>
              )
            })}

            {timelineProjects.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No projects with dates
              </div>
            )}
          </div>

          {/* Right Panel - Timeline Bars */}
          <div className="flex-1 relative">
            {/* Time Header */}
            <div
              className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-10 flex"
              style={{ height: HEADER_HEIGHT }}
            >
              {timeMarkers.map((date, i) => {
                const isFirst = i === 0
                const markerWidth = zoom === 'week'
                  ? (timeScale(addDays(date, 1)) - timeScale(date))
                  : zoom === 'month'
                  ? (timeScale(addWeeks(date, 1)) - timeScale(date))
                  : (timeScale(addMonths(date, 1)) - timeScale(date))

                return (
                  <div
                    key={i}
                    className={clsx(
                      'flex-shrink-0 border-r border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center',
                      isToday(date) && 'bg-primary-50 dark:bg-primary-900/20'
                    )}
                    style={{ width: Math.max(markerWidth, 40) }}
                  >
                    {zoom === 'week' && (
                      <>
                        <span className="text-xs text-gray-500">{format(date, 'EEE')}</span>
                        <span className={clsx(
                          'text-sm font-medium',
                          isToday(date) ? 'text-primary-600' : 'text-gray-900 dark:text-white'
                        )}>
                          {format(date, 'd')}
                        </span>
                      </>
                    )}
                    {zoom === 'month' && (
                      <>
                        <span className="text-xs text-gray-500">{format(date, 'MMM')}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          Week {format(date, 'w')}
                        </span>
                      </>
                    )}
                    {zoom === 'quarter' && (
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {format(date, 'MMM yyyy')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Grid Lines & Today Marker */}
            <div className="absolute inset-0 pointer-events-none" style={{ top: HEADER_HEIGHT }}>
              {/* Today marker */}
              {todayPosition >= 0 && todayPosition <= (containerRef.current?.clientWidth ?? 0) - LEFT_PANEL_WIDTH && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
                  style={{ left: todayPosition }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
                </div>
              )}
            </div>

            {/* Project Bars */}
            {timelineProjects.map(project => {
              const status = blockingStatus?.get(project.id)
              const isBlocked = status?.isBlocked ?? false
              const statusColors = getStatusColor(project.status)
              const priorityBorder = getPriorityBorder(project.priority)

              // Calculate bar position and width
              const startDate = project.created_at ? new Date(project.created_at) : new Date()
              const endDate = project.due_date ? new Date(project.due_date) : addDays(startDate, 14)

              const barStart = Math.max(timeScale(startDate), 0)
              const barEnd = Math.min(timeScale(endDate), (containerRef.current?.clientWidth ?? 800) - LEFT_PANEL_WIDTH)
              const barWidth = Math.max(barEnd - barStart, 20)

              // Calculate progress
              const totalDeliverables = project.project_deliverables?.length || 0
              const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
              const progress = totalDeliverables > 0 ? (completedDeliverables / totalDeliverables) * 100 : 0

              return (
                <div
                  key={project.id}
                  className="relative border-b border-gray-100 dark:border-gray-800"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Bar */}
                  <div
                    className={clsx(
                      'absolute top-2 h-8 rounded cursor-pointer transition-all hover:shadow-md',
                      statusColors.bg,
                      priorityBorder,
                      isBlocked && 'opacity-60'
                    )}
                    style={{
                      left: barStart,
                      width: barWidth
                    }}
                    onClick={() => onProjectSelect?.({
                      id: project.id,
                      title: project.title,
                      type: 'project',
                      data: project
                    })}
                  >
                    {/* Progress Fill */}
                    {progress > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 bg-white/30 rounded-l"
                        style={{ width: `${progress}%` }}
                      />
                    )}

                    {/* Label */}
                    <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white truncate">
                      {barWidth > 60 ? project.title : ''}
                    </span>

                    {/* Blocked indicator */}
                    {isBlocked && (
                      <Lock className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-6 text-xs">
        <span className="text-gray-500 dark:text-gray-400">Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-400" />
          <span className="text-gray-600 dark:text-gray-400">Planning</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">In Progress</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Blocked</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">Completed</span>
        </div>
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2" />
        <div className="flex items-center gap-1">
          <Lock className="w-3 h-3 text-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Blocked by dependency</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-0.5 h-4 bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Today</span>
        </div>
      </div>
    </div>
  )
}
