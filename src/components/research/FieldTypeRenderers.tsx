import { useState, useCallback } from 'react'
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
  Loader2
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
