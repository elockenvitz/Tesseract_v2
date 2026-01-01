import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import React, { useState, useEffect, useRef } from 'react'
import { Calendar, Clock, Flag, User, Bell, X, Check, ChevronDown, ChevronUp, Repeat } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-600 hover:bg-gray-200', dot: 'bg-gray-400' },
  { value: 'medium', label: 'Med', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200', dot: 'bg-blue-500' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 hover:bg-orange-200', dot: 'bg-orange-500' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 hover:bg-red-200', dot: 'bg-red-500' }
]

const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '1d', label: '1d' }
]

const RECURRING_OPTIONS = [
  { value: '', label: 'No repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]

const QUICK_DUE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'next_week', label: 'Next Week' },
  { value: 'custom', label: 'Pick date...' }
]

interface InlineTaskViewProps {
  node: {
    attrs: {
      taskId: string | null
      title: string
      description: string
      dueDate: string
      dueTime: string
      priority: 'low' | 'medium' | 'high' | 'urgent'
      reminder: string
      recurring: string
      assignedTo: string
      completed: boolean
      contextType: string
      contextId: string
    }
  }
  updateAttributes: (attrs: Partial<InlineTaskViewProps['node']['attrs']>) => void
  deleteNode: () => void
  selected: boolean
}

function InlineTaskView({ node, updateAttributes, deleteNode, selected }: InlineTaskViewProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [localTitle, setLocalTitle] = useState(node.attrs.title)
  const [localDescription, setLocalDescription] = useState(node.attrs.description || '')
  const [isExpanded, setIsExpanded] = useState(!node.attrs.taskId) // Expand for new tasks
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showReminderMenu, setShowReminderMenu] = useState(false)
  const [showAssignMenu, setShowAssignMenu] = useState(false)
  const [showRecurringMenu, setShowRecurringMenu] = useState(false)
  const [showQuickDueMenu, setShowQuickDueMenu] = useState(false)
  const [showQuickReminderMenu, setShowQuickReminderMenu] = useState(false)
  const [showQuickAssignMenu, setShowQuickAssignMenu] = useState(false)
  const [showQuickRecurringMenu, setShowQuickRecurringMenu] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-focus title on new task
  useEffect(() => {
    if (!node.attrs.taskId && titleRef.current) {
      titleRef.current.focus()
    }
  }, [])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPriorityMenu(false)
        setShowReminderMenu(false)
        setShowAssignMenu(false)
        setShowRecurringMenu(false)
        setShowQuickDueMenu(false)
        setShowQuickReminderMenu(false)
        setShowQuickAssignMenu(false)
        setShowQuickRecurringMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Quick due date setter
  const setQuickDueDate = (option: string) => {
    const today = new Date()
    let newDate: Date

    switch (option) {
      case 'today':
        newDate = today
        break
      case 'tomorrow':
        newDate = new Date(today)
        newDate.setDate(newDate.getDate() + 1)
        break
      case 'next_week':
        newDate = new Date(today)
        newDate.setDate(newDate.getDate() + 7)
        break
      default:
        return
    }

    updateAttributes({ dueDate: newDate.toISOString().split('T')[0] })
    if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
    setShowQuickDueMenu(false)
  }

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-task-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .order('first_name')
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000
  })

  // Get assigned user name
  const assignedUser = users.find(u => u.id === node.attrs.assignedTo)
  const assignedName = assignedUser
    ? `${assignedUser.first_name || ''} ${assignedUser.last_name || ''}`.trim() || assignedUser.email?.split('@')[0]
    : node.attrs.assignedTo === user?.id
    ? 'Me'
    : ''

  // Set default due date for new tasks
  useEffect(() => {
    if (!node.attrs.taskId && !node.attrs.dueDate) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      updateAttributes({ dueDate: tomorrow.toISOString().split('T')[0] })
    }
  }, [])

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'urgent': return '#dc2626'
      case 'high': return '#ea580c'
      case 'medium': return '#2563eb'
      default: return '#64748b'
    }
  }

  // Save task mutation
  const saveTaskMutation = useMutation({
    mutationFn: async () => {
      if (!localTitle.trim()) return null

      let startDate = node.attrs.dueDate
      if (node.attrs.dueDate && node.attrs.dueTime) {
        startDate = `${node.attrs.dueDate}T${node.attrs.dueTime}:00`
      } else if (node.attrs.dueDate) {
        startDate = `${node.attrs.dueDate}T09:00:00`
      }

      const taskData = {
        title: localTitle.trim(),
        description: localDescription.trim() || null,
        event_type: 'task',
        start_date: startDate || new Date().toISOString(),
        all_day: !node.attrs.dueTime,
        context_type: node.attrs.contextType || 'general',
        context_id: node.attrs.contextId || null,
        priority: node.attrs.priority,
        status: node.attrs.completed ? 'completed' : 'scheduled',
        assigned_to: node.attrs.assignedTo || null,
        is_recurring: !!node.attrs.recurring,
        recurrence_rule: node.attrs.recurring || null,
        created_by: user?.id,
        color: getPriorityColor(node.attrs.priority)
      }

      if (node.attrs.taskId) {
        const { data, error } = await supabase
          .from('calendar_events')
          .update(taskData)
          .eq('id', node.attrs.taskId)
          .select()
          .single()
        if (error) throw error
        return data
      } else {
        const { data, error } = await supabase
          .from('calendar_events')
          .insert(taskData)
          .select()
          .single()
        if (error) throw error
        return data
      }
    },
    onSuccess: (data) => {
      if (data) {
        updateAttributes({ taskId: data.id, title: localTitle.trim(), description: localDescription.trim() })
        queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      }
    }
  })

  const handleSave = () => {
    if (!localTitle.trim()) return
    saveTaskMutation.mutate()
  }

  const handleTitleBlur = () => {
    if (localTitle.trim() && localTitle !== node.attrs.title) {
      updateAttributes({ title: localTitle })
      handleSave()
    }
  }

  const toggleComplete = () => {
    updateAttributes({ completed: !node.attrs.completed })
    if (node.attrs.taskId) {
      setTimeout(() => saveTaskMutation.mutate(), 100)
    }
  }

  const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === node.attrs.priority) || PRIORITY_OPTIONS[1]
  const reminderInfo = REMINDER_OPTIONS.find(r => r.value === node.attrs.reminder)
  const recurringInfo = RECURRING_OPTIONS.find(r => r.value === node.attrs.recurring)

  // Format due date for compact display
  const formatDueDate = (dateStr: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <NodeViewWrapper className="inline-task-wrapper my-1" data-drag-handle>
      <div
        ref={containerRef}
        className={clsx(
          'rounded-lg border text-sm transition-all',
          selected ? 'ring-1 ring-primary-500 border-primary-300' : 'border-gray-200',
          node.attrs.completed ? 'bg-gray-50' : 'bg-white',
          isExpanded ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        {/* Compact Row - Always visible */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Checkbox */}
          <button
            onClick={toggleComplete}
            className={clsx(
              'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
              node.attrs.completed
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-gray-300 hover:border-primary-500'
            )}
            contentEditable={false}
          >
            {node.attrs.completed && <Check className="w-2.5 h-2.5" />}
          </button>

          {/* Priority dot */}
          <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', priorityInfo.dot)} />

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
                if (!node.attrs.taskId && localTitle.trim()) handleSave()
              }
            }}
            placeholder="Task name..."
            className={clsx(
              'flex-1 text-sm font-medium bg-transparent border-none outline-none min-w-0',
              node.attrs.completed ? 'line-through text-gray-400' : 'text-gray-900'
            )}
            contentEditable={false}
          />

          {/* Quick Set Buttons (collapsed only) */}
          {!isExpanded && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Quick Due */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowQuickDueMenu(!showQuickDueMenu)
                    setShowQuickReminderMenu(false)
                    setShowQuickAssignMenu(false)
                    setShowQuickRecurringMenu(false)
                  }}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    node.attrs.dueDate ? 'text-primary-600 hover:bg-primary-50' : 'text-gray-400 hover:bg-gray-100'
                  )}
                  contentEditable={false}
                  title={node.attrs.dueDate ? formatDueDate(node.attrs.dueDate) : 'Set due date'}
                >
                  <Calendar className="w-3.5 h-3.5" />
                </button>
                {showQuickDueMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {QUICK_DUE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          if (opt.value === 'custom') {
                            setShowQuickDueMenu(false)
                            setIsExpanded(true)
                          } else {
                            setQuickDueDate(opt.value)
                          }
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Reminder */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowQuickReminderMenu(!showQuickReminderMenu)
                    setShowQuickDueMenu(false)
                    setShowQuickAssignMenu(false)
                    setShowQuickRecurringMenu(false)
                  }}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    node.attrs.reminder ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-400 hover:bg-gray-100'
                  )}
                  contentEditable={false}
                  title={reminderInfo?.value ? reminderInfo.label : 'Set reminder'}
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>
                {showQuickReminderMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {REMINDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          updateAttributes({ reminder: opt.value })
                          setShowQuickReminderMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.reminder === opt.value && 'bg-gray-50'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Assign */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowQuickAssignMenu(!showQuickAssignMenu)
                    setShowQuickDueMenu(false)
                    setShowQuickReminderMenu(false)
                    setShowQuickRecurringMenu(false)
                  }}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    node.attrs.assignedTo ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400 hover:bg-gray-100'
                  )}
                  contentEditable={false}
                  title={assignedName || 'Assign'}
                >
                  <User className="w-3.5 h-3.5" />
                </button>
                {showQuickAssignMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[120px] max-h-48 overflow-y-auto">
                    <button
                      onClick={() => {
                        updateAttributes({ assignedTo: '' })
                        setShowQuickAssignMenu(false)
                        if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                      }}
                      className={clsx(
                        'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                        !node.attrs.assignedTo && 'bg-gray-50'
                      )}
                    >
                      Unassigned
                    </button>
                    {user && (
                      <button
                        onClick={() => {
                          updateAttributes({ assignedTo: user.id })
                          setShowQuickAssignMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.assignedTo === user.id && 'bg-gray-50'
                        )}
                      >
                        Me
                      </button>
                    )}
                    {users.filter(u => u.id !== user?.id).slice(0, 5).map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          updateAttributes({ assignedTo: u.id })
                          setShowQuickAssignMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.assignedTo === u.id && 'bg-gray-50'
                        )}
                      >
                        {u.first_name} {u.last_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Recurring */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowQuickRecurringMenu(!showQuickRecurringMenu)
                    setShowQuickDueMenu(false)
                    setShowQuickReminderMenu(false)
                    setShowQuickAssignMenu(false)
                  }}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    node.attrs.recurring ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                  )}
                  contentEditable={false}
                  title={recurringInfo?.value ? recurringInfo.label : 'Set recurring'}
                >
                  <Repeat className="w-3.5 h-3.5" />
                </button>
                {showQuickRecurringMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {RECURRING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          updateAttributes({ recurring: opt.value })
                          setShowQuickRecurringMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.recurring === opt.value && 'bg-gray-50'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Due date text (shown when collapsed and has date) */}
          {!isExpanded && node.attrs.dueDate && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              {formatDueDate(node.attrs.dueDate)}
            </span>
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
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-3">
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
                    if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                  }
                }}
                placeholder="Add description..."
                className="w-full text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                contentEditable={false}
              />
            </div>

            {/* Date, Time, Priority, Reminder, Assign, Recurring - All on one row */}
            <div className="flex items-end gap-3 flex-wrap">
              {/* Due Date */}
              <div className="min-w-[130px]">
                <label className="text-xs text-gray-500 mb-1 block">Due Date</label>
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="date"
                    value={node.attrs.dueDate}
                    onChange={(e) => {
                      updateAttributes({ dueDate: e.target.value })
                      if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                    }}
                    className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* Time */}
              <div className="min-w-[100px]">
                <label className="text-xs text-gray-500 mb-1 block">Time</label>
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="time"
                    value={node.attrs.dueTime}
                    onChange={(e) => {
                      updateAttributes({ dueTime: e.target.value })
                      if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                    }}
                    className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    contentEditable={false}
                  />
                </div>
              </div>

              {/* Priority */}
              <div className="relative">
                <label className="text-xs text-gray-500 mb-1 block">Priority</label>
                <button
                  onClick={() => setShowPriorityMenu(!showPriorityMenu)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                    priorityInfo.color
                  )}
                  contentEditable={false}
                >
                  <Flag className="w-3 h-3" />
                  {priorityInfo.label}
                </button>
                {showPriorityMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[90px]">
                    {PRIORITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          updateAttributes({ priority: opt.value as any })
                          setShowPriorityMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-gray-50',
                          node.attrs.priority === opt.value && 'bg-gray-50'
                        )}
                      >
                        <div className={clsx('w-2 h-2 rounded-full', opt.dot)} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Reminder */}
              <div className="relative">
                <label className="text-xs text-gray-500 mb-1 block">Reminder</label>
                <button
                  onClick={() => setShowReminderMenu(!showReminderMenu)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  contentEditable={false}
                >
                  <Bell className="w-3 h-3" />
                  {reminderInfo?.value ? reminderInfo.label : 'None'}
                </button>
                {showReminderMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {REMINDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          updateAttributes({ reminder: opt.value })
                          setShowReminderMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.reminder === opt.value && 'bg-gray-50'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Assign */}
              <div className="relative">
                <label className="text-xs text-gray-500 mb-1 block">Assign</label>
                <button
                  onClick={() => setShowAssignMenu(!showAssignMenu)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  contentEditable={false}
                >
                  <User className="w-3 h-3" />
                  {assignedName || 'None'}
                </button>
                {showAssignMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[130px] max-h-48 overflow-y-auto">
                    <button
                      onClick={() => {
                        updateAttributes({ assignedTo: '' })
                        setShowAssignMenu(false)
                        if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                      }}
                      className={clsx(
                        'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                        !node.attrs.assignedTo && 'bg-gray-50'
                      )}
                    >
                      Unassigned
                    </button>
                    {user && (
                      <button
                        onClick={() => {
                          updateAttributes({ assignedTo: user.id })
                          setShowAssignMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.assignedTo === user.id && 'bg-gray-50'
                        )}
                      >
                        Me
                      </button>
                    )}
                    {users
                      .filter(u => u.id !== user?.id)
                      .map((u) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            updateAttributes({ assignedTo: u.id })
                            setShowAssignMenu(false)
                            if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                          }}
                          className={clsx(
                            'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                            node.attrs.assignedTo === u.id && 'bg-gray-50'
                          )}
                        >
                          {u.first_name} {u.last_name}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Recurring */}
              <div className="relative">
                <label className="text-xs text-gray-500 mb-1 block">Repeat</label>
                <button
                  onClick={() => setShowRecurringMenu(!showRecurringMenu)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  contentEditable={false}
                >
                  <Repeat className="w-3 h-3" />
                  {recurringInfo?.value ? recurringInfo.label : 'None'}
                </button>
                {showRecurringMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[100px]">
                    {RECURRING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          updateAttributes({ recurring: opt.value })
                          setShowRecurringMenu(false)
                          if (node.attrs.taskId) setTimeout(() => saveTaskMutation.mutate(), 100)
                        }}
                        className={clsx(
                          'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                          node.attrs.recurring === opt.value && 'bg-gray-50'
                        )}
                      >
                        {opt.label}
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
export const InlineTaskExtension = Node.create({
  name: 'inlineTask',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      taskId: { default: null },
      title: { default: '' },
      description: { default: '' },
      dueDate: { default: '' },
      dueTime: { default: '' },
      priority: { default: 'medium' },
      reminder: { default: '' },
      recurring: { default: '' },
      assignedTo: { default: '' },
      completed: { default: false },
      contextType: { default: '' },
      contextId: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="inline-task"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const taskText = node.attrs.title ? `Task: ${node.attrs.title}` : 'Task'
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-task' }), taskText]
  },

  renderText({ node }) {
    const title = node.attrs.title || 'Untitled task'
    const status = node.attrs.completed ? '[x]' : '[ ]'
    const desc = node.attrs.description ? ` - ${node.attrs.description}` : ''
    return `${status} ${title}${desc}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineTaskView)
  }
})

export default InlineTaskExtension
