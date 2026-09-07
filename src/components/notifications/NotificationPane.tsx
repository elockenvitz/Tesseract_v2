import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, X, TrendingUp, FileText, Target, AlertCircle, Calendar, User, Minimize2, Maximize2, Users, Share2, MessageCircle, List, ThumbsUp, ThumbsDown, Lightbulb } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { consolidateNotifications, type ConsolidatedNotification } from '../../lib/notifications/grouping'

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
  type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change' | 'coverage_request' | 'workflow_access_request' | 'workflow_invitation' | 'simulation_shared' | 'list_suggestion_received' | 'list_suggestion_accepted' | 'list_suggestion_rejected' | 'new_message' | 'list_collaboration' | 'mention' | 'price_target_expired' | 'task_assigned' | 'share' | 'trade_idea_created'
  title: string
  message: string
  context_type: 'asset' | 'note' | 'portfolio' | 'theme' | 'workflow' | 'list' | 'project' | 'price_target' | 'conversation'
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

  // Mark notification as read.
  //
  // Takes the ids of every row the reader actually saw — a consolidated row
  // stands for the copies folded into it, and leaving those unread would keep
  // the header badge lit for something already dealt with.
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationIds: string | string[]) => {
      const ids = (Array.isArray(notificationIds) ? notificationIds : [notificationIds]).filter(Boolean)
      if (ids.length === 0) return

      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .in('id', ids)

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
      case 'price_target_expired':
        return <Target className="h-4 w-4 text-green-600" />
      case 'note_shared':
      case 'note_created':
        return <FileText className="h-4 w-4 text-purple-600" />
      case 'coverage_request':
        return <Users className="h-4 w-4 text-indigo-600" />
      case 'workflow_access_request':
      case 'workflow_invitation':
        return <User className="h-4 w-4 text-orange-600" />
      case 'task_assigned':
        return <User className="h-4 w-4 text-orange-600" />
      case 'trade_idea_created':
        return <TrendingUp className="h-4 w-4 text-emerald-600" />
      case 'simulation_shared':
      case 'share':
        return <Share2 className="h-4 w-4 text-primary-600" />
      case 'new_message':
      case 'mention':
        return <MessageCircle className="h-4 w-4 text-sky-600" />
      case 'list_suggestion_received':
        return <Lightbulb className="h-4 w-4 text-amber-600" />
      case 'list_suggestion_accepted':
        return <ThumbsUp className="h-4 w-4 text-emerald-600" />
      case 'list_suggestion_rejected':
        return <ThumbsDown className="h-4 w-4 text-red-600" />
      case 'list_collaboration':
        return <List className="h-4 w-4 text-teal-600" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600 dark:text-gray-400" />
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'asset_field_change':
      case 'asset_priority_change':
      case 'asset_stage_change':
        return 'primary'
      case 'price_target_change':
      case 'price_target_expired':
        return 'success'
      case 'note_shared':
      case 'note_created':
        return 'purple'
      case 'coverage_request':
        return 'purple'
      case 'simulation_shared':
      case 'share':
        return 'primary'
      case 'trade_idea_created':
        return 'success'
      case 'new_message':
      case 'mention':
        return 'primary'
      case 'list_suggestion_received':
        return 'warning'
      case 'list_suggestion_accepted':
        return 'success'
      case 'list_suggestion_rejected':
        return 'danger'
      case 'list_collaboration':
        return 'success'
      default:
        return 'default'
    }
  }

  const handleNotificationClick = (notification: ConsolidatedNotification & Notification) => {
    // Mark as read if not already read
    if (!notification.is_read) {
      markAsReadMutation.mutate([notification.id, ...(notification.memberNotificationIds ?? [])])
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

    // Handle simulation_shared notifications by navigating to the shared simulation
    if (notification.type === 'simulation_shared') {
      window.dispatchEvent(new CustomEvent('open-shared-simulation', {
        detail: {
          share: {
            share_id: notification.context_data?.share_id || notification.context_id,
            simulation_id: notification.context_data?.simulation_id,
            share_mode: notification.context_data?.share_mode || 'snapshot',
            name: notification.context_data?.simulation_name || 'Shared Simulation',
          }
        }
      }))
      return
    }

    // Handle new_message / mention notifications by opening DM
    if ((notification.type === 'new_message' || notification.type === 'mention') && notification.context_data?.conversation_id) {
      window.dispatchEvent(new CustomEvent('openDirectMessage', {
        detail: { conversationId: notification.context_data.conversation_id }
      }))
      return
    }

    // Handle list notifications by navigating to the list
    if ((notification.type === 'list_collaboration' || notification.type === 'list_suggestion_received' || notification.type === 'list_suggestion_accepted' || notification.type === 'list_suggestion_rejected') && notification.context_data?.list_id) {
      if (onNotificationClick) {
        onNotificationClick({
          type: 'list',
          id: notification.context_data.list_id,
          title: notification.context_data.list_name || 'List'
        })
      }
      return
    }

    // Handle workflow_access_request notifications by opening workflow Team & Admins tab
    if (notification.type === 'workflow_access_request' && notification.context_data?.workflow_id) {
      if (onNotificationClick) {
        onNotificationClick({
          type: 'workflow',
          id: notification.context_data.workflow_id,
          title: notification.context_data.workflow_name || 'Workflow',
          tab: 'admins' // Open the Team & Admins tab
        })
      }
      return
    }

    // Prompt notifications open the prompt in the right-pane
    // inspector instead of as a tab. Includes the legacy case where
    // pre-fix prompts were stored with context_type='asset' but
    // a prompt_id in context_data — detect via context_data.prompt_id.
    const promptIdFromData = (notification.context_data as any)?.prompt_id
    const isPromptCtx = notification.context_type === 'prompt' || notification.context_type === 'quick_thought'
    if (isPromptCtx || promptIdFromData) {
      const promptId = promptIdFromData || notification.context_id
      if (promptId) {
        try {
          window.dispatchEvent(new CustomEvent('openThoughtDetail', {
            detail: { thoughtId: promptId, itemType: 'prompt' },
          }))
        } catch { /* ignore */ }
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
        case 'price_target':
          // Expired-target notifications had no case here at all, so tapping
          // one did nothing — the alert told you three AMZN targets needed
          // review and then refused to take you to AMZN. The useful
          // destination is the asset; the target ids stay in context_data as
          // provenance. Rows written since the grouping migration already
          // arrive as context_type 'asset', so this is the path for everything
          // emitted before it.
          if (notification.context_data?.asset_id) {
            navigationData = {
              id: notification.context_data.asset_id,
              title: notification.context_data?.asset_symbol || 'Asset',
              type: 'asset',
              data: {
                id: notification.context_data.asset_id,
                symbol: notification.context_data?.asset_symbol,
                company_name: notification.context_data?.asset_name
              }
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
        case 'workflow':
          // For task assignments, navigate to the asset
          if (notification.type === 'task_assigned' && notification.context_data?.asset_symbol) {
            navigationData = {
              id: notification.context_data.asset_id || notification.context_data.asset_symbol,
              title: notification.context_data.asset_symbol,
              type: 'asset',
              data: {
                id: notification.context_data.asset_id,
                symbol: notification.context_data.asset_symbol,
                taskId: notification.context_id,
                workflowId: notification.context_data?.workflow_id,
                workflowName: notification.context_data?.workflow_name,
                stageId: notification.context_data?.stage_id
              }
            }
          }
          break
        case 'task':
          // Navigate to the asset with the task, and open the workflow stage
          navigationData = {
            id: notification.context_data?.asset_id,
            title: notification.context_data?.asset_symbol || 'Task',
            type: 'asset',
            data: {
              id: notification.context_data?.asset_id,
              symbol: notification.context_data?.asset_symbol,
              company_name: notification.context_data?.asset_name,
              // Include task-specific data for focusing on the task
              taskId: notification.context_id,
              workflowId: notification.context_data?.workflow_id,
              stageId: notification.context_data?.stage_id
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

  /*
    Fold rows that describe one situation before anything is counted or drawn.

    New rows arrive already consolidated — the producer holds a unique
    (user_id, group_key) — so for those this is a no-op. It matters for the
    backlog: a pilot inbox still holds the six AMZN rows three expired targets
    produced before that index existed, and those should read as one line
    saying three targets need review.
  */
  const consolidated = useMemo(
    () => consolidateNotifications((notifications ?? []) as any) as (ConsolidatedNotification & Notification)[],
    [notifications]
  )

  const filteredNotifications = consolidated.filter(notification => {
    if (filter === 'unread') {
      return !notification.is_read
    }
    return true
  })

  const unreadCount = consolidated.filter(n => !n.is_read).length

  return (
    /*
      Fills whatever CommunicationPane gives it, like every other view in that
      pane (AI, messages, thoughts, discussion) already does.

      It used to declare its own `fixed right-0 top-16 bottom-0 w-96` rail
      INSIDE that pane. The pane is transformed, so a fixed descendant is
      contained by it rather than by the viewport — the list rendered as a
      384px column pinned to the right edge of the sheet, with its own second
      slide-in transform. On a 390px phone that left a dead strip down the
      left; at 360px and 320px the rows ran off the right edge and the
      mark-as-read control went with them.
    */
    <div className="h-full w-full bg-white dark:bg-gray-800">
      <div className="flex flex-col h-full">
        {/* Filter Tabs */}
        <div className="flex border-b border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={() => setFilter('all')}
            className={clsx(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              filter === 'all'
                ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
            )}
          >
            All ({consolidated.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={clsx(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              filter === 'unread'
                ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400'
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
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={clsx(
                    'p-4 hover:bg-gray-50 cursor-pointer transition-colors relative dark:hover:bg-gray-800',
                    !notification.is_read && 'bg-blue-50 border-l-4 border-primary-500'
                  )}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center dark:bg-gray-800">
                        {getNotificationIcon(notification.type)}
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="text-sm font-semibold text-gray-900 truncate dark:text-white">
                          {notification.title}
                        </h4>
                        {!notification.is_read && (
                          <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-2 dark:text-gray-400">
                        {notification.message}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
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
                              markAsReadMutation.mutate([notification.id, ...(notification.memberNotificationIds ?? [])])
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
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-gray-800">
                <Bell className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </h3>
              <p className="text-gray-500 text-sm dark:text-gray-400">
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
          <div className="p-4 border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
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
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>
                {filteredNotifications.length} of {consolidated.length}
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