import React, { useState, useEffect } from 'react'
import { X, Calendar, Clock, User, Flag, Bell, AlignLeft } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface TaskData {
  id?: string
  title: string
  description?: string
  due_date?: string
  reminder?: string
  assigned_to?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  context_type?: string
  context_id?: string
}

interface TaskModalProps {
  isOpen: boolean
  onClose: () => void
  onTaskCreated?: (task: TaskData) => void
  contextType?: string
  contextId?: string
  contextTitle?: string
  initialData?: Partial<TaskData>
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'text-gray-500 bg-gray-100' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600 bg-blue-100' },
  { value: 'high', label: 'High', color: 'text-orange-600 bg-orange-100' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-100' }
]

const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '15m', label: '15 minutes before' },
  { value: '30m', label: '30 minutes before' },
  { value: '1h', label: '1 hour before' },
  { value: '1d', label: '1 day before' },
  { value: '1w', label: '1 week before' }
]

export function TaskModal({
  isOpen,
  onClose,
  onTaskCreated,
  contextType,
  contextId,
  contextTitle,
  initialData
}: TaskModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [dueDate, setDueDate] = useState(initialData?.due_date || '')
  const [dueTime, setDueTime] = useState('')
  const [reminder, setReminder] = useState(initialData?.reminder || '')
  const [assignedTo, setAssignedTo] = useState(initialData?.assigned_to || '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    initialData?.priority || 'medium'
  )

  // Fetch users for assignment dropdown
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-assignment'],
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

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (taskData: TaskData) => {
      // Calculate the full datetime
      let startDate = dueDate
      if (dueDate && dueTime) {
        startDate = `${dueDate}T${dueTime}:00`
      } else if (dueDate) {
        startDate = `${dueDate}T09:00:00` // Default to 9 AM if no time specified
      }

      const { data, error } = await supabase
        .from('calendar_events')
        .insert({
          title: taskData.title,
          description: taskData.description,
          event_type: 'task',
          start_date: startDate || new Date().toISOString(),
          all_day: !dueTime,
          context_type: contextType || 'general',
          context_id: contextId,
          context_title: contextTitle,
          priority: taskData.priority,
          status: 'scheduled',
          assigned_to: taskData.assigned_to || null,
          created_by: user?.id,
          color: getPriorityColor(taskData.priority)
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      onTaskCreated?.({
        id: data.id,
        title: data.title,
        description: data.description,
        due_date: data.start_date,
        priority: data.priority,
        assigned_to: data.assigned_to
      })
      handleClose()
    }
  })

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'urgent': return '#dc2626'
      case 'high': return '#ea580c'
      case 'medium': return '#2563eb'
      default: return '#64748b'
    }
  }

  const handleClose = () => {
    setTitle('')
    setDescription('')
    setDueDate('')
    setDueTime('')
    setReminder('')
    setAssignedTo('')
    setPriority('medium')
    onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    createTaskMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      due_date: dueDate || undefined,
      reminder: reminder || undefined,
      assigned_to: assignedTo || undefined,
      priority,
      context_type: contextType,
      context_id: contextId
    })
  }

  // Set default due date to tomorrow
  useEffect(() => {
    if (isOpen && !dueDate) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      setDueDate(tomorrow.toISOString().split('T')[0])
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Create Task</h3>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task Name *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <AlignLeft className="w-4 h-4 inline mr-1" />
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more details..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Due Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Calendar className="w-4 h-4 inline mr-1" />
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Clock className="w-4 h-4 inline mr-1" />
                Time
              </label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Priority and Reminder */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Flag className="w-4 h-4 inline mr-1" />
                Priority
              </label>
              <div className="flex gap-1">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value as any)}
                    className={clsx(
                      'flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-all',
                      priority === opt.value
                        ? opt.color + ' ring-2 ring-offset-1 ring-current'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Bell className="w-4 h-4 inline mr-1" />
                Reminder
              </label>
              <select
                value={reminder}
                onChange={(e) => setReminder(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                {REMINDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assign To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Assign To
            </label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Unassigned</option>
              {user && (
                <option value={user.id}>
                  Me ({(user as any).first_name} {(user as any).last_name})
                </option>
              )}
              {users
                .filter(u => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name}
                  </option>
                ))}
            </select>
          </div>

          {/* Context info */}
          {contextTitle && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              This task will be linked to: <span className="font-medium">{contextTitle}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createTaskMutation.isPending}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {createTaskMutation.isPending ? (
                <>
                  <span className="animate-spin">⟳</span>
                  Creating...
                </>
              ) : (
                'Create Task'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
