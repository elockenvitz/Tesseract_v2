import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, Bell, Users, FileText, List, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'

interface NotificationPanelProps {
  isOpen: boolean
  onClose: () => void
  onNavigate?: (result: any) => void
}

interface Notification {
  id: string
  type: 'list_shared' | 'note_shared' | 'system'
  title: string
  message: string
  related_id?: string
  related_type?: string
  is_read: boolean
  dismissed: boolean
  created_at: string
  read_at?: string
  dismissed_at?: string
}

export function NotificationPanel({ isOpen, onClose, onNavigate }: NotificationPanelProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as Notification[]
    },
    enabled: isOpen && !!user?.id,
    refetchInterval: 10000 // Refresh every 10 seconds
  })

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] })
    }
  })

  // Dismiss notification
  const dismissNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({
          dismissed: true,
          dismissed_at: new Date().toISOString()
        })
        .eq('id', notificationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] })
    }
  })

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) return

      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('is_read', false)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] })
    }
  })

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if not already read
    if (!notification.is_read) {
      markAsReadMutation.mutate(notification.id)
    }

    // Handle task assignment notifications
    if (notification.type === 'task_assigned' && (notification.context_type === 'task' || notification.context_type === 'workflow') && onNavigate) {
      onNavigate({
        id: notification.context_data?.asset_symbol || notification.context_data?.asset_id,
        title: notification.context_data?.asset_symbol || 'Task',
        type: 'asset',
        data: {
          id: notification.context_data?.asset_id,
          symbol: notification.context_data?.asset_symbol,
          company_name: notification.context_data?.asset_name,
          taskId: notification.context_id,
          workflowId: notification.context_data?.workflow_id,
          stageId: notification.context_data?.stage_id
        }
      })
      onClose()
      return
    }

    // Navigate to related item if available
    if (notification.related_id && notification.related_type && onNavigate) {
      if (notification.related_type === 'list') {
        // Navigate to list
        onNavigate({
          id: notification.related_id,
          title: 'Shared List',
          type: 'list',
          data: { id: notification.related_id }
        })
      } else if (notification.related_type && ['asset', 'portfolio', 'theme', 'custom'].includes(notification.related_type)) {
        // Navigate to note
        onNavigate({
          id: notification.related_id,
          title: 'Shared Note',
          type: 'note',
          data: { id: notification.related_id, type: notification.related_type }
        })
      }
      onClose()
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'list_shared':
        return <List className="h-5 w-5 text-primary-600" />
      case 'note_shared':
        return <FileText className="h-5 w-5 text-success-600" />
      default:
        return <Bell className="h-5 w-5 text-gray-600" />
    }
  }

  if (!isOpen) return null

  const unreadNotifications = notifications?.filter(n => !n.is_read) || []

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="flex min-h-full items-start justify-center p-4 pt-16">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Bell className="h-5 w-5 text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
              {unreadNotifications.length > 0 && (
                <Badge variant="error" size="sm">
                  {unreadNotifications.length}
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {unreadNotifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAllAsReadMutation.mutate()}
                  disabled={markAllAsReadMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Mark all read
                </Button>
              )}
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-4">
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse flex items-start space-x-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : notifications && notifications.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                      !notification.is_read ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${
                              !notification.is_read ? 'text-gray-900' : 'text-gray-700'
                            }`}>
                              {notification.title}
                            </p>
                            <p className="text-sm text-gray-600 mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="flex items-center space-x-1 ml-2">
                            {!notification.is_read && (
                              <span className="block h-2 w-2 rounded-full bg-blue-500"></span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                dismissNotificationMutation.mutate(notification.id)
                              }}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title="Dismiss notification"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center">
                <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications</h3>
                <p className="text-gray-500">You're all caught up!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}