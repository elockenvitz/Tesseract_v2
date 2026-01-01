import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import React, { useState, useEffect, useRef } from 'react'
import { Calendar, Clock, MapPin, Users, X, ChevronDown, ChevronUp, Link as LinkIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const EVENT_TYPES = [
  { value: 'meeting', label: 'Meeting', color: 'bg-blue-100 text-blue-700' },
  { value: 'call', label: 'Call', color: 'bg-green-100 text-green-700' },
  { value: 'deadline', label: 'Deadline', color: 'bg-red-100 text-red-700' },
  { value: 'reminder', label: 'Reminder', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-700' }
]

function InlineEventView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [localTitle, setLocalTitle] = useState(node.attrs.title)
  const [localDescription, setLocalDescription] = useState(node.attrs.description || '')
  const [localLocation, setLocalLocation] = useState(node.attrs.location || '')
  const [localMeetingUrl, setLocalMeetingUrl] = useState(node.attrs.meetingUrl || '')
  const [isExpanded, setIsExpanded] = useState(!node.attrs.eventId)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-focus title on new event
  useEffect(() => {
    if (!node.attrs.eventId && titleRef.current) {
      titleRef.current.focus()
    }
  }, [])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowTypeMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Set default dates for new events
  useEffect(() => {
    if (!node.attrs.eventId && !node.attrs.startDate) {
      const today = new Date()
      const dateStr = today.toISOString().split('T')[0]
      updateAttributes({
        startDate: dateStr,
        endDate: dateStr,
        startTime: '09:00',
        endTime: '10:00'
      })
    }
  }, [])

  // Save event mutation
  const saveEventMutation = useMutation({
    mutationFn: async () => {
      if (!localTitle.trim()) return null

      let startDateTime = node.attrs.startDate
      let endDateTime = node.attrs.endDate

      if (!node.attrs.allDay) {
        if (node.attrs.startDate && node.attrs.startTime) {
          startDateTime = `${node.attrs.startDate}T${node.attrs.startTime}:00`
        }
        if (node.attrs.endDate && node.attrs.endTime) {
          endDateTime = `${node.attrs.endDate}T${node.attrs.endTime}:00`
        }
      }

      const eventData = {
        title: localTitle.trim(),
        description: localDescription.trim() || null,
        event_type: node.attrs.eventType || 'meeting',
        start_date: startDateTime || new Date().toISOString(),
        end_date: endDateTime || null,
        all_day: node.attrs.allDay,
        location: localLocation.trim() || null,
        url: localMeetingUrl.trim() || null,
        context_type: node.attrs.contextType || 'general',
        context_id: node.attrs.contextId || null,
        created_by: user?.id,
        status: 'scheduled'
      }

      if (node.attrs.eventId) {
        const { data, error } = await supabase
          .from('calendar_events')
          .update(eventData)
          .eq('id', node.attrs.eventId)
          .select()
          .single()
        if (error) throw error
        return data
      } else {
        const { data, error } = await supabase
          .from('calendar_events')
          .insert(eventData)
          .select()
          .single()
        if (error) throw error
        return data
      }
    },
    onSuccess: (data) => {
      if (data) {
        updateAttributes({ eventId: data.id, title: localTitle.trim() })
        queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      }
    }
  })

  const handleSave = () => {
    if (!localTitle.trim()) return
    saveEventMutation.mutate()
  }

  const handleTitleBlur = () => {
    if (localTitle.trim() && localTitle !== node.attrs.title) {
      updateAttributes({ title: localTitle })
      handleSave()
    }
  }

  const eventTypeInfo = EVENT_TYPES.find(t => t.value === node.attrs.eventType) || EVENT_TYPES[0]

  // Format date/time for display
  const formatDateTime = () => {
    if (!node.attrs.startDate) return ''

    const startDate = new Date(node.attrs.startDate)
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    if (node.attrs.allDay) return dateStr

    return `${dateStr} ${node.attrs.startTime || ''}`
  }

  return (
    <NodeViewWrapper className="inline-event-wrapper my-1" data-drag-handle>
      <div
        ref={containerRef}
        className={clsx(
          'rounded-lg border text-sm transition-all',
          selected ? 'ring-1 ring-primary-500 border-primary-300' : 'border-blue-200',
          isExpanded ? 'max-w-2xl bg-blue-50/50' : 'max-w-lg bg-blue-50/30'
        )}
      >
        {/* Compact Row */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Event type indicator */}
          <Calendar className="w-4 h-4 text-blue-500 flex-shrink-0" />

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleTitleBlur()
                if (!node.attrs.eventId && localTitle.trim()) handleSave()
              }
            }}
            placeholder="Event name..."
            className="flex-1 text-sm font-medium bg-transparent border-none outline-none min-w-0 text-gray-900"
            contentEditable={false}
          />

          {/* Quick info when collapsed */}
          {!isExpanded && (
            <>
              {node.attrs.startDate && (
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {formatDateTime()}
                </span>
              )}
              {node.attrs.location && (
                <span className="text-xs text-gray-500 flex-shrink-0 flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                </span>
              )}
            </>
          )}

          {/* Expand/Collapse */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            contentEditable={false}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {/* Delete */}
          <button
            onClick={deleteNode}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
            contentEditable={false}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Expanded Section */}
        {isExpanded && (
          <div className="px-3 pb-3 pt-1 border-t border-blue-100 space-y-3">
            {/* Description */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Description</label>
              <input
                type="text"
                value={localDescription}
                onChange={(e) => setLocalDescription(e.target.value)}
                onBlur={() => {
                  if (localDescription !== node.attrs.description) {
                    updateAttributes({ description: localDescription })
                    if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                  }
                }}
                placeholder="Add description..."
                className="w-full text-sm bg-white border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary-500"
                contentEditable={false}
              />
            </div>

            {/* Date/Time Row */}
            <div className="flex items-end gap-3 flex-wrap">
              {/* Start Date */}
              <div className="min-w-[130px]">
                <label className="text-xs text-gray-500 mb-1 block">Start</label>
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="date"
                    value={node.attrs.startDate}
                    onChange={(e) => {
                      updateAttributes({ startDate: e.target.value })
                      if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                    }}
                    className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* Start Time */}
              {!node.attrs.allDay && (
                <div className="min-w-[100px]">
                  <label className="text-xs text-gray-500 mb-1 block">Time</label>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="time"
                      value={node.attrs.startTime}
                      onChange={(e) => {
                        updateAttributes({ startTime: e.target.value })
                        if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                      }}
                      className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      contentEditable={false}
                    />
                  </div>
                </div>
              )}

              {/* End Date */}
              <div className="min-w-[130px]">
                <label className="text-xs text-gray-500 mb-1 block">End</label>
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="date"
                    value={node.attrs.endDate}
                    onChange={(e) => {
                      updateAttributes({ endDate: e.target.value })
                      if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                    }}
                    className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* End Time */}
              {!node.attrs.allDay && (
                <div className="min-w-[100px]">
                  <label className="text-xs text-gray-500 mb-1 block">Time</label>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="time"
                      value={node.attrs.endTime}
                      onChange={(e) => {
                        updateAttributes({ endTime: e.target.value })
                        if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                      }}
                      className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      contentEditable={false}
                    />
                  </div>
                </div>
              )}

              {/* All Day */}
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer pb-1">
                <input
                  type="checkbox"
                  checked={node.attrs.allDay}
                  onChange={(e) => {
                    updateAttributes({ allDay: e.target.checked })
                    if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                  }}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                All day
              </label>
            </div>

            {/* Location & Type Row */}
            <div className="flex items-end gap-3 flex-wrap">
              {/* Location */}
              <div className="flex-1 min-w-[150px]">
                <label className="text-xs text-gray-500 mb-1 block">Location</label>
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={localLocation}
                    onChange={(e) => setLocalLocation(e.target.value)}
                    onBlur={() => {
                      if (localLocation !== node.attrs.location) {
                        updateAttributes({ location: localLocation })
                        if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                      }
                    }}
                    placeholder="Add location..."
                    className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* Meeting URL */}
              <div className="flex-1 min-w-[150px]">
                <label className="text-xs text-gray-500 mb-1 block">Meeting Link</label>
                <div className="flex items-center gap-1">
                  <LinkIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="url"
                    value={localMeetingUrl}
                    onChange={(e) => setLocalMeetingUrl(e.target.value)}
                    onBlur={() => {
                      if (localMeetingUrl !== node.attrs.meetingUrl) {
                        updateAttributes({ meetingUrl: localMeetingUrl })
                        if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                      }
                    }}
                    placeholder="https://..."
                    className="flex-1 text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* Event Type */}
              <div className="relative">
                <label className="text-xs text-gray-500 mb-1 block">Type</label>
                <button
                  onClick={() => setShowTypeMenu(!showTypeMenu)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                    eventTypeInfo.color
                  )}
                  contentEditable={false}
                >
                  {eventTypeInfo.label}
                </button>
                {showTypeMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {EVENT_TYPES.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => {
                          updateAttributes({ eventType: type.value })
                          setShowTypeMenu(false)
                          if (node.attrs.eventId) setTimeout(() => saveEventMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.eventType === type.value && 'bg-gray-50'
                        )}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// TipTap Extension
export const InlineEventExtension = Node.create({
  name: 'inlineEvent',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      eventId: { default: null },
      title: { default: '' },
      description: { default: '' },
      startDate: { default: '' },
      startTime: { default: '' },
      endDate: { default: '' },
      endTime: { default: '' },
      allDay: { default: false },
      location: { default: '' },
      meetingUrl: { default: '' },
      eventType: { default: 'meeting' },
      contextType: { default: '' },
      contextId: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="inline-event"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const text = node.attrs.title ? `Event: ${node.attrs.title}` : 'Event'
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-event' }), text]
  },

  renderText({ node }) {
    const title = node.attrs.title || 'Untitled event'
    const date = node.attrs.startDate || ''
    return `[Event] ${title}${date ? ` - ${date}` : ''}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineEventView)
  }
})

export default InlineEventExtension
