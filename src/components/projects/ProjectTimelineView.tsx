import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { scaleTime } from 'd3-scale'
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Lock,
  AlertTriangle,
  GripHorizontal
} from 'lucide-react'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
import {
  format,
  addDays,
  addWeeks,
  addMonths,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isToday,
  startOfDay,
  startOfWeek,
  startOfMonth,
  differenceInDays
} from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { ProjectWithAssignments, ProjectStatus, ProjectPriority } from '../../types/project'

interface ProjectTimelineViewProps {
  projects: ProjectWithAssignments[]
  onProjectSelect?: (project: any) => void
  blockingStatus?: Map<string, { isBlocked: boolean; blockedBy: string[]; blocking: string[] }>
}

type ZoomLevel = 'week' | 'month' | 'quarter'

const ZOOM_CONFIG: Record<ZoomLevel, {
  days: number
  unit: 'day' | 'week' | 'month'
  headerFormat: string
  subHeaderFormat?: string
}> = {
  week: { days: 7, unit: 'day', headerFormat: 'EEE', subHeaderFormat: 'd' },
  month: { days: 30, unit: 'day', headerFormat: 'd', subHeaderFormat: 'MMM yyyy' },
  quarter: { days: 90, unit: 'week', headerFormat: "'W'w", subHeaderFormat: 'MMM yyyy' }
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
  const timelineRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomLevel>('month')
  // Initial view will be adjusted after bounds are calculated
  const [viewStart, setViewStart] = useState(() => {
    const today = new Date()
    // Default: show today near the right side
    return addDays(startOfDay(today), -23) // Start ~3 weeks before today for month view
  })

  // Drag state
  const [isDragging, setIsDragging] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartDateRef = useRef<Date>(viewStart)
  const lastMoveTimeRef = useRef(0)

  // Timeline width state
  const [timelineWidth, setTimelineWidth] = useState(800)

  const config = ZOOM_CONFIG[zoom]
  const viewEnd = addDays(viewStart, config.days)

  // Track timeline panel width with resize observer
  useEffect(() => {
    const timelineEl = timelineRef.current
    if (!timelineEl) return

    const updateWidth = () => {
      const width = timelineEl.clientWidth
      if (width > 0) {
        setTimelineWidth(width)
      }
    }

    // Initial measurement
    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(timelineEl)

    return () => resizeObserver.disconnect()
  }, [])

  // Filter projects with dates and sort by start date
  const timelineProjects = useMemo(() => {
    return projects
      .filter(p => p.due_date || p.created_at)
      .sort((a, b) => {
        const aStart = a.created_at ? new Date(a.created_at) : new Date()
        const bStart = b.created_at ? new Date(b.created_at) : new Date()
        return aStart.getTime() - bStart.getTime()
      })
  }, [projects])

  // Calculate timeline bounds based on project data
  const timelineBounds = useMemo(() => {
    const today = startOfDay(new Date())

    if (timelineProjects.length === 0) {
      // Default bounds: 3 months back to 1 month ahead
      return {
        minDate: addMonths(today, -3),
        maxDate: addMonths(today, 1)
      }
    }

    // Find earliest created_at and latest due_date
    let earliest = today
    let latest = today

    timelineProjects.forEach(project => {
      const createdAt = project.created_at ? new Date(project.created_at) : today
      const dueDate = project.due_date ? new Date(project.due_date) : createdAt

      if (createdAt < earliest) earliest = createdAt
      if (dueDate > latest) latest = dueDate
      if (createdAt > latest) latest = createdAt
    })

    // Add padding: 1 week before earliest, 2 weeks after latest due date
    return {
      minDate: addDays(startOfDay(earliest), -7),
      maxDate: addDays(latest > today ? latest : today, 14)
    }
  }, [timelineProjects])

  // Fetch status change activities for all projects
  const projectIds = useMemo(() => timelineProjects.map(p => p.id), [timelineProjects])

  const { data: statusChanges } = useQuery({
    queryKey: ['project-status-changes', projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return []

      const { data, error } = await supabase
        .from('project_activity')
        .select('id, project_id, activity_type, old_value, new_value, created_at')
        .in('project_id', projectIds)
        .eq('activity_type', 'status_changed')
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: projectIds.length > 0,
    staleTime: 60000
  })

  // Group status changes by project
  const statusChangesByProject = useMemo(() => {
    const map = new Map<string, Array<{ date: Date; oldStatus: ProjectStatus; newStatus: ProjectStatus }>>()

    statusChanges?.forEach(change => {
      if (!map.has(change.project_id)) {
        map.set(change.project_id, [])
      }
      map.get(change.project_id)!.push({
        date: new Date(change.created_at),
        oldStatus: change.old_value as ProjectStatus,
        newStatus: change.new_value as ProjectStatus
      })
    })

    return map
  }, [statusChanges])

  // Generate timeline markers based on zoom level
  const timeMarkers = useMemo(() => {
    switch (config.unit) {
      case 'day':
        return eachDayOfInterval({ start: viewStart, end: viewEnd })
      case 'week':
        return eachWeekOfInterval({ start: viewStart, end: viewEnd })
      case 'month':
        return eachMonthOfInterval({ start: viewStart, end: viewEnd })
      default:
        return eachDayOfInterval({ start: viewStart, end: viewEnd })
    }
  }, [config.unit, viewStart, viewEnd])

  // Create time scale - no memoization to ensure fresh calculations on every render
  const timeScale = scaleTime()
    .domain([viewStart, viewEnd])
    .range([0, timelineWidth])

  // Constrain view start within bounds
  const constrainViewStart = useCallback((date: Date) => {
    const { minDate, maxDate } = timelineBounds
    // Don't let view start go before minDate
    if (date < minDate) return minDate
    // Don't let view end go past maxDate (view start + days = view end)
    const viewEndDate = addDays(date, config.days)
    if (viewEndDate > maxDate) {
      return addDays(maxDate, -config.days)
    }
    return date
  }, [timelineBounds, config.days])

  // Navigation handlers
  const handleNavigate = (direction: 'prev' | 'next') => {
    const multiplier = direction === 'prev' ? -1 : 1
    let newStart: Date
    switch (zoom) {
      case 'day':
        newStart = addDays(viewStart, multiplier * 1)
        break
      case 'week':
        newStart = addDays(viewStart, multiplier * 7)
        break
      case 'month':
        newStart = addDays(viewStart, multiplier * 14)
        break
      case 'quarter':
        newStart = addMonths(viewStart, multiplier * 1)
        break
      default:
        newStart = viewStart
    }
    setViewStart(constrainViewStart(newStart))
  }

  const handleZoomChange = (newZoom: ZoomLevel) => {
    // Keep the current center point when changing zoom
    const currentCenter = addDays(viewStart, config.days / 2)
    const newConfig = ZOOM_CONFIG[newZoom]
    const newStart = addDays(currentCenter, -newConfig.days / 2)
    setZoom(newZoom)
    // Constrain with new config days
    const { minDate, maxDate } = timelineBounds
    const constrainedStart = newStart < minDate ? minDate :
      addDays(newStart, newConfig.days) > maxDate ? addDays(maxDate, -newConfig.days) : newStart
    setViewStart(constrainedStart)
  }

  const handleGoToToday = () => {
    const today = startOfDay(new Date())
    // Position so today is near the right side of the view
    const newStart = addDays(today, -Math.floor(config.days * 0.75))
    setViewStart(constrainViewStart(newStart))
  }

  // Drag handlers for panning - direct state updates with throttling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click
    dragStartXRef.current = e.clientX
    dragStartDateRef.current = viewStart
    lastMoveTimeRef.current = Date.now()
    setIsDragging(true)
    e.preventDefault()
  }, [viewStart])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return

    // Throttle to ~30fps (33ms) for performance
    const now = Date.now()
    if (now - lastMoveTimeRef.current < 33) return
    lastMoveTimeRef.current = now

    const deltaX = e.clientX - dragStartXRef.current
    const msPerDay = 24 * 60 * 60 * 1000
    const msPerPixel = (config.days * msPerDay) / timelineWidth
    const msDelta = -deltaX * msPerPixel
    const newStartTime = dragStartDateRef.current.getTime() + msDelta
    const newStart = new Date(newStartTime)

    // Force synchronous update to ensure immediate re-render
    flushSync(() => {
      setViewStart(constrainViewStart(newStart))
    })
  }, [isDragging, config.days, timelineWidth, constrainViewStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

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

  // Calculate marker width based on zoom level
  const getMarkerWidth = (date: Date) => {
    switch (config.unit) {
      case 'day':
        return timeScale(addDays(date, 1)) - timeScale(date)
      case 'week':
        return timeScale(addWeeks(date, 1)) - timeScale(date)
      case 'month':
        return timeScale(addMonths(date, 1)) - timeScale(date)
      default:
        return 50
    }
  }

  // Calculate today marker position
  const todayPosition = timeScale(new Date())
  const showTodayMarker = todayPosition >= 0 && todayPosition <= timelineWidth

  // Check if at bounds
  const isAtMinBound = viewStart <= timelineBounds.minDate
  const isAtMaxBound = addDays(viewStart, config.days) >= timelineBounds.maxDate

  // Group markers by parent period for headers
  const groupedMarkers = useMemo(() => {
    if (zoom === 'week' || zoom === 'month') {
      // Group days by month
      const groups: { label: string; markers: Date[] }[] = []
      let currentGroup: { label: string; markers: Date[] } | null = null

      timeMarkers.forEach(date => {
        const monthLabel = format(date, 'MMMM yyyy')
        if (!currentGroup || currentGroup.label !== monthLabel) {
          currentGroup = { label: monthLabel, markers: [] }
          groups.push(currentGroup)
        }
        currentGroup.markers.push(date)
      })
      return groups
    } else {
      // Group weeks by quarter
      const groups: { label: string; markers: Date[] }[] = []
      let currentGroup: { label: string; markers: Date[] } | null = null

      timeMarkers.forEach(date => {
        const quarterLabel = `Q${Math.ceil((date.getMonth() + 1) / 3)} ${format(date, 'yyyy')}`
        if (!currentGroup || currentGroup.label !== quarterLabel) {
          currentGroup = { label: quarterLabel, markers: [] }
          groups.push(currentGroup)
        }
        currentGroup.markers.push(date)
      })
      return groups
    }
  }, [zoom, timeMarkers])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleNavigate('prev')}
            disabled={isAtMinBound}
            title={isAtMinBound ? 'At earliest project date' : 'View earlier'}
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
            disabled={isAtMaxBound}
            title={isAtMaxBound ? 'At current date (future not available)' : 'View later'}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          <span className="ml-4 text-sm text-gray-600 dark:text-gray-400">
            {format(viewStart, 'MMM d, yyyy')} - {format(viewEnd, 'MMM d, yyyy')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <GripHorizontal className="w-4 h-4 text-gray-400 mr-1" />
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-4">Drag to pan</span>

          <span className="text-sm text-gray-600 dark:text-gray-400 mr-2">View:</span>
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
      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full">
          {/* Left Panel - Project Names */}
          <div
            className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 sticky left-0 z-20"
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
          <div
            ref={timelineRef}
            className={clsx(
              'flex-1 relative select-none overflow-hidden',
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            {/* Time Header - uses absolute positioning like bars for consistent alignment */}
            <div
              className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-10"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Parent period row (month names, quarter names, etc.) */}
              <div className="relative h-6 border-b border-gray-100 dark:border-gray-700">
                {groupedMarkers.map((group, i) => {
                  const firstMarkerX = timeScale(group.markers[0])
                  const lastMarker = group.markers[group.markers.length - 1]
                  const lastMarkerEnd = timeScale(
                    config.unit === 'day' ? addDays(lastMarker, 1) :
                    config.unit === 'week' ? addWeeks(lastMarker, 1) :
                    addMonths(lastMarker, 1)
                  )
                  const groupWidth = lastMarkerEnd - firstMarkerX

                  // Skip if not visible
                  if (lastMarkerEnd < 0 || firstMarkerX > timelineWidth) return null

                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 flex items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-600 overflow-hidden"
                      style={{
                        left: Math.max(firstMarkerX, 0),
                        width: Math.min(groupWidth, timelineWidth - Math.max(firstMarkerX, 0))
                      }}
                    >
                      {group.label}
                    </div>
                  )
                })}
              </div>

              {/* Individual markers row */}
              <div className="relative h-[34px]">
                {timeMarkers.map((date, i) => {
                  const markerX = timeScale(date)
                  const markerWidth = getMarkerWidth(date)
                  const isTodayMarker = isToday(date)

                  // Skip if not visible
                  if (markerX + markerWidth < 0 || markerX > timelineWidth) return null

                  return (
                    <div
                      key={i}
                      className={clsx(
                        'absolute top-0 bottom-0 border-r border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center',
                        isTodayMarker && 'bg-primary-50 dark:bg-primary-900/20'
                      )}
                      style={{
                        left: markerX,
                        width: Math.max(markerWidth, 30)
                      }}
                    >
                      <span className={clsx(
                        'text-sm font-medium',
                        isTodayMarker
                          ? 'text-primary-600 dark:text-primary-400'
                          : 'text-gray-700 dark:text-gray-300'
                      )}>
                        {format(date, config.headerFormat)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Grid Lines & Today Marker */}
            <div className="absolute inset-0 pointer-events-none" style={{ top: HEADER_HEIGHT }}>
              {/* Vertical grid lines */}
              {timeMarkers.map((date, i) => {
                const x = timeScale(date)
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-px bg-gray-100 dark:bg-gray-700"
                    style={{ left: x }}
                  />
                )
              })}

              {/* Today marker line only */}
              {showTodayMarker && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                  style={{ left: todayPosition }}
                />
              )}
            </div>

            {/* Project Bars */}
            {timelineProjects.map(project => {
              const depStatus = blockingStatus?.get(project.id)
              const isBlocked = depStatus?.isBlocked ?? false
              const priorityBorder = getPriorityBorder(project.priority)

              // Calculate bar position and width using timeScale directly
              const startDate = project.created_at ? new Date(project.created_at) : new Date()
              const endDate = project.due_date ? new Date(project.due_date) : addDays(startDate, 14)

              const barLeft = timeScale(startDate)
              const barRight = timeScale(endDate)
              const barWidth = barRight - barLeft

              // Calculate progress
              const totalDeliverables = project.project_deliverables?.length || 0
              const completedDeliverables = project.project_deliverables?.filter(d => d.completed).length || 0
              const progress = totalDeliverables > 0 ? (completedDeliverables / totalDeliverables) * 100 : 0

              // Check if project is overdue
              const today = new Date()
              const dueDate = project.due_date ? new Date(project.due_date) : null
              const isOverdue = dueDate && dueDate < today && project.status !== 'completed' && project.status !== 'cancelled'

              // Get status changes for this project
              const projectStatusChanges = statusChangesByProject.get(project.id) || []

              // Build segments for the bar based on status changes
              const segments: Array<{ left: number; width: number; status: ProjectStatus }> = []

              if (projectStatusChanges.length === 0) {
                // No status changes - single bar with current status
                segments.push({
                  left: barLeft,
                  width: barWidth,
                  status: project.status
                })
              } else {
                // Build segments from status changes
                let currentStatus: ProjectStatus = projectStatusChanges[0].oldStatus || 'planning'
                let segmentStartX = barLeft

                projectStatusChanges.forEach((change) => {
                  const changeX = timeScale(change.date)
                  if (changeX > segmentStartX && changeX <= barRight) {
                    segments.push({
                      left: segmentStartX,
                      width: changeX - segmentStartX,
                      status: currentStatus
                    })
                    segmentStartX = changeX
                    currentStatus = change.newStatus
                  }
                })

                // Add final segment
                if (segmentStartX < barRight) {
                  segments.push({
                    left: segmentStartX,
                    width: barRight - segmentStartX,
                    status: currentStatus
                  })
                }
              }

              // Check visibility - skip if completely off screen
              // For overdue projects, extend the right boundary to today
              const effectiveRight = isOverdue ? timeScale(today) : barRight
              const isVisible = effectiveRight > 0 && barLeft < timelineWidth
              if (!isVisible) {
                return (
                  <div
                    key={project.id}
                    className="relative border-b border-gray-100 dark:border-gray-800"
                    style={{ height: ROW_HEIGHT }}
                  />
                )
              }

              return (
                <div
                  key={project.id}
                  className="relative border-b border-gray-100 dark:border-gray-800 overflow-x-clip overflow-y-visible"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Segmented bar - each segment colored by status at that time */}
                  {segments.map((segment, idx) => {
                    const statusColors = getStatusColor(segment.status)
                    const isFirst = idx === 0
                    const isLast = idx === segments.length - 1 && !isOverdue

                    return (
                      <div
                        key={idx}
                        className={clsx(
                          'absolute top-2 h-8',
                          statusColors.bg,
                          isFirst && 'rounded-l',
                          isLast && 'rounded-r',
                          isFirst && priorityBorder,
                          isBlocked && 'opacity-60'
                        )}
                        style={{
                          left: segment.left,
                          width: Math.max(segment.width, 2)
                        }}
                        title={`${project.title} - ${segment.status.replace('_', ' ')}`}
                      >
                        {/* Label only on first visible segment */}
                        {isFirst && segment.width > 60 && (
                          <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-white truncate">
                            {project.title}
                          </span>
                        )}
                      </div>
                    )
                  })}

                  {/* Overdue segment - striped bar from due date to today */}
                  {isOverdue && dueDate && (() => {
                    const overdueLeft = timeScale(dueDate)
                    const overdueRight = timeScale(today)
                    const overdueWidth = overdueRight - overdueLeft

                    // Skip only if width is invalid
                    if (overdueWidth <= 0) return null

                    return (
                      <div
                        className="absolute top-2 h-8 rounded-r"
                        style={{
                          left: overdueLeft,
                          width: overdueWidth,
                          background: `repeating-linear-gradient(
                            -45deg,
                            #ef4444,
                            #ef4444 4px,
                            #fca5a5 4px,
                            #fca5a5 8px
                          )`
                        }}
                        title={`${project.title} - Overdue`}
                      />
                    )
                  })()}

                  {/* Progress indicator overlay */}
                  {progress > 0 && (
                    <div
                      className="absolute top-2 h-8 bg-white/20 pointer-events-none rounded-l"
                      style={{
                        left: barLeft,
                        width: barWidth * (progress / 100)
                      }}
                    />
                  )}

                  {/* Completion indicator */}
                  {totalDeliverables > 0 && barWidth > 80 && (
                    <span
                      className="absolute top-4 text-xs text-white/80 font-medium z-10"
                      style={{ left: barRight - 30 }}
                    >
                      {completedDeliverables}/{totalDeliverables}
                    </span>
                  )}

                  {/* Blocked indicator */}
                  {isBlocked && (
                    <Lock
                      className="absolute top-4 w-3 h-3 text-white z-10"
                      style={{ left: barRight - 16 }}
                    />
                  )}

                  {/* Due date marker - MORE PROMINENT */}
                  {project.due_date && (
                    (() => {
                      const dueX = timeScale(new Date(project.due_date))
                      const isOverdue = new Date(project.due_date) < new Date() && project.status !== 'completed'
                      const isInView = dueX >= -20 && dueX <= timelineWidth + 20

                      if (!isInView) return null

                      return (
                        <div
                          className="absolute flex flex-col items-center z-20"
                          style={{ left: dueX - 12, top: -2 }}
                        >
                          {/* Diamond marker */}
                          <div
                            className={clsx(
                              'w-4 h-4 rotate-45 border-2',
                              isOverdue
                                ? 'bg-red-500 border-red-700'
                                : 'bg-amber-400 border-amber-600'
                            )}
                          />
                          {/* Date label */}
                          <span
                            className={clsx(
                              'text-[10px] font-bold mt-6 whitespace-nowrap',
                              isOverdue ? 'text-red-600' : 'text-amber-600'
                            )}
                          >
                            {format(new Date(project.due_date), 'MMM d')}
                          </span>
                        </div>
                      )
                    })()
                  )}
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
          <span className="text-gray-600 dark:text-gray-400">Blocked</span>
        </div>
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2" />
        <div className="flex items-center gap-1">
          <div className="w-0.5 h-4 bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Today</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rotate-45 bg-amber-400 border border-amber-600" />
          <span className="text-gray-600 dark:text-gray-400">Due date</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rotate-45 bg-red-500 border border-red-700" />
          <span className="text-gray-600 dark:text-gray-400">Overdue</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-6 h-3 rounded"
            style={{
              background: `repeating-linear-gradient(
                -45deg,
                #ef4444,
                #ef4444 2px,
                #fca5a5 2px,
                #fca5a5 4px
              )`
            }}
          />
          <span className="text-gray-600 dark:text-gray-400">Past due</span>
        </div>
      </div>
    </div>
  )
}
