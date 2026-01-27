import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar, ChevronLeft, ChevronRight, Plus,
  Clock, MapPin, Link as LinkIcon, X, Edit2, Trash2,
  TrendingUp, Briefcase, Tag, FolderKanban, Workflow,
  Bell, CalendarDays, CalendarClock, List, Grid3X3,
  ChevronDown, FileText, AlertCircle, Check, Users, Settings
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
import { CalendarSettings } from '../components/calendar/CalendarSettings'

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
  const [showSettings, setShowSettings] = useState(false)

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
    attendees: [] as string[],
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

          {/* Inline Filters */}
          <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-200 dark:border-gray-700">
            <Select
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
              className="w-36 text-sm"
            >
              <option value="all">All Types</option>
              {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </Select>
            <Select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="w-28 text-sm"
            >
              <option value="all">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
            {(filterEventType !== 'all' || filterPriority !== 'all') && (
              <button
                onClick={() => {
                  setFilterEventType('all')
                  setFilterPriority('all')
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Clear
              </button>
            )}
          </div>
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

          {/* Calendar Settings */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-4 w-4 mr-1" />
            Sync
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
          <div className="h-full flex flex-col overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="py-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid - equal sized cells that fill available space */}
            <div
              className="flex-1 grid grid-cols-7 overflow-hidden"
              style={{
                gridTemplateRows: viewMode === 'month'
                  ? `repeat(${Math.ceil(calendarDays.length / 7)}, minmax(0, 1fr))`
                  : 'minmax(0, 1fr)'
              }}
            >
              {calendarDays.map((day, index) => {
                const dayEvents = getEventsForDay(day)
                const isCurrentMonth = isSameMonth(day, currentDate)
                const isSelected = selectedDate && isSameDay(day, selectedDate)

                return (
                  <div
                    key={day.toISOString()}
                    className={clsx(
                      'border-r border-b border-gray-100 dark:border-gray-800 p-1.5 cursor-pointer transition-colors overflow-hidden flex flex-col',
                      !isCurrentMonth && 'bg-gray-50 dark:bg-gray-900/50',
                      isSelected && 'bg-primary-50 dark:bg-primary-900/20',
                      'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    )}
                    onClick={() => handleDateClick(day)}
                  >
                    <div className={clsx(
                      'text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0',
                      isToday(day) && 'bg-primary-600 text-white',
                      !isToday(day) && !isCurrentMonth && 'text-gray-400',
                      !isToday(day) && isCurrentMonth && 'text-gray-700 dark:text-gray-300'
                    )}>
                      {format(day, 'd')}
                    </div>
                    <div className="flex-1 space-y-0.5 overflow-y-auto min-h-0">
                      {dayEvents.slice(0, viewMode === 'week' ? 10 : 4).map(event => renderEventChip(event, true))}
                      {dayEvents.length > (viewMode === 'week' ? 10 : 4) && (
                        <div className="text-xs text-gray-500 px-1">
                          +{dayEvents.length - (viewMode === 'week' ? 10 : 4)} more
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
        <EventModal
          isOpen={showEventModal}
          editingEvent={editingEvent}
          eventForm={eventForm}
          setEventForm={setEventForm}
          onClose={() => {
            setShowEventModal(false)
            setEditingEvent(null)
            resetForm()
          }}
          onSave={handleCreateEvent}
          onDelete={editingEvent ? () => deleteEventMutation.mutate(editingEvent.id) : undefined}
          isSaving={createEventMutation.isPending || updateEventMutation.isPending}
          isDeleting={deleteEventMutation.isPending}
        />
      )}

      {/* Calendar Settings Panel */}
      <CalendarSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}

// =============================================================================
// Event Modal Component
// =============================================================================

interface EventModalProps {
  isOpen: boolean
  editingEvent: CalendarEvent | null
  eventForm: {
    title: string
    description: string
    event_type: CalendarEvent['event_type']
    start_date: string
    start_time: string
    end_date: string
    end_time: string
    all_day: boolean
    context_type: string
    context_id: string
    context_title: string
    priority: CalendarEvent['priority']
    location: string
    url: string
  }
  setEventForm: React.Dispatch<React.SetStateAction<EventModalProps['eventForm']>>
  onClose: () => void
  onSave: () => void
  onDelete?: () => void
  isSaving: boolean
  isDeleting: boolean
}

const PRIORITY_CONFIG = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-600 border-gray-200', activeColor: 'bg-gray-500 text-white border-gray-500' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-50 text-blue-600 border-blue-200', activeColor: 'bg-blue-500 text-white border-blue-500' },
  { value: 'high', label: 'High', color: 'bg-orange-50 text-orange-600 border-orange-200', activeColor: 'bg-orange-500 text-white border-orange-500' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-50 text-red-600 border-red-200', activeColor: 'bg-red-500 text-white border-red-500' },
]

// Generate time options in 15-minute increments
const TIME_OPTIONS_15 = (() => {
  const options: { value: string; label: string; hour: number }[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 15) {
      const h24 = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      const ampm = hour < 12 ? 'AM' : 'PM'
      const label = `${h12}:${min.toString().padStart(2, '0')} ${ampm}`
      options.push({ value: h24, label, hour })
    }
  }
  return options
})()

// Apple-style Scroll Wheel Time Picker
function TimePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hourRef = useRef<HTMLDivElement>(null)
  const minRef = useRef<HTMLDivElement>(null)

  const parseValue = (val: string) => {
    if (!val) return { hour: 9, minute: 0, period: 'AM' as const }
    const [h, m] = val.split(':').map(Number)
    return {
      hour: h === 0 ? 12 : h > 12 ? h - 12 : h,
      minute: m,
      period: (h < 12 ? 'AM' : 'PM') as 'AM' | 'PM'
    }
  }

  const { hour, minute, period } = parseValue(value)

  const updateTime = (h: number, m: number, p: 'AM' | 'PM') => {
    let hour24 = h
    if (p === 'PM' && h < 12) hour24 = h + 12
    if (p === 'AM' && h === 12) hour24 = 0
    onChange(`${hour24.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
  }

  const getLabel = () => {
    if (!value) return 'Set time'
    return `${hour}:${minute.toString().padStart(2, '0')} ${period}`
  }

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
  const quarterMinutes = [0, 15, 30, 45]

  const ITEM_HEIGHT = 32

  // Find closest item index (for minutes that may not be exact 5-min intervals)
  const findClosestIndex = (items: number[], value: number) => {
    let closest = 0
    let minDiff = Math.abs(items[0] - value)
    for (let i = 1; i < items.length; i++) {
      const diff = Math.abs(items[i] - value)
      if (diff < minDiff) {
        minDiff = diff
        closest = i
      }
    }
    return closest
  }

  // Circular wheel with click-based selection and wheel scroll
  const CircularWheel = ({
    items,
    selected,
    onSelect,
    scrollRef,
    width = 'w-11',
    highlightItems
  }: {
    items: number[]
    selected: number
    onSelect: (val: number) => void
    scrollRef: React.RefObject<HTMLDivElement>
    width?: string
    highlightItems?: number[]
  }) => {
    const getInitialIndex = () => {
      const exactIndex = items.indexOf(selected)
      return exactIndex !== -1 ? exactIndex : findClosestIndex(items, selected)
    }

    const [displayIndex, setDisplayIndex] = useState(getInitialIndex)

    useEffect(() => {
      const exactIndex = items.indexOf(selected)
      setDisplayIndex(exactIndex !== -1 ? exactIndex : findClosestIndex(items, selected))
    }, [selected, items])

    const len = items.length
    const prev = items[(displayIndex - 1 + len) % len]
    const curr = items[displayIndex]
    const next = items[(displayIndex + 1) % len]

    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1 : -1
      const newIndex = (displayIndex + delta + len) % len
      setDisplayIndex(newIndex)
      onSelect(items[newIndex])
    }

    const goUp = () => {
      const newIndex = (displayIndex - 1 + len) % len
      setDisplayIndex(newIndex)
      onSelect(items[newIndex])
    }

    const goDown = () => {
      const newIndex = (displayIndex + 1) % len
      setDisplayIndex(newIndex)
      onSelect(items[newIndex])
    }

    return (
      <div className={clsx('relative', width)}>
        <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white dark:from-gray-900 to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-gray-900 to-transparent z-10 pointer-events-none" />

        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className="flex flex-col items-center cursor-ns-resize select-none"
          style={{ height: ITEM_HEIGHT * 3 }}
        >
          <button
            type="button"
            onClick={goUp}
            className={clsx(
              'w-full flex items-center justify-center text-sm transition-colors',
              highlightItems?.includes(prev)
                ? 'text-gray-500 dark:text-gray-400 font-medium'
                : 'text-gray-400 dark:text-gray-500 font-normal',
              'hover:text-gray-600 dark:hover:text-gray-300'
            )}
            style={{ height: ITEM_HEIGHT }}
          >
            {prev.toString().padStart(2, '0')}
          </button>
          <div
            className="w-full flex items-center justify-center font-semibold text-gray-900 dark:text-white text-base"
            style={{ height: ITEM_HEIGHT }}
          >
            {curr.toString().padStart(2, '0')}
          </div>
          <button
            type="button"
            onClick={goDown}
            className={clsx(
              'w-full flex items-center justify-center text-sm transition-colors',
              highlightItems?.includes(next)
                ? 'text-gray-500 dark:text-gray-400 font-medium'
                : 'text-gray-400 dark:text-gray-500 font-normal',
              'hover:text-gray-600 dark:hover:text-gray-300'
            )}
            style={{ height: ITEM_HEIGHT }}
          >
            {next.toString().padStart(2, '0')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
          'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700',
          value ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
        )}
      >
        <Clock className="h-4 w-4 opacity-50" />
        <span className="tabular-nums">{getLabel()}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
            <div className="relative px-2 py-1.5">
              {/* Selection highlight */}
              <div
                className="absolute left-2 right-2 bg-gray-100 dark:bg-gray-800 rounded-lg pointer-events-none"
                style={{ top: ITEM_HEIGHT + 6, height: ITEM_HEIGHT }}
              />

              <div className="relative flex items-center">
                <CircularWheel
                  items={hours}
                  selected={hour}
                  onSelect={(h) => updateTime(h, minute, period)}
                  scrollRef={hourRef}
                />
                <span className="text-gray-300 dark:text-gray-600 font-light text-base">:</span>
                <CircularWheel
                  items={minutes}
                  selected={minute}
                  onSelect={(m) => updateTime(hour, m, period)}
                  scrollRef={minRef}
                  highlightItems={quarterMinutes}
                />
                <div className="w-px bg-gray-200 dark:bg-gray-700 mx-2 self-stretch my-2" />
                {/* AM/PM toggle - selected in middle row */}
                <div className="flex flex-col items-center w-11" style={{ height: ITEM_HEIGHT * 3 }}>
                  {/* Top slot */}
                  <button
                    type="button"
                    onClick={() => updateTime(hour, minute, period === 'AM' ? 'PM' : 'AM')}
                    className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 font-normal hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    style={{ height: ITEM_HEIGHT }}
                  >
                    {period === 'PM' ? 'AM' : ''}
                  </button>
                  {/* Middle slot - selected */}
                  <div
                    className="flex items-center justify-center font-semibold text-gray-900 dark:text-white text-base"
                    style={{ height: ITEM_HEIGHT }}
                  >
                    {period}
                  </div>
                  {/* Bottom slot */}
                  <button
                    type="button"
                    onClick={() => updateTime(hour, minute, period === 'AM' ? 'PM' : 'AM')}
                    className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 font-normal hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    style={{ height: ITEM_HEIGHT }}
                  >
                    {period === 'AM' ? 'PM' : ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EventModal({
  isOpen,
  editingEvent,
  eventForm,
  setEventForm,
  onClose,
  onSave,
  onDelete,
  isSaving,
  isDeleting
}: EventModalProps) {
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [attendeeSearch, setAttendeeSearch] = useState('')

  // Fetch users for attendees
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-calendar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
      if (error) throw error
      return data as { id: string; email: string; first_name?: string; last_name?: string }[]
    },
    enabled: isOpen
  })

  const filteredUsers = useMemo(() => {
    if (!attendeeSearch.trim()) return users
    const search = attendeeSearch.toLowerCase()
    return users.filter(u =>
      u.email?.toLowerCase().includes(search) ||
      u.first_name?.toLowerCase().includes(search) ||
      u.last_name?.toLowerCase().includes(search)
    )
  }, [users, attendeeSearch])

  // Auto-expand more options if any optional field has data
  useEffect(() => {
    if (eventForm.description || eventForm.location || eventForm.url || eventForm.context_type) {
      setShowMoreOptions(true)
    }
  }, [])

  if (!isOpen) return null

  const hasOptionalData = eventForm.description || eventForm.location || eventForm.url || eventForm.context_type

  const toggleAttendee = (userId: string) => {
    setEventForm(prev => ({
      ...prev,
      attendees: prev.attendees?.includes(userId)
        ? prev.attendees.filter(id => id !== userId)
        : [...(prev.attendees || []), userId]
    }))
  }

  const getUserDisplay = (user: { id: string; email: string; first_name?: string; last_name?: string }) => {
    if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`
    if (user.first_name) return user.first_name
    return user.email?.split('@')[0] || 'Unknown'
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingEvent ? 'Edit Event' : 'New Event'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body - fixed height with scroll, stable scrollbar */}
          <div className="px-6 py-5 space-y-6 max-h-[60vh] overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
            {/* Title Input */}
            <div>
              <input
                type="text"
                value={eventForm.title}
                onChange={(e) => setEventForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Event title"
                className="w-full text-xl font-medium px-0 py-2 border-0 border-b-2 border-gray-200 dark:border-gray-700 bg-transparent focus:border-blue-500 focus:ring-0 placeholder-gray-400 dark:text-white transition-colors"
                autoFocus
              />
            </div>

            {/* Attendees - inline with chips */}
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-gray-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Selected attendees as chips */}
                  {eventForm.attendees?.map(userId => {
                    const user = users.find(u => u.id === userId)
                    if (!user) return null
                    return (
                      <span
                        key={userId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                      >
                        {getUserDisplay(user)}
                        <button
                          type="button"
                          onClick={() => toggleAttendee(userId)}
                          className="hover:text-blue-900 dark:hover:text-blue-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                  {/* Inline search input */}
                  <div className="relative flex-1 min-w-[120px]">
                    <input
                      type="text"
                      value={attendeeSearch}
                      onChange={(e) => setAttendeeSearch(e.target.value)}
                      placeholder={eventForm.attendees?.length ? "Add more..." : "Add attendees..."}
                      className="w-full px-2 py-1 bg-transparent text-sm focus:outline-none placeholder-gray-400 dark:text-white"
                    />
                    {attendeeSearch && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">No users found</div>
                        ) : (
                          filteredUsers.filter(u => !eventForm.attendees?.includes(u.id)).slice(0, 8).map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => {
                                toggleAttendee(user.id)
                                setAttendeeSearch('')
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                            >
                              <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300">
                                {(user.first_name?.[0] || user.email?.[0] || '?').toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium">{getUserDisplay(user)}</div>
                                {user.first_name && <div className="text-xs text-gray-500">{user.email}</div>}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Event Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Event Type
              </label>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(EVENT_TYPE_CONFIG).map(([key, config]) => {
                  const isSelected = eventForm.event_type === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEventForm(prev => ({ ...prev, event_type: key as CalendarEvent['event_type'] }))}
                      className={clsx(
                        'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all',
                        isSelected
                          ? `${config.bgColor} border-current shadow-sm`
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      <div className={clsx(
                        'p-2 rounded-lg',
                        isSelected ? config.bgColor : 'bg-gray-100 dark:bg-gray-800'
                      )}>
                        <span className={isSelected ? config.color : 'text-gray-500'}>
                          {config.icon}
                        </span>
                      </div>
                      <span className={clsx(
                        'text-xs font-medium',
                        isSelected ? config.color : 'text-gray-600 dark:text-gray-400'
                      )}>
                        {config.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Date & Time Section */}
            <div className="space-y-3">
              {/* Start */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-10">Start</span>
                <input
                  type="date"
                  value={eventForm.start_date}
                  onChange={(e) => setEventForm(prev => ({ ...prev, start_date: e.target.value }))}
                  className="px-2 py-1.5 bg-transparent border-b border-gray-300 dark:border-gray-600 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                />
                {!eventForm.all_day && (
                  <TimePicker
                    value={eventForm.start_time}
                    onChange={(val) => setEventForm(prev => ({ ...prev, start_time: val }))}
                  />
                )}
                <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventForm.all_day}
                    onChange={(e) => setEventForm(prev => ({ ...prev, all_day: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">All day</span>
                </label>
              </div>

              {/* End */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-10">End</span>
                <input
                  type="date"
                  value={eventForm.end_date}
                  onChange={(e) => setEventForm(prev => ({ ...prev, end_date: e.target.value }))}
                  className="px-2 py-1.5 bg-transparent border-b border-gray-300 dark:border-gray-600 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                />
                {!eventForm.all_day && (
                  <TimePicker
                    value={eventForm.end_time}
                    onChange={(val) => setEventForm(prev => ({ ...prev, end_time: val }))}
                  />
                )}
              </div>
            </div>

            {/* Priority Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Priority
              </label>
              <div className="flex gap-2">
                {PRIORITY_CONFIG.map((priority) => {
                  const isSelected = eventForm.priority === priority.value
                  return (
                    <button
                      key={priority.value}
                      type="button"
                      onClick={() => setEventForm(prev => ({ ...prev, priority: priority.value as CalendarEvent['priority'] }))}
                      className={clsx(
                        'flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all',
                        isSelected ? priority.activeColor : priority.color
                      )}
                    >
                      {priority.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* More Options (Collapsible) */}
            <div>
              <button
                type="button"
                onClick={() => setShowMoreOptions(!showMoreOptions)}
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <ChevronDown className={clsx(
                  'h-4 w-4 transition-transform',
                  showMoreOptions && 'rotate-180'
                )} />
                <span>{showMoreOptions ? 'Less options' : 'More options'}</span>
                {hasOptionalData && !showMoreOptions && (
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                )}
              </button>

              {showMoreOptions && (
                <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Description
                    </label>
                    <textarea
                      value={eventForm.description}
                      onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Add a description..."
                      rows={3}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    />
                  </div>

                  {/* Location & URL */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Location
                      </label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          value={eventForm.location}
                          onChange={(e) => setEventForm(prev => ({ ...prev, location: e.target.value }))}
                          placeholder="Add location"
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Link
                      </label>
                      <div className="relative">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="url"
                          value={eventForm.url}
                          onChange={(e) => setEventForm(prev => ({ ...prev, url: e.target.value }))}
                          placeholder="Add URL"
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Context */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Link to
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={eventForm.context_type}
                        onChange={(e) => setEventForm(prev => ({ ...prev, context_type: e.target.value, context_title: '' }))}
                        className="w-36 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">None</option>
                        <option value="asset">Asset</option>
                        <option value="portfolio">Portfolio</option>
                        <option value="theme">Theme</option>
                        <option value="project">Project</option>
                        <option value="workflow">Workflow</option>
                      </select>
                      {eventForm.context_type && (
                        <input
                          type="text"
                          value={eventForm.context_title}
                          onChange={(e) => setEventForm(prev => ({ ...prev, context_title: e.target.value }))}
                          placeholder={`Enter ${eventForm.context_type} name...`}
                          className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
            {editingEvent && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!eventForm.title || !eventForm.start_date || isSaving}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : editingEvent ? 'Save Changes' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
