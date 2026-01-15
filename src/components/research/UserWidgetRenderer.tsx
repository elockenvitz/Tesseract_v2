import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  CheckSquare,
  Hash,
  Calendar,
  Gauge,
  Clock,
  Trash2,
  GripVertical
} from 'lucide-react'
import { Card } from '../ui/Card'
import { RichTextEditor } from '../rich-text-editor'
import { ContributionSection } from '../contributions/ContributionSection'
import type { UserAssetWidget, WidgetValue, WidgetType } from '../../hooks/useUserAssetWidgets'

interface UserWidgetRendererProps {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  onSaveValue: (content?: string, value?: Record<string, unknown>) => Promise<void>
  onDelete?: () => void
  assetId: string
}

const ICON_MAP: Record<WidgetType, React.ComponentType<{ className?: string }>> = {
  rich_text: FileText,
  checklist: CheckSquare,
  numeric: Hash,
  date: Calendar,
  metric: Gauge,
  timeline: Clock
}

export function UserWidgetRenderer({
  widget,
  value,
  isOwner,
  isCollapsed,
  onToggleCollapse,
  onSaveValue,
  onDelete,
  assetId
}: UserWidgetRendererProps) {
  const [isSaving, setIsSaving] = useState(false)
  const Icon = ICON_MAP[widget.widget_type]

  const handleSave = async (content?: string, jsonValue?: Record<string, unknown>) => {
    setIsSaving(true)
    try {
      await onSaveValue(content, jsonValue)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card padding="none" className="border-l-4 border-l-cyan-400">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 flex-1"
        >
          <Icon className="w-4 h-4 text-cyan-600" />
          <span className="font-medium text-gray-900">{widget.title}</span>
          <span className="text-xs text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded">
            Custom
          </span>
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />
          ) : (
            <ChevronUp className="h-4 w-4 text-gray-400 ml-auto" />
          )}
        </button>

        {isOwner && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.()
            }}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors ml-2"
            title="Remove widget"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="border-t border-gray-100 px-4 py-4">
          {widget.description && (
            <p className="text-xs text-gray-500 mb-3">{widget.description}</p>
          )}

          {/* Render based on widget type */}
          {widget.widget_type === 'rich_text' && (
            <RichTextWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
              assetId={assetId}
            />
          )}

          {widget.widget_type === 'checklist' && (
            <ChecklistWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}

          {widget.widget_type === 'numeric' && (
            <NumericWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}

          {widget.widget_type === 'date' && (
            <DateWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}

          {widget.widget_type === 'metric' && (
            <MetricWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}

          {widget.widget_type === 'timeline' && (
            <TimelineWidgetContent
              widget={widget}
              value={value}
              isOwner={isOwner}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// RICH TEXT WIDGET
// ============================================================================

function RichTextWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving,
  assetId
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string) => Promise<void>
  isSaving: boolean
  assetId: string
}) {
  // Use ContributionSection for rich text - it handles everything
  return (
    <ContributionSection
      assetId={assetId}
      section={`custom_${widget.id}`}
      title=""
      hideTitle
      hideVisibility={true}
      viewMode="individual"
    />
  )
}

// ============================================================================
// CHECKLIST WIDGET
// ============================================================================

interface ChecklistItem {
  id: string
  text: string
  checked: boolean
}

function ChecklistWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string, value?: Record<string, unknown>) => Promise<void>
  isSaving: boolean
}) {
  const items: ChecklistItem[] = (value?.value?.items as ChecklistItem[]) || []
  const [newItemText, setNewItemText] = useState('')

  const handleToggle = async (itemId: string) => {
    if (!isOwner) return
    const updatedItems = items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    )
    await onSave(undefined, { items: updatedItems })
  }

  const handleAddItem = async () => {
    if (!newItemText.trim() || !isOwner) return
    const newItem: ChecklistItem = {
      id: `item_${Date.now()}`,
      text: newItemText.trim(),
      checked: false
    }
    await onSave(undefined, { items: [...items, newItem] })
    setNewItemText('')
  }

  const handleRemoveItem = async (itemId: string) => {
    if (!isOwner) return
    const updatedItems = items.filter(item => item.id !== itemId)
    await onSave(undefined, { items: updatedItems })
  }

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 group">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => handleToggle(item.id)}
            disabled={!isOwner}
            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className={item.checked ? 'text-gray-400 line-through' : 'text-gray-700'}>
            {item.text}
          </span>
          {isOwner && (
            <button
              onClick={() => handleRemoveItem(item.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}

      {isOwner && (
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
            placeholder="Add item..."
            className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            onClick={handleAddItem}
            disabled={!newItemText.trim() || isSaving}
            className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {items.length === 0 && !isOwner && (
        <p className="text-sm text-gray-400 italic">No items yet</p>
      )}
    </div>
  )
}

// ============================================================================
// NUMERIC WIDGET
// ============================================================================

function NumericWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string, value?: Record<string, unknown>) => Promise<void>
  isSaving: boolean
}) {
  const numValue = value?.value?.number as number | undefined
  const unit = (widget.config?.unit as string) || ''

  const handleChange = async (newValue: string) => {
    if (!isOwner) return
    const parsed = parseFloat(newValue)
    await onSave(undefined, { number: isNaN(parsed) ? null : parsed })
  }

  return (
    <div className="flex items-center gap-2">
      {isOwner ? (
        <input
          type="number"
          value={numValue ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          className="w-32 px-3 py-2 border border-gray-200 rounded-lg focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          placeholder="Enter value..."
        />
      ) : (
        <span className="text-2xl font-semibold text-gray-900">
          {numValue !== undefined ? numValue.toLocaleString() : '—'}
        </span>
      )}
      {unit && <span className="text-gray-500">{unit}</span>}
    </div>
  )
}

// ============================================================================
// DATE WIDGET
// ============================================================================

function DateWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string, value?: Record<string, unknown>) => Promise<void>
  isSaving: boolean
}) {
  const dateValue = value?.value?.date as string | undefined

  const handleChange = async (newValue: string) => {
    if (!isOwner) return
    await onSave(undefined, { date: newValue || null })
  }

  return (
    <div>
      {isOwner ? (
        <input
          type="date"
          value={dateValue || ''}
          onChange={(e) => handleChange(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
        />
      ) : (
        <span className="text-gray-900">
          {dateValue ? new Date(dateValue).toLocaleDateString() : '—'}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// METRIC WIDGET
// ============================================================================

function MetricWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string, value?: Record<string, unknown>) => Promise<void>
  isSaving: boolean
}) {
  const metricValue = value?.value?.metric as string | undefined
  const metricLabel = value?.value?.label as string | undefined

  const handleChange = async (field: 'metric' | 'label', newValue: string) => {
    if (!isOwner) return
    await onSave(undefined, {
      ...value?.value,
      [field]: newValue || null
    })
  }

  return (
    <div className="flex items-center gap-4">
      {isOwner ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={metricValue || ''}
            onChange={(e) => handleChange('metric', e.target.value)}
            placeholder="Value (e.g., $150)"
            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-lg font-semibold"
          />
          <input
            type="text"
            value={metricLabel || ''}
            onChange={(e) => handleChange('label', e.target.value)}
            placeholder="Label (e.g., Target Price)"
            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-sm"
          />
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-gray-900">{metricValue || '—'}</div>
          {metricLabel && <div className="text-xs text-gray-500 mt-1">{metricLabel}</div>}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TIMELINE WIDGET
// ============================================================================

interface TimelineEvent {
  id: string
  date: string
  title: string
  description?: string
}

function TimelineWidgetContent({
  widget,
  value,
  isOwner,
  onSave,
  isSaving
}: {
  widget: UserAssetWidget
  value?: WidgetValue
  isOwner: boolean
  onSave: (content?: string, value?: Record<string, unknown>) => Promise<void>
  isSaving: boolean
}) {
  const events: TimelineEvent[] = (value?.value?.events as TimelineEvent[]) || []
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEvent, setNewEvent] = useState({ date: '', title: '', description: '' })

  const handleAddEvent = async () => {
    if (!newEvent.date || !newEvent.title.trim() || !isOwner) return
    const event: TimelineEvent = {
      id: `event_${Date.now()}`,
      date: newEvent.date,
      title: newEvent.title.trim(),
      description: newEvent.description.trim() || undefined
    }
    // Sort by date
    const updatedEvents = [...events, event].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )
    await onSave(undefined, { events: updatedEvents })
    setNewEvent({ date: '', title: '', description: '' })
    setShowAddForm(false)
  }

  const handleRemoveEvent = async (eventId: string) => {
    if (!isOwner) return
    const updatedEvents = events.filter(e => e.id !== eventId)
    await onSave(undefined, { events: updatedEvents })
  }

  return (
    <div className="space-y-3">
      {/* Timeline events */}
      {events.map((event, index) => (
        <div key={event.id} className="flex gap-3 group">
          <div className="flex flex-col items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
            {index < events.length - 1 && (
              <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
            )}
          </div>
          <div className="flex-1 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">
                  {new Date(event.date).toLocaleDateString()}
                </div>
                <div className="font-medium text-gray-900">{event.title}</div>
                {event.description && (
                  <div className="text-sm text-gray-600 mt-0.5">{event.description}</div>
                )}
              </div>
              {isOwner && (
                <button
                  onClick={() => handleRemoveEvent(event.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Add event form */}
      {isOwner && (
        showAddForm ? (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <input
              type="date"
              value={newEvent.date}
              onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))}
              className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
            />
            <input
              type="text"
              value={newEvent.title}
              onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Event title"
              className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
            />
            <input
              type="text"
              value={newEvent.description}
              onChange={(e) => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Description (optional)"
              className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddEvent}
                disabled={!newEvent.date || !newEvent.title.trim() || isSaving}
                className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
              >
                Add Event
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            + Add event
          </button>
        )
      )}

      {events.length === 0 && !isOwner && !showAddForm && (
        <p className="text-sm text-gray-400 italic">No events yet</p>
      )}
    </div>
  )
}
