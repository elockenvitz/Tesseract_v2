import { useState, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Check,
  Plus,
  Trash2,
  Edit2,
  X,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  AlertCircle,
  Save,
  Loader2,
  Star,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  GripVertical
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// ============================================================================
// TYPES
// ============================================================================

interface FieldContribution {
  id: string
  field_id: string
  asset_id: string
  user_id: string
  content: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  completedAt?: string
  completedBy?: string
}

interface TimelineEvent {
  id: string
  date: string
  title: string
  description?: string
  type: 'catalyst' | 'earnings' | 'event' | 'milestone' | 'other'
  impact?: 'positive' | 'negative' | 'neutral'
}

interface MetricValue {
  value: number
  unit?: string
  previousValue?: number
  updatedAt?: string
}

// ============================================================================
// HOOK: useFieldContribution
// ============================================================================

function useFieldContribution(fieldId: string, assetId: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: contribution, isLoading } = useQuery({
    queryKey: ['field-contribution', fieldId, assetId, user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('field_contributions')
        .select('*')
        .eq('field_id', fieldId)
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) throw error
      return data as FieldContribution | null
    },
    enabled: !!user?.id && !!fieldId && !!assetId
  })

  const saveContribution = useMutation({
    mutationFn: async ({ content, metadata }: { content?: string; metadata?: Record<string, unknown> }) => {
      if (!user?.id) throw new Error('Not authenticated')

      if (contribution) {
        // Update existing
        const { data, error } = await supabase
          .from('field_contributions')
          .update({
            content: content ?? contribution.content,
            metadata: metadata ?? contribution.metadata,
            updated_at: new Date().toISOString()
          })
          .eq('id', contribution.id)
          .select()
          .single()

        if (error) throw error
        return data
      } else {
        // Create new
        const { data, error } = await supabase
          .from('field_contributions')
          .insert({
            field_id: fieldId,
            asset_id: assetId,
            user_id: user.id,
            content: content || null,
            metadata: metadata || {}
          })
          .select()
          .single()

        if (error) throw error
        return data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-contribution', fieldId, assetId] })
    }
  })

  return {
    contribution,
    isLoading,
    saveContribution,
    isSaving: saveContribution.isPending
  }
}

// ============================================================================
// CHECKLIST FIELD
// ============================================================================

interface ChecklistFieldProps {
  fieldId: string
  assetId: string
  config?: {
    checklistType?: string
    predefinedItems?: string[]
  }
  readOnly?: boolean
}

export function ChecklistField({ fieldId, assetId, config, readOnly = false }: ChecklistFieldProps) {
  const { user } = useAuth()
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const [newItemText, setNewItemText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Parse checklist items from metadata
  const items: ChecklistItem[] = (contribution?.metadata?.items as ChecklistItem[]) || []

  const saveItems = useCallback(async (newItems: ChecklistItem[]) => {
    await saveContribution.mutateAsync({
      metadata: { ...contribution?.metadata, items: newItems }
    })
  }, [contribution?.metadata, saveContribution])

  const addItem = async () => {
    if (!newItemText.trim()) return
    const newItem: ChecklistItem = {
      id: `item-${Date.now()}`,
      text: newItemText.trim(),
      completed: false
    }
    await saveItems([...items, newItem])
    setNewItemText('')
  }

  const toggleItem = async (itemId: string) => {
    const updatedItems = items.map(item =>
      item.id === itemId
        ? {
            ...item,
            completed: !item.completed,
            completedAt: !item.completed ? new Date().toISOString() : undefined,
            completedBy: !item.completed ? user?.id : undefined
          }
        : item
    )
    await saveItems(updatedItems)
  }

  const deleteItem = async (itemId: string) => {
    await saveItems(items.filter(item => item.id !== itemId))
  }

  const updateItem = async (itemId: string, newText: string) => {
    const updatedItems = items.map(item =>
      item.id === itemId ? { ...item, text: newText } : item
    )
    await saveItems(updatedItems)
    setEditingId(null)
  }

  const completedCount = items.filter(i => i.completed).length
  const progress = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {completedCount}/{items.length} ({progress}%)
          </span>
        </div>
      )}

      {/* Checklist items */}
      <div className="space-y-1">
        {items.map(item => (
          <div
            key={item.id}
            className={clsx(
              'flex items-center gap-2 p-2 rounded-lg group',
              item.completed ? 'bg-green-50' : 'bg-gray-50 hover:bg-gray-100'
            )}
          >
            {!readOnly && (
              <button
                onClick={() => toggleItem(item.id)}
                disabled={isSaving}
                className={clsx(
                  'w-5 h-5 rounded border flex items-center justify-center transition-colors',
                  item.completed
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-gray-300 hover:border-green-500'
                )}
              >
                {item.completed && <Check className="w-3 h-3" />}
              </button>
            )}

            {editingId === item.id ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                  autoFocus
                />
                <button
                  onClick={() => updateItem(item.id, editText)}
                  className="p-1 text-green-600 hover:bg-green-100 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="p-1 text-gray-400 hover:bg-gray-200 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <span className={clsx(
                  'flex-1 text-sm',
                  item.completed && 'line-through text-gray-500'
                )}>
                  {item.text}
                </span>
                {!readOnly && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingId(item.id)
                        setEditText(item.text)
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add new item */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add new item..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            onClick={addItem}
            disabled={!newItemText.trim() || isSaving}
            className="p-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// METRIC FIELD
// ============================================================================

interface MetricFieldProps {
  fieldId: string
  assetId: string
  config?: {
    unit?: string
    format?: 'number' | 'currency' | 'percent'
    showChange?: boolean
  }
  readOnly?: boolean
}

export function MetricField({ fieldId, assetId, config, readOnly = false }: MetricFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const metricData: MetricValue = (contribution?.metadata?.metric as MetricValue) || { value: 0 }
  const unit = config?.unit || metricData.unit || ''
  const showChange = config?.showChange ?? true

  const formatValue = (value: number) => {
    if (config?.format === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }
    if (config?.format === 'percent') {
      return `${value.toFixed(2)}%`
    }
    return new Intl.NumberFormat('en-US').format(value)
  }

  const handleSave = async () => {
    const newValue = parseFloat(inputValue)
    if (isNaN(newValue)) return

    await saveContribution.mutateAsync({
      metadata: {
        ...contribution?.metadata,
        metric: {
          value: newValue,
          unit,
          previousValue: metricData.value,
          updatedAt: new Date().toISOString()
        }
      }
    })
    setIsEditing(false)
  }

  const change = metricData.previousValue !== undefined
    ? metricData.value - metricData.previousValue
    : null

  const changePercent = change !== null && metricData.previousValue
    ? (change / metricData.previousValue) * 100
    : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter value..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-lg font-medium"
            autoFocus
          />
          <span className="text-gray-500">{unit}</span>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="p-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {formatValue(metricData.value)}
              {unit && <span className="text-sm text-gray-500 ml-1">{unit}</span>}
            </div>
            {showChange && change !== null && (
              <div className={clsx(
                'flex items-center gap-1 text-sm mt-1',
                change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500'
              )}>
                {change > 0 ? <TrendingUp className="w-4 h-4" /> : change < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                <span>
                  {change > 0 ? '+' : ''}{formatValue(change)}
                  {changePercent !== null && ` (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%)`}
                </span>
              </div>
            )}
            {metricData.updatedAt && (
              <div className="text-xs text-gray-400 mt-1">
                Updated {formatDistanceToNow(parseISO(metricData.updatedAt), { addSuffix: true })}
              </div>
            )}
          </div>
          {!readOnly && (
            <button
              onClick={() => {
                setInputValue(metricData.value?.toString() || '')
                setIsEditing(true)
              }}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TIMELINE FIELD
// ============================================================================

interface TimelineFieldProps {
  fieldId: string
  assetId: string
  config?: {
    eventTypes?: string[]
  }
  readOnly?: boolean
}

export function TimelineField({ fieldId, assetId, config, readOnly = false }: TimelineFieldProps) {
  const { user } = useAuth()
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newEvent, setNewEvent] = useState<Partial<TimelineEvent>>({
    type: 'event',
    impact: 'neutral'
  })

  // Parse events from metadata
  const events: TimelineEvent[] = (contribution?.metadata?.events as TimelineEvent[]) || []
  const sortedEvents = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const saveEvents = useCallback(async (newEvents: TimelineEvent[]) => {
    await saveContribution.mutateAsync({
      metadata: { ...contribution?.metadata, events: newEvents }
    })
  }, [contribution?.metadata, saveContribution])

  const addEvent = async () => {
    if (!newEvent.date || !newEvent.title) return

    const event: TimelineEvent = {
      id: `event-${Date.now()}`,
      date: newEvent.date,
      title: newEvent.title,
      description: newEvent.description,
      type: newEvent.type || 'event',
      impact: newEvent.impact
    }

    await saveEvents([...events, event])
    setNewEvent({ type: 'event', impact: 'neutral' })
    setShowAddForm(false)
  }

  const deleteEvent = async (eventId: string) => {
    await saveEvents(events.filter(e => e.id !== eventId))
  }

  const getEventTypeColor = (type: TimelineEvent['type']) => {
    const colors = {
      catalyst: 'bg-purple-100 text-purple-700 border-purple-300',
      earnings: 'bg-blue-100 text-blue-700 border-blue-300',
      event: 'bg-gray-100 text-gray-700 border-gray-300',
      milestone: 'bg-amber-100 text-amber-700 border-amber-300',
      other: 'bg-gray-100 text-gray-700 border-gray-300'
    }
    return colors[type] || colors.other
  }

  const getImpactColor = (impact?: TimelineEvent['impact']) => {
    if (impact === 'positive') return 'text-green-600'
    if (impact === 'negative') return 'text-red-600'
    return 'text-gray-500'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Timeline events */}
      {sortedEvents.length > 0 ? (
        <div className="relative pl-6 border-l-2 border-gray-200 space-y-4">
          {sortedEvents.map(event => {
            const eventDate = parseISO(event.date)
            const isPast = eventDate < new Date()

            return (
              <div
                key={event.id}
                className={clsx(
                  'relative group',
                  isPast && 'opacity-60'
                )}
              >
                {/* Timeline dot */}
                <div className={clsx(
                  'absolute -left-[25px] w-4 h-4 rounded-full border-2 bg-white',
                  isPast ? 'border-gray-300' : 'border-primary-500'
                )} />

                <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded border',
                          getEventTypeColor(event.type)
                        )}>
                          {event.type}
                        </span>
                        <span className="text-xs text-gray-500">
                          {format(eventDate, 'MMM d, yyyy')}
                        </span>
                        {event.impact && event.impact !== 'neutral' && (
                          <span className={getImpactColor(event.impact)}>
                            {event.impact === 'positive' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-medium text-gray-900">{event.title}</h4>
                      {event.description && (
                        <p className="text-xs text-gray-500 mt-1">{event.description}</p>
                      )}
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => deleteEvent(event.id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500 text-center py-4">
          No events added yet
        </p>
      )}

      {/* Add event form */}
      {!readOnly && (
        <>
          {showAddForm ? (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={newEvent.date || ''}
                    onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type</label>
                  <select
                    value={newEvent.type || 'event'}
                    onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value as TimelineEvent['type'] })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  >
                    <option value="catalyst">Catalyst</option>
                    <option value="earnings">Earnings</option>
                    <option value="event">Event</option>
                    <option value="milestone">Milestone</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input
                  type="text"
                  value={newEvent.title || ''}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="Event title..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={newEvent.description || ''}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  placeholder="Brief description..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Expected Impact</label>
                <div className="flex gap-2">
                  {(['positive', 'neutral', 'negative'] as const).map(impact => (
                    <button
                      key={impact}
                      onClick={() => setNewEvent({ ...newEvent, impact })}
                      className={clsx(
                        'px-3 py-1 text-xs rounded-lg border transition-colors',
                        newEvent.impact === impact
                          ? impact === 'positive' ? 'bg-green-100 border-green-300 text-green-700'
                            : impact === 'negative' ? 'bg-red-100 border-red-300 text-red-700'
                            : 'bg-gray-200 border-gray-300 text-gray-700'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      {impact}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={addEvent}
                  disabled={!newEvent.date || !newEvent.title || isSaving}
                  className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Event'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2 text-sm text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg border border-dashed border-gray-300 hover:border-primary-300 transition-colors"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Event
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ============================================================================
// NUMERIC FIELD
// ============================================================================

interface NumericFieldProps {
  fieldId: string
  assetId: string
  config?: {
    unit?: string
    min?: number
    max?: number
    step?: number
  }
  readOnly?: boolean
}

export function NumericField({ fieldId, assetId, config, readOnly = false }: NumericFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const currentValue = contribution?.content ? parseFloat(contribution.content) : null

  const handleSave = async () => {
    const newValue = parseFloat(inputValue)
    if (isNaN(newValue)) return

    await saveContribution.mutateAsync({
      content: newValue.toString()
    })
    setIsEditing(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {isEditing ? (
        <>
          <input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            min={config?.min}
            max={config?.max}
            step={config?.step}
            className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            autoFocus
          />
          {config?.unit && <span className="text-sm text-gray-500">{config.unit}</span>}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-2 text-green-600 hover:bg-green-50 rounded"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-gray-900">
            {currentValue !== null ? new Intl.NumberFormat('en-US').format(currentValue) : 'Not set'}
          </span>
          {config?.unit && currentValue !== null && (
            <span className="text-sm text-gray-500">{config.unit}</span>
          )}
          {!readOnly && (
            <button
              onClick={() => {
                setInputValue(currentValue?.toString() || '')
                setIsEditing(true)
              }}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ============================================================================
// DATE FIELD
// ============================================================================

interface DateFieldProps {
  fieldId: string
  assetId: string
  config?: {
    showTime?: boolean
  }
  readOnly?: boolean
}

export function DateField({ fieldId, assetId, config, readOnly = false }: DateFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const currentValue = contribution?.content || null

  const handleSave = async () => {
    if (!inputValue) return

    await saveContribution.mutateAsync({
      content: inputValue
    })
    setIsEditing(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {isEditing ? (
        <>
          <input
            type={config?.showTime ? 'datetime-local' : 'date'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-2 text-green-600 hover:bg-green-50 rounded"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">
            {currentValue
              ? format(parseISO(currentValue), config?.showTime ? 'PPp' : 'PP')
              : 'Not set'}
          </span>
          {!readOnly && (
            <button
              onClick={() => {
                setInputValue(currentValue || '')
                setIsEditing(true)
              }}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ============================================================================
// SLIDER / GAUGE FIELD
// ============================================================================

interface SliderConfig {
  min?: number
  max?: number
  step?: number
  unit?: string
  showLabels?: boolean
  labels?: {
    min?: string
    mid?: string
    max?: string
  }
  colorMode?: 'gradient' | 'thresholds' | 'single'
  thresholds?: Array<{
    value: number
    color: string
    label?: string
  }>
  showValue?: boolean
  displayStyle?: 'slider' | 'gauge' | 'progress'
}

interface SliderMetadata {
  value: number
  previousValue?: number
  note?: string
  updatedAt: string
}

interface SliderFieldProps {
  fieldId: string
  assetId: string
  config?: SliderConfig
  readOnly?: boolean
}

export function SliderField({ fieldId, assetId, config, readOnly = false }: SliderFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const min = config?.min ?? 0
  const max = config?.max ?? 100
  const step = config?.step ?? 1
  const unit = config?.unit ?? ''
  const showValue = config?.showValue ?? true
  const displayStyle = config?.displayStyle ?? 'slider'
  const colorMode = config?.colorMode ?? 'gradient'

  const metadata = contribution?.metadata as SliderMetadata | undefined
  const [value, setValue] = useState(metadata?.value ?? min)
  const [note, setNote] = useState(metadata?.note ?? '')
  const [showNoteInput, setShowNoteInput] = useState(false)

  // Sync state when contribution loads
  useMemo(() => {
    if (metadata?.value !== undefined) {
      setValue(metadata.value)
    }
    if (metadata?.note) {
      setNote(metadata.note)
    }
  }, [metadata?.value, metadata?.note])

  const percentage = ((value - min) / (max - min)) * 100

  const getColor = (pct: number) => {
    if (colorMode === 'thresholds' && config?.thresholds) {
      const threshold = [...config.thresholds]
        .sort((a, b) => b.value - a.value)
        .find(t => value >= t.value)
      return threshold?.color || '#6B7280'
    }
    if (colorMode === 'gradient') {
      if (pct <= 33) return '#EF4444' // red
      if (pct <= 66) return '#F59E0B' // amber
      return '#10B981' // green
    }
    return '#3B82F6' // blue single color
  }

  const currentColor = getColor(percentage)

  const handleSave = async () => {
    await saveContribution.mutateAsync({
      metadata: {
        value,
        previousValue: metadata?.value,
        note: note || undefined,
        updatedAt: new Date().toISOString()
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  // Progress bar style
  if (displayStyle === 'progress') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          {showValue && (
            <span className="text-lg font-semibold text-gray-900">
              {value}{unit}
            </span>
          )}
          {metadata?.updatedAt && (
            <span className="text-xs text-gray-400">
              Updated {formatDistanceToNow(parseISO(metadata.updatedAt), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%`, backgroundColor: currentColor }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>{config?.labels?.min || min}{unit}</span>
          <span>{config?.labels?.max || max}{unit}</span>
        </div>
        {!readOnly && (
          <div className="pt-2 space-y-2">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </div>
          </div>
        )}
        {note && (
          <p className="text-sm text-gray-600 italic mt-2">"{note}"</p>
        )}
      </div>
    )
  }

  // Gauge style
  if (displayStyle === 'gauge') {
    const rotation = -90 + (percentage * 180 / 100)
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center">
          <div className="relative w-32 h-16 overflow-hidden">
            {/* Gauge background arc */}
            <div className="absolute inset-0 border-8 border-gray-200 rounded-t-full" />
            {/* Gauge colored arc */}
            <div
              className="absolute inset-0 border-8 rounded-t-full transition-all duration-300"
              style={{
                borderColor: currentColor,
                clipPath: `polygon(0 100%, 0 0, ${percentage}% 0, ${percentage}% 100%)`
              }}
            />
            {/* Needle */}
            <div
              className="absolute bottom-0 left-1/2 w-1 h-14 bg-gray-800 origin-bottom transition-transform duration-300"
              style={{ transform: `translateX(-50%) rotate(${rotation}deg)` }}
            />
            {/* Center dot */}
            <div className="absolute bottom-0 left-1/2 w-4 h-4 -translate-x-1/2 translate-y-1/2 bg-gray-800 rounded-full" />
          </div>
          {showValue && (
            <span className="text-xl font-bold text-gray-900 mt-2">
              {value}{unit}
            </span>
          )}
          <div className="flex justify-between w-32 text-xs text-gray-500 mt-1">
            <span>{config?.labels?.min || 'Low'}</span>
            <span>{config?.labels?.mid || 'Mid'}</span>
            <span>{config?.labels?.max || 'High'}</span>
          </div>
        </div>
        {!readOnly && (
          <div className="space-y-2">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        )}
        {note && (
          <p className="text-sm text-gray-600 italic text-center">"{note}"</p>
        )}
      </div>
    )
  }

  // Default slider style
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <span className="text-xs text-gray-500 w-16">
          {config?.labels?.min || min}{unit}
        </span>
        <div className="flex-1 relative">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            disabled={readOnly}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500 disabled:cursor-not-allowed"
          />
          {showValue && (
            <div
              className="absolute -top-6 px-2 py-0.5 bg-gray-800 text-white text-xs rounded transform -translate-x-1/2"
              style={{ left: `${percentage}%` }}
            >
              {value}{unit}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-500 w-16 text-right">
          {config?.labels?.max || max}{unit}
        </span>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
          <button
            onClick={() => setShowNoteInput(!showNoteInput)}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      )}

      {showNoteInput && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      )}

      {note && !showNoteInput && (
        <p className="text-sm text-gray-600 italic">"{note}"</p>
      )}

      {metadata?.updatedAt && (
        <p className="text-xs text-gray-400">
          Updated {formatDistanceToNow(parseISO(metadata.updatedAt), { addSuffix: true })}
        </p>
      )}
    </div>
  )
}

// ============================================================================
// SCORECARD FIELD
// ============================================================================

interface ScorecardCriterion {
  id: string
  name: string
  weight: number
  description?: string
}

interface ScorecardConfig {
  criteria?: ScorecardCriterion[]
  maxScore?: number
  showWeightedTotal?: boolean
  colorScale?: {
    low: string
    mid: string
    high: string
  }
}

interface ScorecardScore {
  score: number
  notes?: string
  updatedAt: string
}

interface ScorecardMetadata {
  scores: Record<string, ScorecardScore>
  weightedTotal?: number
}

interface ScorecardFieldProps {
  fieldId: string
  assetId: string
  config?: ScorecardConfig
  readOnly?: boolean
}

export function ScorecardField({ fieldId, assetId, config, readOnly = false }: ScorecardFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const maxScore = config?.maxScore ?? 5
  const showWeightedTotal = config?.showWeightedTotal ?? true

  const metadata = contribution?.metadata as ScorecardMetadata | undefined
  const [criteria, setCriteria] = useState<ScorecardCriterion[]>(
    config?.criteria ?? [
      { id: 'criterion-1', name: 'Quality', weight: 25 },
      { id: 'criterion-2', name: 'Value', weight: 25 },
      { id: 'criterion-3', name: 'Growth', weight: 25 },
      { id: 'criterion-4', name: 'Risk', weight: 25 }
    ]
  )
  const [scores, setScores] = useState<Record<string, ScorecardScore>>(metadata?.scores ?? {})
  const [newCriterionName, setNewCriterionName] = useState('')
  const [showAddCriterion, setShowAddCriterion] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  // Calculate weighted total
  const weightedTotal = useMemo(() => {
    let total = 0
    let totalWeight = 0
    criteria.forEach(c => {
      if (scores[c.id]?.score) {
        total += scores[c.id].score * c.weight
        totalWeight += c.weight
      }
    })
    return totalWeight > 0 ? total / totalWeight : 0
  }, [criteria, scores])

  const weightedPercentage = (weightedTotal / maxScore) * 100

  const getScoreColor = (score: number) => {
    const pct = (score / maxScore) * 100
    if (pct <= 33) return config?.colorScale?.low || '#EF4444'
    if (pct <= 66) return config?.colorScale?.mid || '#F59E0B'
    return config?.colorScale?.high || '#10B981'
  }

  const handleSetScore = async (criterionId: string, score: number) => {
    const newScores = {
      ...scores,
      [criterionId]: {
        ...scores[criterionId],
        score,
        updatedAt: new Date().toISOString()
      }
    }
    setScores(newScores)

    await saveContribution.mutateAsync({
      metadata: {
        scores: newScores,
        weightedTotal
      }
    })
  }

  const handleAddNote = async (criterionId: string) => {
    const newScores = {
      ...scores,
      [criterionId]: {
        ...scores[criterionId],
        notes: noteText,
        updatedAt: new Date().toISOString()
      }
    }
    setScores(newScores)
    setEditingNote(null)
    setNoteText('')

    await saveContribution.mutateAsync({
      metadata: {
        scores: newScores,
        weightedTotal
      }
    })
  }

  const handleAddCriterion = () => {
    if (!newCriterionName.trim()) return
    const newCriterion: ScorecardCriterion = {
      id: `criterion-${Date.now()}`,
      name: newCriterionName.trim(),
      weight: 20
    }
    setCriteria([...criteria, newCriterion])
    setNewCriterionName('')
    setShowAddCriterion(false)
  }

  const handleRemoveCriterion = (id: string) => {
    setCriteria(criteria.filter(c => c.id !== id))
    const newScores = { ...scores }
    delete newScores[id]
    setScores(newScores)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Criteria list */}
      <div className="space-y-2">
        {criteria.map(criterion => (
          <div
            key={criterion.id}
            className="p-3 bg-gray-50 rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{criterion.name}</span>
                <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                  {criterion.weight}%
                </span>
              </div>

              {/* Star rating */}
              <div className="flex items-center gap-1">
                {Array.from({ length: maxScore }, (_, i) => i + 1).map(starNum => (
                  <button
                    key={starNum}
                    onClick={() => !readOnly && handleSetScore(criterion.id, starNum)}
                    disabled={readOnly || isSaving}
                    className={clsx(
                      'transition-colors',
                      readOnly ? 'cursor-default' : 'hover:scale-110'
                    )}
                  >
                    <Star
                      className={clsx(
                        'w-5 h-5',
                        (scores[criterion.id]?.score ?? 0) >= starNum
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-gray-300'
                      )}
                    />
                  </button>
                ))}
                <span className="text-sm text-gray-500 ml-2">
                  {scores[criterion.id]?.score ?? 0}/{maxScore}
                </span>
              </div>
            </div>

            {/* Notes */}
            {scores[criterion.id]?.notes && editingNote !== criterion.id && (
              <p className="text-sm text-gray-600 italic pl-2 border-l-2 border-gray-300">
                {scores[criterion.id].notes}
              </p>
            )}

            {/* Note input */}
            {editingNote === criterion.id && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note..."
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                  autoFocus
                />
                <button
                  onClick={() => handleAddNote(criterion.id)}
                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setEditingNote(null); setNoteText('') }}
                  className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Actions */}
            {!readOnly && editingNote !== criterion.id && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingNote(criterion.id)
                    setNoteText(scores[criterion.id]?.notes || '')
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {scores[criterion.id]?.notes ? 'Edit note' : 'Add note'}
                </button>
                {!config?.criteria && (
                  <button
                    onClick={() => handleRemoveCriterion(criterion.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add criterion button */}
      {!readOnly && !config?.criteria && (
        <>
          {showAddCriterion ? (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <input
                type="text"
                value={newCriterionName}
                onChange={(e) => setNewCriterionName(e.target.value)}
                placeholder="Criterion name..."
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddCriterion()}
              />
              <button
                onClick={handleAddCriterion}
                disabled={!newCriterionName.trim()}
                className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setShowAddCriterion(false); setNewCriterionName('') }}
                className="p-1 text-gray-400 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddCriterion(true)}
              className="w-full py-2 text-sm text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg border border-dashed border-gray-300 hover:border-primary-300"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Criterion
            </button>
          )}
        </>
      )}

      {/* Weighted total */}
      {showWeightedTotal && criteria.some(c => scores[c.id]?.score) && (
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-gray-900">Weighted Score</span>
            <span
              className="text-lg font-bold"
              style={{ color: getScoreColor(weightedTotal) }}
            >
              {weightedTotal.toFixed(1)}/{maxScore}
            </span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${weightedPercentage}%`,
                backgroundColor: getScoreColor(weightedTotal)
              }}
            />
          </div>
          <p className="text-xs text-gray-500 text-right mt-1">
            {weightedPercentage.toFixed(0)}%
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// SCENARIO TABLE FIELD
// ============================================================================

interface ScenarioMetric {
  id: string
  name: string
  type: 'currency' | 'number' | 'percent'
  format?: string
}

interface ScenarioConfig {
  scenarios?: Array<{
    id: string
    name: string
    color: string
    probability?: number
  }>
  metrics?: ScenarioMetric[]
  showProbabilityWeighted?: boolean
  defaultScenarios?: 'bull-base-bear' | 'upside-downside' | 'custom'
}

interface ScenarioData {
  id: string
  name: string
  color: string
  probability: number
  values: Record<string, number>
  notes?: string
}

interface ScenarioMetadataType {
  scenarios: ScenarioData[]
  metrics?: ScenarioMetric[]
  probabilityWeightedValues?: Record<string, number>
  updatedAt: string
}

interface ScenarioFieldProps {
  fieldId: string
  assetId: string
  config?: ScenarioConfig
  readOnly?: boolean
}

// Scenario presets that can be selected during field creation
export const SCENARIO_PRESETS = {
  'bull-base-bear': {
    name: 'Bull / Base / Bear',
    scenarios: [
      { id: 'bull', name: 'Bull', color: '#10B981', probability: 25 },
      { id: 'base', name: 'Base', color: '#6B7280', probability: 50 },
      { id: 'bear', name: 'Bear', color: '#EF4444', probability: 25 }
    ]
  },
  'upside-downside': {
    name: 'Upside / Downside',
    scenarios: [
      { id: 'upside', name: 'Upside', color: '#10B981', probability: 50 },
      { id: 'downside', name: 'Downside', color: '#EF4444', probability: 50 }
    ]
  },
  'best-expected-worst': {
    name: 'Best / Expected / Worst',
    scenarios: [
      { id: 'best', name: 'Best Case', color: '#10B981', probability: 20 },
      { id: 'expected', name: 'Expected', color: '#3B82F6', probability: 60 },
      { id: 'worst', name: 'Worst Case', color: '#EF4444', probability: 20 }
    ]
  },
  'custom': {
    name: 'Custom (Start Empty)',
    scenarios: []
  }
}

export const METRIC_PRESETS = {
  'valuation': [
    { id: 'target_price', name: 'Target Price', type: 'currency' as const },
    { id: 'ev_ebitda', name: 'EV/EBITDA', type: 'number' as const },
    { id: 'pe_ratio', name: 'P/E Ratio', type: 'number' as const }
  ],
  'growth': [
    { id: 'revenue_growth', name: 'Revenue Growth', type: 'percent' as const },
    { id: 'earnings_growth', name: 'Earnings Growth', type: 'percent' as const },
    { id: 'margin', name: 'Margin', type: 'percent' as const }
  ],
  'returns': [
    { id: 'expected_return', name: 'Expected Return', type: 'percent' as const },
    { id: 'irr', name: 'IRR', type: 'percent' as const },
    { id: 'payback', name: 'Payback (years)', type: 'number' as const }
  ],
  'custom': []
}

export function ScenarioField({ fieldId, assetId, config, readOnly = false }: ScenarioFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const metadata = contribution?.metadata as ScenarioMetadataType | undefined
  const showProbabilityWeighted = config?.showProbabilityWeighted ?? true

  // Initialize from saved metadata, then config, then empty
  const [scenarios, setScenarios] = useState<ScenarioData[]>(
    metadata?.scenarios ?? config?.scenarios?.map(s => ({
      ...s,
      probability: s.probability ?? 33,
      values: {}
    })) ?? []
  )

  const [metrics, setMetrics] = useState<ScenarioMetric[]>(
    metadata?.metrics ?? config?.metrics ?? []
  )

  const [editingCell, setEditingCell] = useState<{ scenarioId: string; metricId: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [newMetricName, setNewMetricName] = useState('')
  const [newMetricType, setNewMetricType] = useState<'number' | 'currency' | 'percent'>('number')
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [showAddScenario, setShowAddScenario] = useState(false)
  const [newScenarioName, setNewScenarioName] = useState('')
  const [newScenarioColor, setNewScenarioColor] = useState('#6B7280')

  // Calculate probability-weighted values
  const pwValues = useMemo(() => {
    const result: Record<string, number> = {}
    metrics.forEach(m => {
      let total = 0
      scenarios.forEach(s => {
        total += (s.values[m.id] ?? 0) * (s.probability / 100)
      })
      result[m.id] = total
    })
    return result
  }, [scenarios, metrics])

  // Check if probabilities sum to 100
  const totalProbability = scenarios.reduce((sum, s) => sum + s.probability, 0)
  const probabilitiesValid = Math.abs(totalProbability - 100) < 0.01

  const formatValue = (value: number, type: string) => {
    if (type === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
    }
    if (type === 'percent') {
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
    }
    return value.toLocaleString()
  }

  const handleCellSave = async () => {
    if (!editingCell) return
    const { scenarioId, metricId } = editingCell
    const numValue = parseFloat(editValue) || 0

    const newScenarios = scenarios.map(s =>
      s.id === scenarioId
        ? { ...s, values: { ...s.values, [metricId]: numValue } }
        : s
    )
    setScenarios(newScenarios)
    setEditingCell(null)
    setEditValue('')

    await saveContribution.mutateAsync({
      metadata: {
        scenarios: newScenarios,
        metrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleProbabilityChange = async (scenarioId: string, newProb: number) => {
    const newScenarios = scenarios.map(s =>
      s.id === scenarioId ? { ...s, probability: newProb } : s
    )
    setScenarios(newScenarios)

    await saveContribution.mutateAsync({
      metadata: {
        scenarios: newScenarios,
        metrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleAddMetric = async () => {
    if (!newMetricName.trim()) return
    const newMetric: ScenarioMetric = {
      id: `metric-${Date.now()}`,
      name: newMetricName.trim(),
      type: newMetricType
    }
    const newMetrics = [...metrics, newMetric]
    setMetrics(newMetrics)
    setNewMetricName('')
    setNewMetricType('number')
    setShowAddMetric(false)

    // Persist the new metric
    await saveContribution.mutateAsync({
      metadata: {
        scenarios,
        metrics: newMetrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleAddScenario = async () => {
    if (!newScenarioName.trim()) return
    const newScenario: ScenarioData = {
      id: `scenario-${Date.now()}`,
      name: newScenarioName.trim(),
      color: newScenarioColor,
      probability: scenarios.length === 0 ? 100 : Math.floor(100 / (scenarios.length + 1)),
      values: {},
      notes: ''
    }
    const newScenarios = [...scenarios, newScenario]
    setScenarios(newScenarios)
    setNewScenarioName('')
    setNewScenarioColor('#6B7280')
    setShowAddScenario(false)

    // Persist the new scenario
    await saveContribution.mutateAsync({
      metadata: {
        scenarios: newScenarios,
        metrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleRemoveScenario = async (scenarioId: string) => {
    const newScenarios = scenarios.filter(s => s.id !== scenarioId)
    setScenarios(newScenarios)

    await saveContribution.mutateAsync({
      metadata: {
        scenarios: newScenarios,
        metrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleRemoveMetric = async (metricId: string) => {
    const newMetrics = metrics.filter(m => m.id !== metricId)
    setMetrics(newMetrics)

    await saveContribution.mutateAsync({
      metadata: {
        scenarios,
        metrics: newMetrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleSaveNote = async (scenarioId: string) => {
    const newScenarios = scenarios.map(s =>
      s.id === scenarioId ? { ...s, notes: noteText } : s
    )
    setScenarios(newScenarios)
    setEditingNote(null)
    setNoteText('')

    await saveContribution.mutateAsync({
      metadata: {
        scenarios: newScenarios,
        metrics,
        probabilityWeightedValues: pwValues,
        updatedAt: new Date().toISOString()
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  // Color presets for new scenarios
  const colorPresets = ['#10B981', '#3B82F6', '#6B7280', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4']

  // Empty state - no scenarios or metrics yet
  if (scenarios.length === 0 && metrics.length === 0 && !readOnly) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500 mb-4">Create your scenario analysis by adding scenarios and metrics</p>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setShowAddScenario(true)}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Scenario
            </button>
            <button
              onClick={() => setShowAddMetric(true)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Metric
            </button>
          </div>
        </div>

        {/* Add Scenario Dialog */}
        {showAddScenario && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <h4 className="font-medium text-sm">Add Scenario</h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                placeholder="Scenario name (e.g., Bull Case)"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                autoFocus
              />
              <div className="flex gap-1">
                {colorPresets.slice(0, 4).map(color => (
                  <button
                    key={color}
                    onClick={() => setNewScenarioColor(color)}
                    className={clsx(
                      'w-8 h-8 rounded-lg border-2',
                      newScenarioColor === color ? 'border-gray-800' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddScenario}
                disabled={!newScenarioName.trim()}
                className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
              >
                Add Scenario
              </button>
              <button
                onClick={() => { setShowAddScenario(false); setNewScenarioName('') }}
                className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add Metric Dialog */}
        {showAddMetric && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <h4 className="font-medium text-sm">Add Metric</h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMetricName}
                onChange={(e) => setNewMetricName(e.target.value)}
                placeholder="Metric name (e.g., Revenue Growth)"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                autoFocus
              />
              <select
                value={newMetricType}
                onChange={(e) => setNewMetricType(e.target.value as any)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                <option value="number">Number</option>
                <option value="currency">Currency ($)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddMetric}
                disabled={!newMetricName.trim()}
                className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
              >
                Add Metric
              </button>
              <button
                onClick={() => { setShowAddMetric(false); setNewMetricName('') }}
                className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Probability warning */}
      {scenarios.length > 0 && !probabilitiesValid && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 text-amber-700 text-sm rounded-lg">
          <AlertCircle className="w-4 h-4" />
          Probabilities should sum to 100% (currently {totalProbability.toFixed(0)}%)
        </div>
      )}

      {/* Scenario table */}
      {(scenarios.length > 0 || metrics.length > 0) && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-700 w-32"></th>
                {scenarios.map(scenario => (
                  <th
                    key={scenario.id}
                    className="text-center py-2 px-3 font-medium min-w-[100px] group"
                    style={{ color: scenario.color }}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {scenario.name}
                      {!readOnly && (
                        <button
                          onClick={() => handleRemoveScenario(scenario.id)}
                          className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {!readOnly ? (
                        <input
                          type="number"
                          value={scenario.probability}
                          onChange={(e) => handleProbabilityChange(scenario.id, Number(e.target.value))}
                          className="w-12 text-center text-xs px-1 py-0.5 border border-gray-300 rounded"
                          min={0}
                          max={100}
                        />
                      ) : (
                        <span className="text-xs text-gray-500">({scenario.probability}%)</span>
                      )}
                      {!readOnly && <span className="text-xs text-gray-400">%</span>}
                    </div>
                  </th>
                ))}
                {!readOnly && (
                  <th className="py-2 px-2 w-10">
                    <button
                      onClick={() => setShowAddScenario(true)}
                      className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded"
                      title="Add scenario"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </th>
                )}
                {showProbabilityWeighted && scenarios.length > 0 && (
                  <th className="text-center py-2 px-3 font-medium text-gray-700 bg-gray-50 min-w-[100px]">
                    PW Avg
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {metrics.map(metric => (
                <tr key={metric.id} className="border-b border-gray-100 group">
                  <td className="py-2 px-3 text-gray-700 font-medium">
                    <div className="flex items-center gap-1">
                      {metric.name}
                      {!readOnly && (
                        <button
                          onClick={() => handleRemoveMetric(metric.id)}
                          className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  {scenarios.map(scenario => (
                    <td key={scenario.id} className="py-2 px-3 text-center">
                      {editingCell?.scenarioId === scenario.id && editingCell?.metricId === metric.id ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleCellSave}
                          onKeyDown={(e) => e.key === 'Enter' && handleCellSave()}
                          className="w-20 text-center px-2 py-1 border border-primary-300 rounded"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => {
                            if (!readOnly) {
                              setEditingCell({ scenarioId: scenario.id, metricId: metric.id })
                              setEditValue(scenario.values[metric.id]?.toString() || '')
                            }
                          }}
                          disabled={readOnly}
                          className={clsx(
                            'px-2 py-1 rounded transition-colors',
                            !readOnly && 'hover:bg-gray-100',
                            scenario.values[metric.id] !== undefined ? 'text-gray-900' : 'text-gray-400'
                          )}
                        >
                          {scenario.values[metric.id] !== undefined
                            ? formatValue(scenario.values[metric.id], metric.type)
                            : '-'}
                        </button>
                      )}
                    </td>
                  ))}
                  {!readOnly && <td className="py-2 px-2 w-10"></td>}
                  {showProbabilityWeighted && scenarios.length > 0 && (
                    <td className="py-2 px-3 text-center bg-gray-50 font-medium">
                      {pwValues[metric.id] !== undefined && pwValues[metric.id] !== 0
                        ? formatValue(pwValues[metric.id], metric.type)
                        : '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Scenario Dialog */}
      {showAddScenario && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <h4 className="font-medium text-sm">Add Scenario</h4>
          <div className="flex gap-2">
            <input
              type="text"
              value={newScenarioName}
              onChange={(e) => setNewScenarioName(e.target.value)}
              placeholder="Scenario name (e.g., Bull Case)"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
              autoFocus
            />
            <div className="flex gap-1">
              {colorPresets.slice(0, 4).map(color => (
                <button
                  key={color}
                  onClick={() => setNewScenarioColor(color)}
                  className={clsx(
                    'w-8 h-8 rounded-lg border-2',
                    newScenarioColor === color ? 'border-gray-800' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddScenario}
              disabled={!newScenarioName.trim()}
              className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
            >
              Add Scenario
            </button>
            <button
              onClick={() => { setShowAddScenario(false); setNewScenarioName('') }}
              className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add metric button */}
      {!readOnly && (
        <>
          {showAddMetric ? (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <h4 className="font-medium text-sm">Add Metric</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMetricName}
                  onChange={(e) => setNewMetricName(e.target.value)}
                  placeholder="Metric name (e.g., Revenue Growth)"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  autoFocus
                />
                <select
                  value={newMetricType}
                  onChange={(e) => setNewMetricType(e.target.value as any)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="number">Number</option>
                  <option value="currency">Currency ($)</option>
                  <option value="percent">Percent (%)</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddMetric}
                  disabled={!newMetricName.trim()}
                  className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
                >
                  Add Metric
                </button>
                <button
                  onClick={() => { setShowAddMetric(false); setNewMetricName('') }}
                  className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddMetric(true)}
              className="text-sm text-gray-500 hover:text-primary-600"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Metric
            </button>
          )}
        </>
      )}

      {/* Scenario notes */}
      <div className="space-y-2 pt-2 border-t border-gray-200">
        {scenarios.map(scenario => (
          <div key={scenario.id}>
            {editingNote === scenario.id ? (
              <div className="flex items-start gap-2">
                <span className="font-medium text-sm" style={{ color: scenario.color }}>
                  {scenario.name}:
                </span>
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={`${scenario.name} case thesis...`}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                  autoFocus
                />
                <button
                  onClick={() => handleSaveNote(scenario.id)}
                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setEditingNote(null); setNoteText('') }}
                  className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : scenario.notes ? (
              <p className="text-sm">
                <span className="font-medium" style={{ color: scenario.color }}>
                  {scenario.name}:
                </span>{' '}
                <span className="text-gray-600">{scenario.notes}</span>
                {!readOnly && (
                  <button
                    onClick={() => { setEditingNote(scenario.id); setNoteText(scenario.notes || '') }}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                  >
                    <Edit2 className="w-3 h-3 inline" />
                  </button>
                )}
              </p>
            ) : !readOnly && (
              <button
                onClick={() => { setEditingNote(scenario.id); setNoteText('') }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add {scenario.name.toLowerCase()} case notes
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// SPREADSHEET FIELD
// ============================================================================

interface SpreadsheetColumn {
  id: string
  name: string
  type: 'text' | 'number' | 'currency' | 'percent' | 'formula'
  width?: number
  format?: string
}

interface SpreadsheetRow {
  id: string
  cells: Record<string, { value: string | number; formula?: string }>
}

interface SpreadsheetConfig {
  columns?: SpreadsheetColumn[]
  defaultRows?: number
  maxRows?: number
  showRowNumbers?: boolean
  allowAddRows?: boolean
  allowAddColumns?: boolean
  frozenColumns?: number
}

interface SpreadsheetMetadataType {
  columns: SpreadsheetColumn[]
  rows: SpreadsheetRow[]
  updatedAt: string
}

interface SpreadsheetFieldProps {
  fieldId: string
  assetId: string
  config?: SpreadsheetConfig
  readOnly?: boolean
}

// Simple formula evaluator
function evaluateFormula(
  formula: string,
  rows: SpreadsheetRow[],
  columns: SpreadsheetColumn[],
  currentRowIndex: number
): number {
  if (!formula.startsWith('=')) return parseFloat(formula) || 0

  const expr = formula.substring(1).toUpperCase()

  // Get cell value by reference (e.g., "A1", "B2")
  const getCellValue = (ref: string): number => {
    const match = ref.match(/^([A-Z]+)(\d+)$/)
    if (!match) return 0

    const colLetter = match[1]
    const rowNum = parseInt(match[2], 10) - 1 // 1-indexed to 0-indexed

    const colIndex = colLetter.charCodeAt(0) - 65 // A=0, B=1, etc
    if (colIndex < 0 || colIndex >= columns.length) return 0
    if (rowNum < 0 || rowNum >= rows.length) return 0

    const col = columns[colIndex]
    const cell = rows[rowNum]?.cells[col.id]
    if (!cell) return 0

    if (cell.formula) {
      return evaluateFormula(cell.formula, rows, columns, rowNum)
    }
    return parseFloat(cell.value as string) || 0
  }

  // Parse range (e.g., "A1:A5")
  const parseRange = (rangeStr: string): number[] => {
    const [start, end] = rangeStr.split(':')
    if (!end) return [getCellValue(start)]

    const startMatch = start.match(/^([A-Z]+)(\d+)$/)
    const endMatch = end.match(/^([A-Z]+)(\d+)$/)
    if (!startMatch || !endMatch) return []

    const startCol = startMatch[1].charCodeAt(0) - 65
    const startRow = parseInt(startMatch[2], 10) - 1
    const endCol = endMatch[1].charCodeAt(0) - 65
    const endRow = parseInt(endMatch[2], 10) - 1

    const values: number[] = []
    for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
      for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
        const col = columns[c]
        if (col && rows[r]) {
          const cell = rows[r].cells[col.id]
          if (cell) {
            values.push(cell.formula
              ? evaluateFormula(cell.formula, rows, columns, r)
              : parseFloat(cell.value as string) || 0)
          }
        }
      }
    }
    return values
  }

  // Handle SUM function
  const sumMatch = expr.match(/^SUM\(([A-Z0-9:]+)\)$/)
  if (sumMatch) {
    const values = parseRange(sumMatch[1])
    return values.reduce((a, b) => a + b, 0)
  }

  // Handle AVG/AVERAGE function
  const avgMatch = expr.match(/^(?:AVG|AVERAGE)\(([A-Z0-9:]+)\)$/)
  if (avgMatch) {
    const values = parseRange(avgMatch[1])
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
  }

  // Handle MIN function
  const minMatch = expr.match(/^MIN\(([A-Z0-9:]+)\)$/)
  if (minMatch) {
    const values = parseRange(minMatch[1])
    return values.length > 0 ? Math.min(...values) : 0
  }

  // Handle MAX function
  const maxMatch = expr.match(/^MAX\(([A-Z0-9:]+)\)$/)
  if (maxMatch) {
    const values = parseRange(maxMatch[1])
    return values.length > 0 ? Math.max(...values) : 0
  }

  // Handle basic arithmetic with cell references
  // Replace cell references with their values
  let evalExpr = expr.replace(/[A-Z]+\d+/g, (ref) => getCellValue(ref).toString())

  // Evaluate the expression (basic arithmetic only)
  try {
    // Only allow numbers, operators, parentheses, and decimals
    if (/^[\d\s+\-*/().]+$/.test(evalExpr)) {
      return Function(`"use strict"; return (${evalExpr})`)() as number
    }
  } catch {
    return 0
  }

  return 0
}

export function SpreadsheetField({ fieldId, assetId, config, readOnly = false }: SpreadsheetFieldProps) {
  const { contribution, isLoading, saveContribution, isSaving } = useFieldContribution(fieldId, assetId)

  const metadata = contribution?.metadata as SpreadsheetMetadataType | undefined
  const maxRows = config?.maxRows ?? 20
  const showRowNumbers = config?.showRowNumbers ?? true
  const allowAddRows = config?.allowAddRows ?? true
  const allowAddColumns = config?.allowAddColumns ?? true

  const [columns, setColumns] = useState<SpreadsheetColumn[]>(
    metadata?.columns ?? config?.columns ?? [
      { id: 'col-a', name: 'Item', type: 'text' },
      { id: 'col-b', name: 'Value', type: 'number' },
      { id: 'col-c', name: 'Notes', type: 'text' }
    ]
  )

  const [rows, setRows] = useState<SpreadsheetRow[]>(
    metadata?.rows ?? Array.from({ length: config?.defaultRows ?? 3 }, (_, i) => ({
      id: `row-${i + 1}`,
      cells: {}
    }))
  )

  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')

  const handleCellSave = async () => {
    if (!editingCell) return
    const { rowId, colId } = editingCell

    const isFormula = editValue.startsWith('=')
    const newRows = rows.map(row =>
      row.id === rowId
        ? {
            ...row,
            cells: {
              ...row.cells,
              [colId]: isFormula
                ? { value: editValue, formula: editValue }
                : { value: editValue }
            }
          }
        : row
    )
    setRows(newRows)
    setEditingCell(null)
    setEditValue('')

    await saveContribution.mutateAsync({
      metadata: {
        columns,
        rows: newRows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const getCellDisplayValue = (row: SpreadsheetRow, col: SpreadsheetColumn, rowIndex: number) => {
    const cell = row.cells[col.id]
    if (!cell) return ''

    if (cell.formula) {
      const result = evaluateFormula(cell.formula, rows, columns, rowIndex)
      if (col.type === 'currency') {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result)
      }
      if (col.type === 'percent') {
        return `${result.toFixed(1)}%`
      }
      return result.toLocaleString()
    }

    if (col.type === 'currency' && typeof cell.value === 'number') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cell.value)
    }
    if (col.type === 'percent' && typeof cell.value === 'number') {
      return `${cell.value}%`
    }
    return cell.value
  }

  const handleAddRow = async () => {
    if (rows.length >= maxRows) return
    const newRow: SpreadsheetRow = {
      id: `row-${Date.now()}`,
      cells: {}
    }
    const newRows = [...rows, newRow]
    setRows(newRows)

    await saveContribution.mutateAsync({
      metadata: {
        columns,
        rows: newRows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleDeleteRow = async (rowId: string) => {
    const newRows = rows.filter(r => r.id !== rowId)
    setRows(newRows)

    await saveContribution.mutateAsync({
      metadata: {
        columns,
        rows: newRows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return
    const newCol: SpreadsheetColumn = {
      id: `col-${Date.now()}`,
      name: newColumnName.trim(),
      type: 'text'
    }
    const newColumns = [...columns, newCol]
    setColumns(newColumns)
    setNewColumnName('')
    setShowAddColumn(false)

    await saveContribution.mutateAsync({
      metadata: {
        columns: newColumns,
        rows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleDeleteColumn = async (colId: string) => {
    const newColumns = columns.filter(c => c.id !== colId)
    const newRows = rows.map(row => {
      const newCells = { ...row.cells }
      delete newCells[colId]
      return { ...row, cells: newCells }
    })
    setColumns(newColumns)
    setRows(newRows)

    await saveContribution.mutateAsync({
      metadata: {
        columns: newColumns,
        rows: newRows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleColumnNameSave = async () => {
    if (!editingColumnId || !editingColumnName.trim()) return
    const newColumns = columns.map(c =>
      c.id === editingColumnId ? { ...c, name: editingColumnName.trim() } : c
    )
    setColumns(newColumns)
    setEditingColumnId(null)
    setEditingColumnName('')

    await saveContribution.mutateAsync({
      metadata: {
        columns: newColumns,
        rows,
        updatedAt: new Date().toISOString()
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Add column button */}
      {!readOnly && allowAddColumns && (
        <div className="flex justify-end">
          {showAddColumn ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="Column name..."
                className="px-2 py-1 text-sm border border-gray-300 rounded"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
              />
              <button
                onClick={handleAddColumn}
                disabled={!newColumnName.trim()}
                className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setShowAddColumn(false); setNewColumnName('') }}
                className="p-1 text-gray-400 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddColumn(true)}
              className="text-xs text-gray-500 hover:text-primary-600"
            >
              <Plus className="w-3 h-3 inline mr-1" />
              Add Column
            </button>
          )}
        </div>
      )}

      {/* Spreadsheet table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {showRowNumbers && (
                <th className="w-8 py-2 px-2 text-center text-gray-400 font-normal">#</th>
              )}
              {columns.map((col, colIndex) => (
                <th
                  key={col.id}
                  className="py-2 px-3 text-left font-medium text-gray-700 min-w-[100px] group"
                >
                  {editingColumnId === col.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editingColumnName}
                        onChange={(e) => setEditingColumnName(e.target.value)}
                        className="flex-1 px-1 py-0.5 text-sm border border-gray-300 rounded"
                        autoFocus
                        onBlur={handleColumnNameSave}
                        onKeyDown={(e) => e.key === 'Enter' && handleColumnNameSave()}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span
                        className={!readOnly ? 'cursor-pointer hover:text-primary-600' : ''}
                        onClick={() => {
                          if (!readOnly) {
                            setEditingColumnId(col.id)
                            setEditingColumnName(col.name)
                          }
                        }}
                      >
                        {col.name}
                      </span>
                      {!readOnly && columns.length > 1 && (
                        <button
                          onClick={() => handleDeleteColumn(col.id)}
                          className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 font-normal">
                    {String.fromCharCode(65 + colIndex)}
                  </div>
                </th>
              ))}
              {!readOnly && <th className="w-8"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                {showRowNumbers && (
                  <td className="py-2 px-2 text-center text-xs text-gray-400">{rowIndex + 1}</td>
                )}
                {columns.map((col) => (
                  <td key={col.id} className="py-1 px-1">
                    {editingCell?.rowId === row.id && editingCell?.colId === col.id ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellSave}
                        onKeyDown={(e) => e.key === 'Enter' && handleCellSave()}
                        className="w-full px-2 py-1 text-sm border border-primary-300 rounded"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => {
                          if (!readOnly) {
                            setEditingCell({ rowId: row.id, colId: col.id })
                            const cell = row.cells[col.id]
                            setEditValue(cell?.formula || cell?.value?.toString() || '')
                          }
                        }}
                        disabled={readOnly}
                        className={clsx(
                          'w-full text-left px-2 py-1 rounded',
                          !readOnly && 'hover:bg-gray-100',
                          row.cells[col.id]?.formula && 'text-blue-600 italic'
                        )}
                      >
                        {getCellDisplayValue(row, col, rowIndex) || (
                          <span className="text-gray-300">-</span>
                        )}
                      </button>
                    )}
                  </td>
                ))}
                {!readOnly && (
                  <td className="py-1 px-1">
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add row button */}
      {!readOnly && allowAddRows && rows.length < maxRows && (
        <button
          onClick={handleAddRow}
          className="w-full py-2 text-sm text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg border border-dashed border-gray-300 hover:border-primary-300"
        >
          <Plus className="w-4 h-4 inline mr-1" />
          Add Row
        </button>
      )}

      {/* Help text */}
      <p className="text-xs text-gray-400">
        Tip: Use formulas like =SUM(A1:A5), =AVG(B1:B3), or =A1+B1*2
      </p>
    </div>
  )
}
