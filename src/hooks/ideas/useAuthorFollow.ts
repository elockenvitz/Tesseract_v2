import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

interface Follow {
  id: string
  follower_id: string
  following_id: string
  created_at: string
}

export function useAuthorFollow(authorId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Check if following this author
  const { data: isFollowing = false, isLoading } = useQuery({
    queryKey: ['author-follow', authorId, user?.id],
    queryFn: async () => {
      if (!authorId || !user?.id || authorId === user.id) return false

      const { data, error } = await supabase
        .from('author_follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', authorId)
        .maybeSingle()

      if (error) throw error
      return !!data
    },
    enabled: !!authorId && !!user?.id && authorId !== user.id,
    staleTime: 60000
  })

  // Toggle follow mutation
  const toggleFollow = useMutation({
    mutationFn: async (targetAuthorId: string) => {
      if (!user?.id) throw new Error('User not authenticated')
      if (targetAuthorId === user.id) throw new Error('Cannot follow yourself')

      // Check if already following
      const { data: existing } = await supabase
        .from('author_follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', targetAuthorId)
        .maybeSingle()

      if (existing) {
        // Unfollow
        const { error } = await supabase
          .from('author_follows')
          .delete()
          .eq('id', existing.id)

        if (error) throw error
        return { action: 'unfollowed' }
      } else {
        // Follow
        const { error } = await supabase
          .from('author_follows')
          .insert({
            follower_id: user.id,
            following_id: targetAuthorId
          })

        if (error) throw error
        return { action: 'followed' }
      }
    },
    onMutate: async (targetAuthorId) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: ['author-follow', targetAuthorId, user?.id]
      })

      const previousValue = queryClient.getQueryData<boolean>(
        ['author-follow', targetAuthorId, user?.id]
      )

      queryClient.setQueryData(
        ['author-follow', targetAuthorId, user?.id],
        !previousValue
      )

      return { previousValue }
    },
    onError: (_error, targetAuthorId, context) => {
      // Rollback on error
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData(
          ['author-follow', targetAuthorId, user?.id],
          context.previousValue
        )
      }
    },
    onSettled: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['author-follow'] })
      queryClient.invalidateQueries({ queryKey: ['following-list'] })
      queryClient.invalidateQueries({ queryKey: ['followers-list'] })
      queryClient.invalidateQueries({ queryKey: ['scoring-context'] })
    }
  })

  return {
    isFollowing,
    isLoading,
    toggleFollow: (id: string) => toggleFollow.mutate(id),
    isToggling: toggleFollow.isPending
  }
}

// Get list of users I'm following
export function useFollowingList() {
  const { user } = useAuth()

  const { data: following = [], isLoading, refetch } = useQuery({
    queryKey: ['following-list', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('author_follows')
        .select(`
          *,
          following:following_id (
            id,
            email,
            first_name,
            last_name,
            full_name,
            avatar_url
          )
        `)
        .eq('follower_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!user?.id,
    staleTime: 60000
  })

  const followingIds = new Set(following.map(f => f.following_id))

  return {
    following,
    followingIds,
    isLoading,
    refetch,
    isFollowing: (authorId: string) => followingIds.has(authorId)
  }
}

// Get list of my followers
export function useFollowersList() {
  const { user } = useAuth()

  const { data: followers = [], isLoading, refetch } = useQuery({
    queryKey: ['followers-list', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('author_follows')
        .select(`
          *,
          follower:follower_id (
            id,
            email,
            first_name,
            last_name,
            full_name,
            avatar_url
          )
        `)
        .eq('following_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!user?.id,
    staleTime: 60000
  })

  return {
    followers,
    followerCount: followers.length,
    isLoading,
    refetch
  }
}

// Get follow stats for an author
export function useAuthorFollowStats(authorId?: string) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['author-follow-stats', authorId],
    queryFn: async () => {
      if (!authorId) return { followers: 0, following: 0 }

      const [followersResult, followingResult] = await Promise.all([
        supabase
          .from('author_follows')
          .select('id', { count: 'exact', head: true })
          .eq('following_id', authorId),
        supabase
          .from('author_follows')
          .select('id', { count: 'exact', head: true })
          .eq('follower_id', authorId)
      ])

      return {
        followers: followersResult.count || 0,
        following: followingResult.count || 0
      }
    },
    enabled: !!authorId,
    staleTime: 60000
  })

  return {
    followerCount: stats?.followers || 0,
    followingCount: stats?.following || 0,
    isLoading
  }
}
