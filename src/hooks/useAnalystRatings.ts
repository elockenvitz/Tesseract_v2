import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface RatingScaleValue {
  value: string
  label: string
  color: string
  sort: number
}

export interface RatingScale {
  id: string
  name: string
  description: string | null
  values: RatingScaleValue[]
  is_default: boolean
  is_system: boolean
  organization_id: string | null
  created_by: string | null
  created_at: string
}

export interface AnalystRating {
  id: string
  asset_id: string
  user_id: string
  rating_value: string
  rating_scale_id: string
  notes: string | null
  source: 'manual' | 'excel_sync' | 'api'
  source_file_id: string | null
  is_official: boolean
  created_at: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  rating_scale?: RatingScale
}

export interface RatingHistory {
  id: string
  rating_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  source: string | null
  changed_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

interface RatingConsensus {
  rating_value: string
  rating_count: number
  total_analysts: number
}

const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseAnalystRatingsOptions {
  assetId: string
  userId?: string
}

export function useAnalystRatings({ assetId, userId }: UseAnalystRatingsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all ratings for this asset
  const {
    data: ratings,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['analyst-ratings', assetId, userId],
    queryFn: async () => {
      let query = supabase
        .from('analyst_ratings')
        .select(`
          *,
          user:users!analyst_ratings_user_id_fkey(id, first_name, last_name),
          rating_scale:rating_scales!analyst_ratings_rating_scale_id_fkey(*)
        `)
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(r => ({
        ...r,
        user: r.user ? { ...r.user, full_name: getFullName(r.user) } : undefined
      })) as AnalystRating[]
    },
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  // Get my rating
  const myRating = ratings?.find(r => r.user_id === user?.id)

  // Get other ratings
  const otherRatings = ratings?.filter(r => r.user_id !== user?.id) || []

  // Group ratings by value for consensus view
  const ratingsByValue = (ratings || []).reduce((acc, r) => {
    if (!acc[r.rating_value]) acc[r.rating_value] = []
    acc[r.rating_value].push(r)
    return acc
  }, {} as Record<string, AnalystRating[]>)

  // Calculate consensus
  const consensus = ratings && ratings.length > 0
    ? Object.entries(ratingsByValue)
        .map(([value, ratingList]) => ({
          value,
          count: ratingList.length,
          percentage: (ratingList.length / ratings.length) * 100
        }))
        .sort((a, b) => b.count - a.count)
    : []

  // Save or update a rating
  const saveRating = useMutation({
    mutationFn: async ({
      ratingValue,
      ratingScaleId,
      notes,
      source = 'manual',
      sourceFileId
    }: {
      ratingValue: string
      ratingScaleId: string
      notes?: string
      source?: 'manual' | 'excel_sync' | 'api'
      sourceFileId?: string
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Check if rating already exists (unique constraint on asset_id + user_id)
      const { data: existing } = await supabase
        .from('analyst_ratings')
        .select('id')
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .maybeSingle()

      const ratingData = {
        rating_value: ratingValue,
        rating_scale_id: ratingScaleId,
        notes: notes || null,
        source,
        source_file_id: sourceFileId || null,
        updated_at: new Date().toISOString()
      }

      if (existing) {
        const { data, error } = await supabase
          .from('analyst_ratings')
          .update(ratingData)
          .eq('id', existing.id)
          .select(`
            *,
            user:users!analyst_ratings_user_id_fkey(id, first_name, last_name),
            rating_scale:rating_scales!analyst_ratings_rating_scale_id_fkey(*)
          `)
          .single()

        if (error) throw error
        return { ...data, user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined } as AnalystRating
      } else {
        const { data, error } = await supabase
          .from('analyst_ratings')
          .insert({
            asset_id: assetId,
            user_id: user.id,
            ...ratingData
          })
          .select(`
            *,
            user:users!analyst_ratings_user_id_fkey(id, first_name, last_name),
            rating_scale:rating_scales!analyst_ratings_rating_scale_id_fkey(*)
          `)
          .single()

        if (error) throw error
        return { ...data, user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined } as AnalystRating
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-ratings', assetId] })
    }
  })

  // Delete a rating
  const deleteRating = useMutation({
    mutationFn: async (ratingId: string) => {
      const { error } = await supabase
        .from('analyst_ratings')
        .delete()
        .eq('id', ratingId)
        .eq('user_id', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-ratings', assetId] })
    }
  })

  return {
    ratings: ratings || [],
    myRating,
    otherRatings,
    ratingsByValue,
    consensus,
    isLoading,
    error,
    refetch,
    saveRating,
    deleteRating
  }
}

// Hook for fetching rating scales
export function useRatingScales() {
  const { data: scales, isLoading, error } = useQuery({
    queryKey: ['rating-scales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rating_scales')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name')

      if (error) throw error
      return data as RatingScale[]
    },
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000
  })

  const defaultScale = scales?.find(s => s.is_default)
  const systemScales = scales?.filter(s => s.is_system) || []
  const customScales = scales?.filter(s => !s.is_system) || []

  const getScaleById = (id: string) => scales?.find(s => s.id === id)

  const getRatingLabel = (scaleId: string, value: string) => {
    const scale = getScaleById(scaleId)
    return scale?.values.find(v => v.value === value)?.label || value
  }

  const getRatingColor = (scaleId: string, value: string) => {
    const scale = getScaleById(scaleId)
    return scale?.values.find(v => v.value === value)?.color || '#6b7280'
  }

  return {
    scales: scales || [],
    defaultScale,
    systemScales,
    customScales,
    isLoading,
    error,
    getScaleById,
    getRatingLabel,
    getRatingColor
  }
}

// Hook for rating consensus (using RPC function)
export function useRatingConsensus(assetId: string) {
  const { data: consensus, isLoading, error } = useQuery({
    queryKey: ['rating-consensus', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_rating_consensus', { p_asset_id: assetId })

      if (error) throw error
      return data as RatingConsensus[]
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Get dominant rating
  const dominantRating = consensus?.[0]

  return {
    consensus: consensus || [],
    dominantRating,
    isLoading,
    error
  }
}

// Hook for rating history
export function useRatingHistory(ratingId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['rating-history', ratingId],
    queryFn: async () => {
      if (!ratingId) return []

      const { data, error } = await supabase
        .from('analyst_rating_history')
        .select(`
          *,
          user:users!analyst_rating_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('rating_id', ratingId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return data as RatingHistory[]
    },
    enabled: !!ratingId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}
