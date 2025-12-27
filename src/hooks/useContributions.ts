import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAIConfig } from './useAIConfig'

export type ContributionVisibility = 'portfolio' | 'team' | 'department' | 'division' | 'firm'

export interface VisibilityTarget {
  id: string
  node_id: string
  node?: {
    id: string
    name: string
    color: string | null
    node_type: string
  }
}

export interface Contribution {
  id: string
  asset_id: string
  section: string
  content: string
  created_by: string
  team_id: string | null
  visibility: ContributionVisibility
  is_pinned: boolean
  is_archived: boolean
  pinned_by: string | null
  pinned_at: string | null
  archived_by: string | null
  archived_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  team?: {
    id: string
    name: string
    color: string | null
  }
  visibility_targets?: VisibilityTarget[]
}

export interface ContributionHistory {
  id: string
  contribution_id: string
  old_content: string | null
  new_content: string
  changed_by: string
  changed_at: string
  user?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string
  }
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseContributionsOptions {
  assetId: string
  section?: string
}

export function useContributions({ assetId, section }: UseContributionsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch contributions for an asset, grouped by user (one per user per section)
  const {
    data: contributions,
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ['contributions', assetId, section],
    queryFn: async () => {
      let query = supabase
        .from('asset_contributions')
        .select(`
          *,
          user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
          team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color),
          visibility_targets:contribution_visibility_targets(
            id,
            node_id,
            node:org_chart_nodes(id, name, color, node_type)
          )
        `)
        .eq('asset_id', assetId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })

      if (section) {
        query = query.eq('section', section)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(c => ({
        ...c,
        user: c.user ? { ...c.user, full_name: getFullName(c.user) } : undefined,
        visibility_targets: c.visibility_targets || []
      })) as Contribution[]
    },
    enabled: !!assetId
  })

  // Get the current user's contribution for this section
  const myContribution = contributions?.find(c => c.created_by === user?.id)

  // Get other users' contributions (sorted by most recent)
  const otherContributions = contributions?.filter(c => c.created_by !== user?.id) || []

  // Save contribution (upsert - create or update)
  const saveContribution = useMutation({
    mutationFn: async ({
      content,
      sectionKey,
      visibility = 'firm' as ContributionVisibility,
      targetIds = []
    }: {
      content: string
      sectionKey: string
      visibility?: ContributionVisibility
      targetIds?: string[]
    }) => {
      // Check if user already has a contribution for this section
      const { data: existing } = await supabase
        .from('asset_contributions')
        .select('id')
        .eq('asset_id', assetId)
        .eq('section', sectionKey)
        .eq('created_by', user?.id)
        .maybeSingle()

      if (existing) {
        // Update existing contribution
        const { data, error } = await supabase
          .from('asset_contributions')
          .update({
            content,
            visibility,
            team_id: targetIds.length === 1 ? targetIds[0] : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select(`
            *,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
            team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color)
          `)
          .single()

        if (error) throw error

        // Update visibility targets
        await supabase
          .from('contribution_visibility_targets')
          .delete()
          .eq('contribution_id', existing.id)

        if (visibility !== 'firm' && targetIds.length > 0) {
          await supabase
            .from('contribution_visibility_targets')
            .insert(targetIds.map(nodeId => ({
              contribution_id: existing.id,
              node_id: nodeId
            })))
        }

        return {
          ...data,
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as Contribution
      } else {
        // Create new contribution
        const { data, error } = await supabase
          .from('asset_contributions')
          .insert({
            asset_id: assetId,
            section: sectionKey,
            content,
            created_by: user?.id,
            team_id: targetIds.length === 1 ? targetIds[0] : null,
            visibility
          })
          .select(`
            *,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name),
            team:org_chart_nodes!asset_contributions_team_id_fkey(id, name, color)
          `)
          .single()

        if (error) throw error

        // Save visibility targets
        if (targetIds.length > 0) {
          await supabase
            .from('contribution_visibility_targets')
            .insert(targetIds.map(nodeId => ({
              contribution_id: data.id,
              node_id: nodeId
            })))
        }

        return {
          ...data,
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as Contribution
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
      queryClient.invalidateQueries({ queryKey: ['contribution-history'] })
      queryClient.invalidateQueries({ queryKey: ['aggregate-history', assetId] })
    }
  })

  // Delete contribution
  const deleteContribution = useMutation({
    mutationFn: async () => {
      if (!myContribution) return

      const { error } = await supabase
        .from('asset_contributions')
        .delete()
        .eq('id', myContribution.id)
        .eq('created_by', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    }
  })

  // Update visibility
  const updateVisibility = useMutation({
    mutationFn: async ({
      contributionId,
      visibility,
      targetIds = []
    }: {
      contributionId?: string
      visibility: ContributionVisibility
      targetIds?: string[]
    }) => {
      // Use passed contributionId or fall back to myContribution
      const contribId = contributionId || myContribution?.id
      if (!contribId) throw new Error('No contribution to update')

      console.log('Updating visibility:', {
        contributionId: contribId,
        visibility,
        targetIds
      })

      const { data, error } = await supabase
        .from('asset_contributions')
        .update({
          visibility,
          team_id: targetIds.length === 1 ? targetIds[0] : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', contribId)
        .eq('created_by', user?.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating visibility:', error)
        throw error
      }

      console.log('Visibility updated:', data)

      // Update visibility targets
      const { error: deleteError } = await supabase
        .from('contribution_visibility_targets')
        .delete()
        .eq('contribution_id', contribId)

      if (deleteError) {
        console.error('Error deleting visibility targets:', deleteError)
      }

      if (visibility !== 'firm' && targetIds.length > 0) {
        const { error: insertError } = await supabase
          .from('contribution_visibility_targets')
          .insert(targetIds.map(nodeId => ({
            contribution_id: contribId,
            node_id: nodeId
          })))

        if (insertError) {
          console.error('Error inserting visibility targets:', insertError)
        }
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contributions', assetId] })
    },
    onError: (error) => {
      console.error('updateVisibility mutation failed:', error)
    }
  })

  return {
    contributions: contributions || [],
    myContribution,
    otherContributions,
    isLoading,
    isFetching,
    error,
    refetch,
    saveContribution,
    deleteContribution,
    updateVisibility
  }
}

// Hook for fetching contribution history for a specific user's contribution
export function useContributionHistory(contributionId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['contribution-history', contributionId],
    queryFn: async () => {
      if (!contributionId) return []

      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          *,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('contribution_id', contributionId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined
      })) as ContributionHistory[]
    },
    enabled: !!contributionId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}

// Hook for fetching aggregate history across all contributions for a section
export function useAggregateHistory({ assetId, section }: { assetId: string; section: string }) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['aggregate-history', assetId, section],
    queryFn: async () => {
      // First get all contribution IDs for this section
      const { data: contributions } = await supabase
        .from('asset_contributions')
        .select('id')
        .eq('asset_id', assetId)
        .eq('section', section)

      if (!contributions || contributions.length === 0) return []

      const contributionIds = contributions.map(c => c.id)

      // Fetch all history for these contributions
      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          *,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name),
          contribution:asset_contributions!asset_contribution_history_contribution_id_fkey(
            id,
            user:users!asset_contributions_created_by_fkey(id, first_name, last_name)
          )
        `)
        .in('contribution_id', contributionIds)
        .order('changed_at', { ascending: false })

      if (error) throw error

      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined,
        contribution: h.contribution ? {
          ...h.contribution,
          user: h.contribution.user ? { ...h.contribution.user, full_name: getFullName(h.contribution.user) } : undefined
        } : undefined
      }))
    },
    enabled: !!assetId && !!section
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}

// Hook for AI-powered summarization of contributions
export function useContributionSummary({
  assetId,
  section,
  contributions
}: {
  assetId: string
  section: string
  contributions: Contribution[]
}) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Check if we have a cached summary
  const { data: cachedSummary, isLoading: cacheLoading } = useQuery({
    queryKey: ['contribution-summary', assetId, section],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contribution_summaries')
        .select('*')
        .eq('asset_id', assetId)
        .eq('section', section)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!assetId && !!section
  })

  // Generate summary mutation
  const generateSummary = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      if (contributions.length === 0) {
        throw new Error('No contributions to summarize')
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Build the prompt with all contributions
      const contributionTexts = contributions.map(c =>
        `${c.user?.full_name || 'Unknown'}: ${c.content}`
      ).join('\n\n')

      const sectionLabels: Record<string, string> = {
        thesis: 'Investment Thesis',
        where_different: 'Where We Are Different',
        risks_to_thesis: 'Risks to Thesis'
      }

      const prompt = `Summarize the following ${sectionLabels[section] || section} views from multiple team members into a concise, unified summary. Highlight key themes, areas of agreement, and any notable differences in perspective. Keep it brief but comprehensive.

Views:
${contributionTexts}

Provide a 2-3 paragraph summary that captures the essence of the team's collective thinking.`

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: prompt,
            conversationHistory: [],
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate summary')
      }

      const data = await response.json()
      const summaryText = data.response as string

      // Cache the summary
      const { error: upsertError } = await supabase
        .from('contribution_summaries')
        .upsert({
          asset_id: assetId,
          section,
          summary: summaryText,
          contribution_count: contributions.length,
          last_contribution_at: contributions[0]?.updated_at,
          generated_at: new Date().toISOString(),
          generated_by: user.id
        }, {
          onConflict: 'asset_id,section'
        })

      if (upsertError) {
        console.error('Failed to cache summary:', upsertError)
      }

      return summaryText
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contribution-summary', assetId, section] })
    }
  })

  // Check if summary is stale (contributions changed since last summary)
  const isStale = cachedSummary && contributions.length > 0 && (
    cachedSummary.contribution_count !== contributions.length ||
    new Date(contributions[0]?.updated_at) > new Date(cachedSummary.last_contribution_at)
  )

  return {
    summary: cachedSummary?.summary || null,
    isLoading: cacheLoading,
    isGenerating: generateSummary.isPending,
    isStale,
    isConfigured: effectiveConfig.isConfigured,
    error: generateSummary.error,
    generateSummary: generateSummary.mutate,
    regenerateSummary: generateSummary.mutate
  }
}
