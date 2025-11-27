import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Filter,
  Clock, MapPin, Link as LinkIcon, X, Edit2, Trash2,
  TrendingUp, Briefcase, Tag, FolderKanban, Workflow,
  Bell, CalendarDays, CalendarClock, List, Grid3X3
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths,
  addWeeks, subWeeks, startOfDay, endOfDay, isToday, parseISO,
  addDays, getDay, isWithinInterval } from 'date-fns'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { PriorityBadge } from '../components/ui/PriorityBadge'

interface CalendarEvent {
  id: string
  title: string
  description?: string
  event_type: 'earnings_call' | 'conference' | 'deadline' | 'meeting' | 'deliverable' | 'task' | 'reminder' | 'other'
  start_date: string
  end_date?: string
  all_day: boolean
  context_type?: 'asset' | 'portfolio' | 'theme' | 'project' | 'workflow' | 'general'
  context_id?: string
  context_title?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'scheduled' | 'completed' | 'cancelled' | 'postponed'
  color?: string
  location?: string
  url?: string
  created_by?: string
  assigned_to?: string
}

interface CalendarPageProps {
  onItemSelect?: (item: any) => void
}

type ViewMode = 'month' | 'week' | 'agenda'

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  earnings_call: { label: 'Earnings Call', color: 'text-green-700', bgColor: 'bg-green-100 border-green-300', icon: <TrendingUp className="h-3 w-3" /> },
  conference: { label: 'Conference', color: 'text-purple-700', bgColor: 'bg-purple-100 border-purple-300', icon: <CalendarClock className="h-3 w-3" /> },
  deadline: { label: 'Deadline', color: 'text-red-700', bgColor: 'bg-red-100 border-red-300', icon: <Clock className="h-3 w-3" /> },
  meeting: { label: 'Meeting', color: 'text-blue-700', bgColor: 'bg-blue-100 border-blue-300', icon: <CalendarDays className="h-3 w-3" /> },
  deliverable: { label: 'Deliverable', color: 'text-amber-700', bgColor: 'bg-amber-100 border-amber-300', icon: <FolderKanban className="h-3 w-3" /> },
  task: { label: 'Task', color: 'text-slate-700', bgColor: 'bg-slate-100 border-slate-300', icon: <List className="h-3 w-3" /> },
  reminder: { label: 'Reminder', color: 'text-cyan-700', bgColor: 'bg-cyan-100 border-cyan-300', icon: <Bell className="h-3 w-3" /> },
  other: { label: 'Other', color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-300', icon: <Calendar className="h-3 w-3" /> },
}

const CONTEXT_ICONS: Record<string, React.ReactNode> = {
  asset: <TrendingUp className="h-3 w-3" />,
  portfolio: <Briefcase className="h-3 w-3" />,
  theme: <Tag className="h-3 w-3" />,
  project: <FolderKanban className="h-3 w-3" />,
  workflow: <Workflow className="h-3 w-3" />,
}

export function CalendarPage({ onItemSelect }: CalendarPageProps) {
  const queryClient = useQueryClient()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [filterEventType, setFilterEventType] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  // Form state for new/edit event
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    event_type: 'task' as CalendarEvent['event_type'],
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    all_day: false,
    context_type: '' as string,
    context_id: '',
    context_title: '',
    priority: 'medium' as CalendarEvent['priority'],
    location: '',
    url: '',
  })

  // Calculate date range for current view
  const dateRange = useMemo(() => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate)
      const monthEnd = endOfMonth(currentDate)
      return {
        start: startOfWeek(monthStart, { weekStartsOn: 0 }),
        end: endOfWeek(monthEnd, { weekStartsOn: 0 })
      }
    } else if (viewMode === 'week') {
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 0 }),
        end: endOfWeek(currentDate, { weekStartsOn: 0 })
      }
    } else {
      // Agenda view - show next 30 days
      return {
        start: startOfDay(currentDate),
        end: addDays(currentDate, 30)
      }
    }
  }, [currentDate, viewMode])

  // Fetch calendar events
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar-events', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .gte('start_date', dateRange.start.toISOString())
        .lte('start_date', dateRange.end.toISOString())
        .neq('status', 'cancelled')
        .order('start_date', { ascending: true })

      if (error) throw error
      return data as CalendarEvent[]
    }
  })

  // Fetch project deliverables with due dates
  const { data: deliverables = [] } = useQuery({
    queryKey: ['calendar-deliverables', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          id,
          title,
          due_date,
          priority,
          status,
          context_type,
          context_id
        `)
        .not('due_date', 'is', null)
        .gte('due_date', dateRange.start.toISOString())
        .lte('due_date', dateRange.end.toISOString())
        .neq('status', 'completed')
        .neq('status', 'cancelled')

      if (error) throw error

      // Transform to calendar event format
      return (data || []).map(project => ({
        id: `project-${project.id}`,
        title: project.title,
        event_type: 'deliverable' as const,
        start_date: project.due_date,
        all_day: true,
        priority: project.priority || 'medium',
        status: 'scheduled' as const,
        context_type: project.context_type,
        context_id: project.context_id,
        isProjectDeliverable: true,
        projectId: project.id
      }))
    }
  })

  // Combine events and deliverables
  const allEvents = useMemo(() => {
    let combined = [...events, ...deliverables]

    if (filterEventType !== 'all') {
      combined = combined.filter(e => e.event_type === filterEventType)
    }
    if (filterPriority !== 'all') {
      combined = combined.filter(e => e.priority === filterPriority)
    }

    return combined
  }, [events, deliverables, filterEventType, filterPriority])

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: async (event: Partial<CalendarEvent>) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('calendar_events')
        .insert([{ ...event, created_by: user?.id }])
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      resetForm()
      setShowEventModal(false)
    }
  })

  // Update event mutation
  const updateEventMutation = useMutation({
    mutationFn: async ({ id, ...event }: Partial<CalendarEvent> & { id: string }) => {
      const { data, error } = await supabase
        .from('calendar_events')
        .update(event)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      resetForm()
      setShowEventModal(false)
      setEditingEvent(null)
    }
  })

  // Delete event mutation
  const deleteEventMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('calendar_events')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      setShowEventModal(false)
      setEditingEvent(null)
    }
  })

  const resetForm = () => {
    setEventForm({
      title: '',
      description: '',
      event_type: 'task',
      start_date: '',
      start_time: '',
      end_date: '',
      end_time: '',
      all_day: false,
      context_type: '',
      context_id: '',
      context_title: '',
      priority: 'medium',
      location: '',
      url: '',
    })
  }

  const handleCreateEvent = () => {
    const startDateTime = eventForm.all_day
      ? `${eventForm.start_date}T00:00:00`
      : `${eventForm.start_date}T${eventForm.start_time || '00:00'}`

    const endDateTime = eventForm.end_date
      ? (eventForm.all_day
          ? `${eventForm.end_date}T23:59:59`
          : `${eventForm.end_date}T${eventForm.end_time || '23:59'}`)
      : undefined

    const eventData: Partial<CalendarEvent> = {
      title: eventForm.title,
      description: eventForm.description || undefined,
      event_type: eventForm.event_type,
      start_date: startDateTime,
      end_date: endDateTime,
      all_day: eventForm.all_day,
      context_type: eventForm.context_type as CalendarEvent['context_type'] || undefined,
      context_id: eventForm.context_id || undefined,
      context_title: eventForm.context_title || undefined,
      priority: eventForm.priority,
      location: eventForm.location || undefined,
      url: eventForm.url || undefined,
      status: 'scheduled'
    }

    if (editingEvent) {
      updateEventMutation.mutate({ id: editingEvent.id, ...eventData })
    } else {
      createEventMutation.mutate(eventData)
    }
  }

  const handleEditEvent = (event: CalendarEvent) => {
    const startDate = parseISO(event.start_date)
    setEventForm({
      title: event.title,
      description: event.description || '',
      event_type: event.event_type,
      start_date: format(startDate, 'yyyy-MM-dd'),
      start_time: event.all_day ? '' : format(startDate, 'HH:mm'),
      end_date: event.end_date ? format(parseISO(event.end_date), 'yyyy-MM-dd') : '',
      end_time: event.end_date && !event.all_day ? format(parseISO(event.end_date), 'HH:mm') : '',
      all_day: event.all_day,
      context_type: event.context_type || '',
      context_id: event.context_id || '',
      context_title: event.context_title || '',
      priority: event.priority,
      location: event.location || '',
      url: event.url || '',
    })
    setEditingEvent(event)
    setShowEventModal(true)
  }

  const handleDateClick = (date: Date) => {
    setSelectedDate(date)
    setEventForm(prev => ({
      ...prev,
      start_date: format(date, 'yyyy-MM-dd'),
      end_date: format(date, 'yyyy-MM-dd'),
    }))
    setShowEventModal(true)
  }

  const navigatePrevious = () => {
    if (viewMode === 'month') {
      setCurrentDate(subMonths(currentDate, 1))
    } else if (viewMode === 'week') {
      setCurrentDate(subWeeks(currentDate, 1))
    } else {
      setCurrentDate(subMonths(currentDate, 1))
    }
  }

  const navigateNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(addMonths(currentDate, 1))
    } else if (viewMode === 'week') {
      setCurrentDate(addWeeks(currentDate, 1))
    } else {
      setCurrentDate(addMonths(currentDate, 1))
    }
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  // Get events for a specific day
  const getEventsForDay = (day: Date) => {
    return allEvents.filter(event => {
      const eventDate = parseISO(event.start_date)
      return isSameDay(eventDate, day)
    })
  }

  // Generate calendar days
  const calendarDays = useMemo(() => {
    if (viewMode === 'month') {
      return eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
    } else if (viewMode === 'week') {
      return eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
    }
    return []
  }, [dateRange, viewMode])

  // Agenda view grouped events
  const agendaEvents = useMemo(() => {
    if (viewMode !== 'agenda') return []

    const grouped: { date: Date; events: typeof allEvents }[] = []
    const eventsByDate = new Map<string, typeof allEvents>()

    allEvents.forEach(event => {
      const dateKey = format(parseISO(event.start_date), 'yyyy-MM-dd')
      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, [])
      }
      eventsByDate.get(dateKey)!.push(event)
    })

    eventsByDate.forEach((events, dateKey) => {
      grouped.push({
        date: parseISO(dateKey),
        events: events.sort((a, b) =>
          new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
        )
      })
    })

    return grouped.sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [allEvents, viewMode])

  const renderEventChip = (event: typeof allEvents[0], compact = false) => {
    const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.other

    return (
      <div
        key={event.id}
        className={clsx(
          'rounded border cursor-pointer transition-all hover:shadow-sm',
          config.bgColor,
          compact ? 'px-1 py-0.5 text-xs truncate' : 'px-2 py-1 text-sm'
        )}
        onClick={(e) => {
          e.stopPropagation()
          if (!(event as any).isProjectDeliverable) {
            handleEditEvent(event as CalendarEvent)
          } else if (onItemSelect) {
            onItemSelect({
              id: (event as any).projectId,
              title: event.title,
              type: 'project',
              data: { id: (event as any).projectId }
            })
          }
        }}
        title={event.title}
      >
        <div className={clsx('flex items-center gap-1', config.color)}>
          {!compact && config.icon}
          <span className="truncate">{event.title}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Calendar</h1>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <Button variant="outline" size="sm" onClick={navigatePrevious}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={navigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
            {viewMode === 'week'
              ? `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`
              : format(currentDate, 'MMMM yyyy')
            }
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('month')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                viewMode === 'month'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              )}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                viewMode === 'week'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              )}
            >
              <CalendarDays className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                viewMode === 'agenda'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          {/* Filters */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-primary-50 border-primary-300' : ''}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
          </Button>

          {/* Add Event */}
          <Button
            onClick={() => {
              resetForm()
              setEditingEvent(null)
              setEventForm(prev => ({
                ...prev,
                start_date: format(new Date(), 'yyyy-MM-dd'),
                end_date: format(new Date(), 'yyyy-MM-dd'),
              }))
              setShowEventModal(true)
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Event
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      {showFilters && (
        <Card className="mb-4 p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Event Type:</span>
              <Select
                value={filterEventType}
                onChange={(e) => setFilterEventType(e.target.value)}
                className="w-40"
              >
                <option value="all">All Types</option>
                {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Priority:</span>
              <Select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="w-32"
              >
                <option value="all">All</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            {(filterEventType !== 'all' || filterPriority !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterEventType('all')
                  setFilterPriority('all')
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Calendar Grid / Agenda */}
      <Card className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : viewMode === 'agenda' ? (
          /* Agenda View */
          <div className="h-full overflow-y-auto p-4">
            {agendaEvents.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No upcoming events</p>
              </div>
            ) : (
              <div className="space-y-4">
                {agendaEvents.map(({ date, events }) => (
                  <div key={date.toISOString()}>
                    <div className={clsx(
                      'sticky top-0 bg-white dark:bg-gray-900 py-2 border-b border-gray-200 dark:border-gray-700',
                      isToday(date) && 'text-primary-600 font-semibold'
                    )}>
                      <span className="text-sm">
                        {isToday(date) ? 'Today' : format(date, 'EEEE, MMMM d, yyyy')}
                      </span>
                    </div>
                    <div className="space-y-2 mt-2">
                      {events.map(event => (
                        <div
                          key={event.id}
                          className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer border border-gray-100 dark:border-gray-700"
                          onClick={() => {
                            if (!(event as any).isProjectDeliverable) {
                              handleEditEvent(event as CalendarEvent)
                            } else if (onItemSelect) {
                              onItemSelect({
                                id: (event as any).projectId,
                                title: event.title,
                                type: 'project',
                                data: { id: (event as any).projectId }
                              })
                            }
                          }}
                        >
                          <div className={clsx(
                            'w-2 h-2 rounded-full mt-2 flex-shrink-0',
                            event.priority === 'urgent' && 'bg-red-500',
                            event.priority === 'high' && 'bg-orange-500',
                            event.priority === 'medium' && 'bg-blue-500',
                            event.priority === 'low' && 'bg-gray-400'
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white truncate">
                                {event.title}
                              </span>
                              <span className={clsx(
                                'text-xs px-2 py-0.5 rounded-full',
                                EVENT_TYPE_CONFIG[event.event_type]?.bgColor,
                                EVENT_TYPE_CONFIG[event.event_type]?.color
                              )}>
                                {EVENT_TYPE_CONFIG[event.event_type]?.label}
                              </span>
                            </div>
                            {!event.all_day && (
                              <div className="text-sm text-gray-500 mt-1">
                                {format(parseISO(event.start_date), 'h:mm a')}
                                {event.end_date && ` - ${format(parseISO(event.end_date), 'h:mm a')}`}
                              </div>
                            )}
                            {event.context_title && (
                              <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                {CONTEXT_ICONS[event.context_type || '']}
                                <span>{event.context_title}</span>
                              </div>
                            )}
                          </div>
                          <PriorityBadge priority={event.priority} size="sm" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Month/Week View */
          <div className="h-full flex flex-col">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className={clsx(
              'flex-1 grid grid-cols-7 overflow-y-auto',
              viewMode === 'month' ? 'grid-rows-6' : 'grid-rows-1'
            )}>
              {calendarDays.map((day, index) => {
                const dayEvents = getEventsForDay(day)
                const isCurrentMonth = isSameMonth(day, currentDate)
                const isSelected = selectedDate && isSameDay(day, selectedDate)

                return (
                  <div
                    key={day.toISOString()}
                    className={clsx(
                      'border-r border-b border-gray-100 dark:border-gray-800 p-1 min-h-[100px] cursor-pointer transition-colors',
                      !isCurrentMonth && 'bg-gray-50 dark:bg-gray-900/50',
                      isSelected && 'bg-primary-50 dark:bg-primary-900/20',
                      'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    )}
                    onClick={() => handleDateClick(day)}
                  >
                    <div className={clsx(
                      'text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full',
                      isToday(day) && 'bg-primary-600 text-white',
                      !isToday(day) && !isCurrentMonth && 'text-gray-400',
                      !isToday(day) && isCurrentMonth && 'text-gray-700 dark:text-gray-300'
                    )}>
                      {format(day, 'd')}
                    </div>
                    <div className="space-y-0.5 overflow-y-auto max-h-[80px]">
                      {dayEvents.slice(0, viewMode === 'week' ? 10 : 3).map(event => renderEventChip(event, true))}
                      {dayEvents.length > (viewMode === 'week' ? 10 : 3) && (
                        <div className="text-xs text-gray-500 px-1">
                          +{dayEvents.length - (viewMode === 'week' ? 10 : 3)} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {editingEvent ? 'Edit Event' : 'New Event'}
                </h3>
                <button
                  onClick={() => {
                    setShowEventModal(false)
                    setEditingEvent(null)
                    resetForm()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <Input
                  label="Title"
                  value={eventForm.title}
                  onChange={(e) => setEventForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Event title"
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label="Event Type"
                    value={eventForm.event_type}
                    onChange={(e) => setEventForm(prev => ({ ...prev, event_type: e.target.value as CalendarEvent['event_type'] }))}
                  >
                    {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </Select>

                  <Select
                    label="Priority"
                    value={eventForm.priority}
                    onChange={(e) => setEventForm(prev => ({ ...prev, priority: e.target.value as CalendarEvent['priority'] }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="all_day"
                    checked={eventForm.all_day}
                    onChange={(e) => setEventForm(prev => ({ ...prev, all_day: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="all_day" className="text-sm text-gray-700 dark:text-gray-300">
                    All day event
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Start Date"
                    type="date"
                    value={eventForm.start_date}
                    onChange={(e) => setEventForm(prev => ({ ...prev, start_date: e.target.value }))}
                    required
                  />
                  {!eventForm.all_day && (
                    <Input
                      label="Start Time"
                      type="time"
                      value={eventForm.start_time}
                      onChange={(e) => setEventForm(prev => ({ ...prev, start_time: e.target.value }))}
                    />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="End Date"
                    type="date"
                    value={eventForm.end_date}
                    onChange={(e) => setEventForm(prev => ({ ...prev, end_date: e.target.value }))}
                  />
                  {!eventForm.all_day && (
                    <Input
                      label="End Time"
                      type="time"
                      value={eventForm.end_time}
                      onChange={(e) => setEventForm(prev => ({ ...prev, end_time: e.target.value }))}
                    />
                  )}
                </div>

                <Input
                  label="Description"
                  value={eventForm.description}
                  onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Event description (optional)"
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Location"
                    value={eventForm.location}
                    onChange={(e) => setEventForm(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Location (optional)"
                  />
                  <Input
                    label="URL"
                    value={eventForm.url}
                    onChange={(e) => setEventForm(prev => ({ ...prev, url: e.target.value }))}
                    placeholder="Link (optional)"
                  />
                </div>

                <Select
                  label="Context (optional)"
                  value={eventForm.context_type}
                  onChange={(e) => setEventForm(prev => ({ ...prev, context_type: e.target.value }))}
                >
                  <option value="">No context</option>
                  <option value="asset">Asset</option>
                  <option value="portfolio">Portfolio</option>
                  <option value="theme">Theme</option>
                  <option value="project">Project</option>
                  <option value="workflow">Workflow</option>
                </Select>

                {eventForm.context_type && (
                  <Input
                    label="Context Title"
                    value={eventForm.context_title}
                    onChange={(e) => setEventForm(prev => ({ ...prev, context_title: e.target.value }))}
                    placeholder="e.g., AAPL, Q4 Portfolio Review"
                  />
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                {editingEvent ? (
                  <Button
                    variant="danger"
                    onClick={() => deleteEventMutation.mutate(editingEvent.id)}
                    disabled={deleteEventMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowEventModal(false)
                      setEditingEvent(null)
                      resetForm()
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateEvent}
                    disabled={!eventForm.title || !eventForm.start_date || createEventMutation.isPending || updateEventMutation.isPending}
                  >
                    {editingEvent ? 'Update' : 'Create'} Event
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
