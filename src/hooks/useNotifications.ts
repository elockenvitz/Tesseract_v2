import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useNotifications() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false)

  // Fetch unread notification count
  const { data: unreadCount } = useQuery({
    queryKey: ['unread-notifications-count'],
    queryFn: async () => {
      if (!user?.id) return 0

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .eq('dismissed', false)

      if (error) throw error
      return count || 0
    },
    enabled: !!user?.id,
    refetchInterval: 5000, // Check every 5 seconds
  })

  // Update hasUnreadNotifications when count changes
  useEffect(() => {
    setHasUnreadNotifications((unreadCount || 0) > 0)
  }, [unreadCount])

  // Set up real-time subscription for new notifications
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('📢 Real-time notification update:', payload)
          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['notifications'] })
          queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return {
    hasUnreadNotifications,
    unreadCount: unreadCount || 0
  }
}