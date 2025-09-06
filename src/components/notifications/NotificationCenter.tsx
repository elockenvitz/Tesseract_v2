import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, X, TrendingUp, FileText, Target, AlertCircle, Calendar, User } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
  onNotificationClick?: (notification: any) => void
}

interface Notification {
  id: string
  user_id: string
  type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change'
  title: string
  message: string
  context_type: 'asset' | 'note' | 'portfolio' | 'theme'
  context_id: string
  context_data: any
  is_read: boolean
  created_at: string
  read_at: string | null
}

export function NotificationCenter({ isOpen, onClose, onNotificationClick }: NotificationCenterProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data as Notification[]
    },
    enabled: isOpen && !!user?.id,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase.rpc('mark_notification_read', {
        notification_id: notificationId
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
  })

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_all_notifications_read')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
  })

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'asset_field_change':
      case 'asset_priority_change':
      case 'asset_stage_change':
        return <TrendingUp className="h-4 w-4 text-blue-600" />
      case 'price_target_change':
        return <Target className="h-4 w-4 text-green-600" />
      case 'note_shared':
      case 'note_created':
        return <FileText className="h-4 w-4 text-purple-600" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600" />
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'asset_field_change':
      case 'asset_priority_change':
      case 'asset_stage_change':
        return 'primary'
      case 'price_target_change':
        return 'success'
      case 'note_shared':
      case 'note_created':
        return 'purple'
      default:
        return 'default'
    }
  }

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if not already read
    if (!notification.is_read) {
      markAsReadMutation.mutate(notification.id)
    }

    // Navigate to the related content
    if (onNotificationClick) {
      let navigationData = null

      switch (notification.context_type) {
        case 'asset':
          navigationData = {
            id: notification.context_id,
            title: notification.context_data?.asset_symbol || 'Asset',
            type: 'asset',
            data: { 
              id: notification.context_id,
              symbol: notification.context_data?.asset_symbol,
              company_name: notification.context_data?.asset_name
            }
          }
          break
        case 'note':
          navigationData = {
            id: notification.context_id,
            title: notification.title.split(': ')[1] || 'Note',
            type: 'note',
            data: { 
              id: notification.context_id,
              title: notification.title.split(': ')[1] || 'Note'
            }
          }
          break
        // Add other context types as needed
      }

      if (navigationData) {
        onNotificationClick(navigationData)
        onClose()
      }
    }
  }

  const filteredNotifications = notifications?.filter(notification => {
    if (filter === 'unread') {
      return !notification.is_read
    }
    return true
  }) || []

  const unreadCount = notifications?.filter(n => !n.is_read).length || 0

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="flex min-h-full items-start justify-center p-4 pt-16">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <Bell className="h-5 w-5 text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <Badge variant="error" size="sm">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {unreadCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markAllAsReadMutation.mutate()}
                  disabled={markAllAsReadMutation.isPending}
                >
                  <CheckCheck className="h-4 w-4 mr-2" />
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

          {/* Filter Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setFilter('all')}
              className={clsx(
                'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                filter === 'all'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              All ({notifications?.length || 0})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={clsx(
                'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                filter === 'unread'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[60vh]">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredNotifications.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {filteredNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={clsx(
                      'p-4 hover:bg-gray-50 cursor-pointer transition-colors relative',
                      !notification.is_read && 'bg-blue-50 border-l-4 border-primary-500'
                    )}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-sm font-semibold text-gray-900 truncate">
                            {notification.title}
                          </h4>
                          <Badge variant={getNotificationColor(notification.type)} size="sm">
                            {notification.type.replace(/_/g, ' ')}
                          </Badge>
                          {!notification.is_read && (
                            <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                          )}
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2">
                          {notification.message}
                        </p>
                        
                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <div className="flex items-center">
                            <Calendar className="h-3 w-3 mr-1" />
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </div>
                          {notification.context_data?.asset_symbol && (
                            <div className="flex items-center">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              {notification.context_data.asset_symbol}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {!notification.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            markAsReadMutation.mutate(notification.id)
                          }}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          title="Mark as read"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bell className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </h3>
                <p className="text-gray-500">
                  {filter === 'unread' 
                    ? 'All caught up! Check back later for updates.'
                    : 'You\'ll receive notifications about asset changes, shared notes, and more.'
                  }
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {filteredNotifications.length > 0 && (
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>
                  Showing {filteredNotifications.length} of {notifications?.length || 0} notifications
                </span>
                {unreadCount > 0 && (
                  <span className="font-medium">
                    {unreadCount} unread
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}