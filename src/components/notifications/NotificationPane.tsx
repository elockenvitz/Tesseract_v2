import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, X, TrendingUp, FileText, Target, AlertCircle, Calendar, User, Minimize2, Maximize2, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface NotificationPaneProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onNotificationClick?: (notification: any) => void
}

interface Notification {
  id: string
  user_id: string
  type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change' | 'coverage_request'
  title: string
  message: string
  context_type: 'asset' | 'note' | 'portfolio' | 'theme'
  context_id: string
  context_data: any
  is_read: boolean
  created_at: string
  read_at: string | null
}

export function NotificationPane({ 
  isOpen, 
  onToggle, 
  isFullscreen, 
  onToggleFullscreen, 
  onNotificationClick 
}: NotificationPaneProps) {
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

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq('user_id', user?.id)
        .eq('is_read', false)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] })
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
      case 'coverage_request':
        return <Users className="h-4 w-4 text-indigo-600" />
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
      case 'coverage_request':
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

    // Handle coverage_request notifications by opening coverage manager
    if (notification.type === 'coverage_request') {
      if (onNotificationClick) {
        onNotificationClick({
          type: 'coverage_manager_requests',
          id: 'coverage_manager',
          title: 'Coverage Requests'
        })
      }
      return
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

  return (
    <div className={clsx(
      'fixed right-0 top-16 bottom-0 bg-white border-l border-gray-200 shadow-lg transform transition-transform duration-300 ease-in-out z-30',
      isFullscreen ? 'left-0' : 'w-96',
      isOpen ? 'translate-x-0' : 'translate-x-full'
    )}>
      <div className="flex flex-col h-full">
        {/* Filter Tabs */}
        <div className="flex border-b border-gray-200 bg-white pt-4">
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
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-4 space-y-4">
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
                        {!notification.is_read && (
                          <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-2">
                        {notification.message}
                      </p>
                      
                      <div className="flex items-center justify-between">
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
                      
                      <Badge variant={getNotificationColor(notification.type)} size="sm" className="mt-2">
                        {notification.type.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </h3>
              <p className="text-gray-500 text-sm">
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
            <div className="flex items-center justify-between mb-2">
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
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                {filteredNotifications.length} of {notifications?.length || 0}
              </span>
              {unreadCount > 0 && (
                <span className="font-medium text-primary-600">
                  {unreadCount} unread
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}